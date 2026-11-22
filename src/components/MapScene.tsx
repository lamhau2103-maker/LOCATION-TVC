import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import Globe, { GlobeInstance } from 'globe.gl';
import * as THREE from 'three';
import { Map as MapIcon, Mountain, Satellite } from 'lucide-react';
import { motion } from 'framer-motion';
import { APP_CONFIG, getCategoryConfig } from '../config';
import {
  AppStage,
  CentralHub,
  Farm,
  FarmCategory,
  FarmCustomLabels,
  FarmSubType,
  MapStyleMode,
  PositionDiagnosticItem,
  TimeOfDay,
} from '../types';
import {
  buildBiosecurityGeoJSON,
  calculateDistanceKm,
  getSystemCenterAndZoom,
} from '../utils/geo';
import {
  addSingleFarmIconToMap,
  createFarmPinCanvasSync,
  getLocationDisplayLabel,
  preloadHubLogo,
  refreshHubIconOnMap,
  registerMapLibreFarmIcons,
} from '../utils/icons';
import { AtmosphericCloudsOverlay } from './CursorSpotlight';

export interface MapSceneHandle {
  flyToFarm: (farm: Farm, zoom?: number) => void;
  flyToOverview: (duration?: number, pitch?: number) => void;
  flyToHub: () => void;
  flyToConnectedOverview: () => void;
  flyToGlobe: () => void;
  resetToInitialView: (targetStage: AppStage) => void;
  clearCameraPadding: () => void;
  getPositionDiagnostics: () => PositionDiagnosticItem[];
}

interface MapSceneProps {
  stage: AppStage;
  logoUrl: string;
  farms: Farm[];
  newlyAddedIds: Set<string>;
  removingFarms: Farm[];
  bouncingFarmId?: string | null;
  centralHub: CentralHub | null;
  customLabels?: FarmCustomLabels;
  selectedFarm: Farm | null;
  isHubSelected: boolean;
  singleArcFarmId: string | null;
  mobileSheetSnap?: 'collapsed' | 'half' | 'full';
  onSelectFarm: (farm: Farm) => void;
  onSelectHub: () => void;
  onClearSelection: () => void;
  onEnterMapOverview: () => void;
  activeCategories: Record<FarmCategory, boolean>;
  searchQuery: string;
  biosecurityRadius: number;
  mapStyleMode: MapStyleMode;
  onSelectMapStyle?: (mode: MapStyleMode) => void;
  timeOfDay: TimeOfDay;
  liteMode: boolean;
  onSatelliteFallbackToStreet?: () => void;
}

const OPENFREEMAP_LIBERTY_STYLE_URL =
  'https://tiles.openfreemap.org/styles/liberty';

const OPENFREEMAP_GLYPHS_URL =
  'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const OSM_STANDARD_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];

const ESRI_TERRAIN_TOPO_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';

const ESRI_SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const GLOBE_EARTH_TEXTURE_URL =
  'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const GLOBE_BUMP_TEXTURE_URL =
  'https://unpkg.com/three-globe/example/img/earth-topology.png';

const FALLBACK_GROUND_COLOR = '#e6f4f1';

try {
  if (typeof maplibregl.setWorkerUrl === 'function' && maplibreWorkerUrl) {
    maplibregl.setWorkerUrl(maplibreWorkerUrl);
  }
} catch {
  // ignore
}

function getOptimalPixelRatio(isLite: boolean): number {
  if (isLite || typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, 1.75);
}

/**
 * Hệ số kích thước theo thiết bị (điện thoại ~28px, iPad ~34px, laptop ~40px)
 */
function getDeviceSizeFactor(): number {
  if (typeof window === 'undefined') return 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 640 || h < 500) return 0.82;
  if (w < 1024) return 0.92;
  return 1.0;
}

/**
 * Tính toán vùng đệm (padding) cho camera để điểm đang chọn không bao giờ bị Card che khuất
 */
function computeCameraPadding(
  hasActiveCard: boolean,
  mobileSheetSnap: 'collapsed' | 'half' | 'full' = 'half'
): { top: number; right: number; bottom: number; left: number } {
  if (!hasActiveCard || typeof window === 'undefined') {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  const w = window.innerWidth;
  const h = window.innerHeight;

  if (h < 500 && w > h) {
    return {
      top: 44,
      right: Math.min(330, Math.round(w * 0.44)),
      bottom: 20,
      left: 20,
    };
  }

  if (w < 640) {
    const ratio =
      mobileSheetSnap === 'collapsed'
        ? 0.28
        : mobileSheetSnap === 'full'
        ? 0.65
        : 0.5;
    return {
      top: 58,
      right: 16,
      bottom: Math.min(Math.round(h * ratio), h - 120),
      left: 16,
    };
  }

  if (w < 1024 && h > w) {
    return {
      top: 72,
      right: 24,
      bottom: Math.min(Math.round(h * 0.46), h - 160),
      left: 24,
    };
  }

  const cardWidth = Math.max(320, Math.min(420, Math.round(w * 0.28)));
  return {
    top: 72,
    right: cardWidth + 28,
    bottom: 28,
    left: 28,
  };
}

/**
 * Nền Bản đồ 2D dự phòng OpenStreetMap gốc (tự kích hoạt nếu OpenFreeMap Liberty gặp sự cố mạng)
 */
function createOsmFallbackStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: 'ThaiViet 2D OpenStreetMap',
    glyphs: OPENFREEMAP_GLYPHS_URL,
    sources: {
      'osm-standard': {
        type: 'raster',
        tiles: OSM_STANDARD_TILES,
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      {
        id: 'fallback-ground-background',
        type: 'background',
        paint: {
          'background-color': FALLBACK_GROUND_COLOR,
        },
      },
      {
        id: 'osm-standard-base',
        type: 'raster',
        source: 'osm-standard',
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 0,
        },
      },
    ],
  };
}

/**
 * Nền Bản đồ Địa hình (Esri World Topo Map — nổi khối đồi núi, cây xanh, sông hồ, đường quốc lộ & ranh giới, miễn phí 100%)
 */
function createTerrainBaseStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: 'ThaiViet Terrain Topo',
    glyphs: OPENFREEMAP_GLYPHS_URL,
    sources: {
      'esri-world-topo': {
        type: 'raster',
        tiles: [ESRI_TERRAIN_TOPO_TILES],
        tileSize: 256,
        maxzoom: 18,
        attribution:
          'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
      },
    },
    layers: [
      {
        id: 'fallback-ground-background',
        type: 'background',
        paint: {
          'background-color': '#e2f0d9',
        },
      },
      {
        id: 'esri-terrain-base',
        type: 'raster',
        source: 'esri-world-topo',
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 0,
        },
      },
    ],
  };
}

/**
 * Nền Bản đồ Vệ tinh Esri World Imagery (miễn phí 100%, không cần API Key, không phủ mờ)
 */
function createSatelliteBaseStyle(
  satelliteMaxZoom = 18
): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: 'ThaiViet Satellite 2D',
    glyphs: OPENFREEMAP_GLYPHS_URL,
    sources: {
      'esri-world-imagery': {
        type: 'raster',
        tiles: [ESRI_SATELLITE_TILES],
        tileSize: 256,
        maxzoom: satelliteMaxZoom,
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      },
    },
    layers: [
      {
        id: 'fallback-ground-background',
        type: 'background',
        paint: {
          'background-color': '#d9ecd0',
        },
      },
      {
        id: 'esri-satellite-base',
        type: 'raster',
        source: 'esri-world-imagery',
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 0,
        },
      },
    ],
  };
}

function getBasemapStyle(
  mode: MapStyleMode,
  useOsmFallback: boolean,
  satelliteMaxZoom: number
): string | maplibregl.StyleSpecification {
  if (mode === 'satellite') {
    return createSatelliteBaseStyle(satelliteMaxZoom);
  }
  if (mode === 'terrain') {
    return createTerrainBaseStyle();
  }
  return useOsmFallback
    ? createOsmFallbackStyle()
    : OPENFREEMAP_LIBERTY_STYLE_URL;
}

/**
 * Nền vũ trụ xanh đậm có sao mờ và quầng khí quyển xanh ngọc cho màn hình Quả địa cầu 3D
 */
const SpaceOceanBackdrop: React.FC<{
  visible: boolean;
  liteMode: boolean;
}> = ({ visible, liteMode }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (liteMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const starCount = window.innerWidth < 768 ? 90 : 150;
    const stars = Array.from({ length: starCount }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.4 + 0.4,
      alpha: Math.random() * 0.55 + 0.15,
      speed: Math.random() * 0.015 + 0.004,
      phase: Math.random() * Math.PI * 2,
    }));

    const render = (time: number) => {
      ctx.clearRect(0, 0, width, height);

      const grad = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.18,
        width / 2,
        height / 2,
        Math.min(width, height) * 0.62
      );
      grad.addColorStop(0, 'rgba(43, 143, 208, 0.26)');
      grad.addColorStop(0.45, 'rgba(20, 184, 166, 0.14)');
      grad.addColorStop(1, 'rgba(4, 24, 41, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      for (const s of stars) {
        const twinkle = s.alpha + Math.sin(time * s.speed + s.phase) * 0.22;
        ctx.globalAlpha = Math.max(0.08, Math.min(0.85, twinkle));
        ctx.fillStyle = '#e0f2fe';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [liteMode]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-700"
      style={{ opacity: visible ? 1 : 0 }}
    />
  );
};

interface GlobeCustomPinDatum {
  id: string;
  name: string;
  lat: number;
  lng: number;
  subType: FarmSubType | 'hub';
  category: FarmCategory | 'hub';
  isHub: boolean;
  isConnectable: boolean;
  isSelected: boolean;
  opacity: number;
  farm?: Farm;
}

interface GlobeArcDatum {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: [string, string];
}

// Bộ nhớ đệm THREE.CanvasTexture 256x256 siêu nét (Retina 4x) cho từng loại ghim icon trên Quả địa cầu 3D
const globeSpriteTextureCache = new Map<string, THREE.CanvasTexture>();

function configureSharpSpriteTexture(
  texture: THREE.CanvasTexture,
  maxAnisotropy: number
): THREE.CanvasTexture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = Math.max(1, maxAnisotropy);
  texture.needsUpdate = true;
  return texture;
}

function getGlobePinTexture(
  subType: FarmSubType | 'hub',
  isSelected: boolean,
  maxAnisotropy = 16
): THREE.CanvasTexture {
  const key = `${subType}-${isSelected ? 'selected' : 'normal'}`;
  const existing = globeSpriteTextureCache.get(key);
  if (existing) return existing;

  const { canvas } = createFarmPinCanvasSync(subType, isSelected, 4);
  const texture = configureSharpSpriteTexture(
    new THREE.CanvasTexture(canvas),
    maxAnisotropy
  );
  globeSpriteTextureCache.set(key, texture);
  return texture;
}

function refreshGlobeHubTextures(maxAnisotropy = 16): void {
  const variants: Array<{ key: string; isSelected: boolean }> = [
    { key: 'hub-normal', isSelected: false },
    { key: 'hub-selected', isSelected: true },
  ];
  for (const variant of variants) {
    const { canvas } = createFarmPinCanvasSync('hub', variant.isSelected, 4);
    const existing = globeSpriteTextureCache.get(variant.key);
    if (existing) {
      existing.image = canvas;
      configureSharpSpriteTexture(existing, maxAnisotropy);
    } else {
      globeSpriteTextureCache.set(
        variant.key,
        configureSharpSpriteTexture(
          new THREE.CanvasTexture(canvas),
          maxAnisotropy
        )
      );
    }
  }
}

export const MapScene = React.forwardRef<MapSceneHandle, MapSceneProps>(
  (
    {
      stage,
      logoUrl,
      farms,
      centralHub,
      customLabels,
      selectedFarm,
      isHubSelected,
      singleArcFarmId,
      mobileSheetSnap = 'half',
      onSelectFarm,
      onSelectHub,
      onClearSelection,
      onEnterMapOverview,
      activeCategories,
      searchQuery,
      biosecurityRadius,
      mapStyleMode,
      onSelectMapStyle,
      timeOfDay,
      liteMode,
      onSatelliteFallbackToStreet,
    },
    ref
  ) => {
    const globeContainerRef = useRef<HTMLDivElement | null>(null);
    const globeRef = useRef<GlobeInstance | null>(null);
    const globeSpritesMapRef = useRef<Map<string, THREE.Sprite>>(new Map());
    const maxAnisotropyRef = useRef<number>(16);

    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const isMapLoadedRef = useRef(false);

    const esriMaxZoomRef = useRef<number>(18);
    const tileErrorTimestampsRef = useRef<number[]>([]);
    const streetFallbackToOsmRef = useRef<boolean>(false);
    const streetErrorTimestampsRef = useRef<number[]>([]);
    const [usingOsmFallback, setUsingOsmFallback] = useState<boolean>(false);

    const [currentZoom, setCurrentZoom] = useState(6.2);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [hoveredTooltip, setHoveredTooltip] = useState<{
      name: string;
      badge?: string;
      x: number;
      y: number;
    } | null>(null);

    // Nạp sẵn Logo hoa sen thật (/logo.png) để vẽ sắc nét 256x256 vào giữa ghim Nhà Máy Cám
    useEffect(() => {
      preloadHubLogo(logoUrl, () => {
        refreshGlobeHubTextures(maxAnisotropyRef.current);
        if (mapRef.current && isMapLoadedRef.current) {
          refreshHubIconOnMap(mapRef.current);
        }
      });
    }, [logoUrl]);

    // Lưu toạ độ thực tế đang vẽ để đối chiếu trong "Kiểm tra vị trí"
    const renderedCoordsMapRef = useRef<
      Map<string, { lat: number; lng: number }>
    >(new Map());

    const visibleFarms = useMemo(
      () => farms.filter((f) => activeCategories[f.category]),
      [farms, activeCategories]
    );

    const normalizedQuery = searchQuery.trim().toLowerCase().normalize('NFC');
    const matchedFarmIds = useMemo(() => {
      if (!normalizedQuery) return new Set<string>();
      return new Set(
        farms
          .filter((f) => {
            const label = getLocationDisplayLabel(f, customLabels)
              .toLowerCase()
              .normalize('NFC');
            return (
              f.name.toLowerCase().normalize('NFC').includes(normalizedQuery) ||
              f.type.toLowerCase().normalize('NFC').includes(normalizedQuery) ||
              label.includes(normalizedQuery) ||
              f.description
                .toLowerCase()
                .normalize('NFC')
                .includes(normalizedQuery)
            );
          })
          .map((f) => f.id)
      );
    }, [farms, normalizedQuery, customLabels]);

    const latestStateRef = useRef({
      stage,
      visibleFarms,
      farms,
      centralHub,
      customLabels,
      selectedFarm,
      isHubSelected,
      singleArcFarmId,
      mobileSheetSnap,
      activeCategories,
      biosecurityRadius,
      timeOfDay,
      liteMode,
      onSelectFarm,
      onSelectHub,
      onClearSelection,
      onSatelliteFallbackToStreet,
    });

    latestStateRef.current = {
      stage,
      visibleFarms,
      farms,
      centralHub,
      customLabels,
      selectedFarm,
      isHubSelected,
      singleArcFarmId,
      mobileSheetSnap,
      activeCategories,
      biosecurityRadius,
      timeOfDay,
      liteMode,
      onSelectFarm,
      onSelectHub,
      onClearSelection,
      onSatelliteFallbackToStreet,
    };

    // Danh sách các trại Gà & Heo đang bật kết nối một chiều từ Nhà Máy Cám thật trong dữ liệu My Maps
    const activeTargetFarms = useMemo(() => {
      if (!centralHub) return [];
      const hubId = centralHub.id;
      if (isHubSelected) {
        return visibleFarms.filter(
          (f) =>
            !f.isFeedMill &&
            f.id !== hubId &&
            f.isConnectable &&
            (f.category === 'chicken' || f.category === 'pig')
        );
      }
      if (singleArcFarmId) {
        return visibleFarms.filter(
          (f) =>
            f.id === singleArcFarmId &&
            !f.isFeedMill &&
            f.id !== hubId &&
            f.isConnectable &&
            (f.category === 'chicken' || f.category === 'pig')
        );
      }
      return [];
    }, [centralHub, isHubSelected, singleArcFarmId, visibleFarms]);

    // Dữ liệu ghim icon 3D (`customLayerData`) trên Quả địa cầu 3D (`globe.gl`) — CHỈ gồm các điểm thật từ My Maps
    const globePinData = useMemo<GlobeCustomPinDatum[]>(() => {
      const hasSearch = normalizedQuery.length > 0;
      const items: GlobeCustomPinDatum[] = [];

      for (const f of farms) {
        const isHub = Boolean(
          f.isFeedMill ||
            f.subType === 'hub' ||
            (centralHub?.id && f.id === centralHub.id)
        );
        // Luôn hiển thị Nhà Máy Cám làm tâm mạng lưới, còn các điểm khác tuân theo bộ lọc chip
        if (!isHub && !activeCategories[f.category]) continue;

        let coords: [number, number] = [Number(f.lng), Number(f.lat)];
        if (Math.abs(coords[0]) < 30 && Math.abs(coords[1]) >= 30) {
          coords = [coords[1], coords[0]];
        }
        const [exactLng, exactLat] = coords;

        const isConnectable =
          !isHub &&
          Boolean(f.isConnectable) &&
          (f.category === 'chicken' || f.category === 'pig');

        let opacity = 1;
        if (isHub) {
          opacity = hasSearch && !matchedFarmIds.has(f.id) ? 0.72 : 1;
        } else if (isHubSelected && !isConnectable) {
          opacity = 0.35;
        } else if (hasSearch && !matchedFarmIds.has(f.id)) {
          opacity = 0.35;
        }

        items.push({
          id: f.id,
          name: f.name,
          lat: exactLat,
          lng: exactLng,
          subType: isHub ? 'hub' : f.subType || f.category,
          category: isHub ? 'hub' : f.category,
          isHub,
          isConnectable,
          isSelected: isHub ? isHubSelected : selectedFarm?.id === f.id,
          opacity,
          farm: f,
        });
      }

      return items;
    }, [
      farms,
      centralHub,
      activeCategories,
      isHubSelected,
      selectedFarm,
      normalizedQuery,
      matchedFarmIds,
    ]);

    // Dữ liệu đường cung đốm sáng một chiều từ Nhà Máy Cám thật ➔ Trại Gà & Trại Heo trên Quả địa cầu 3D
    const globeArcsData = useMemo<GlobeArcDatum[]>(() => {
      if (!centralHub || activeTargetFarms.length === 0) return [];
      let hubCoords: [number, number] = [
        Number(centralHub.lng),
        Number(centralHub.lat),
      ];
      if (Math.abs(hubCoords[0]) < 30 && Math.abs(hubCoords[1]) >= 30) {
        hubCoords = [hubCoords[1], hubCoords[0]];
      }
      const [hubLng, hubLat] = hubCoords;

      return activeTargetFarms.map((farm) => {
        let coords: [number, number] = [Number(farm.lng), Number(farm.lat)];
        if (Math.abs(coords[0]) < 30 && Math.abs(coords[1]) >= 30) {
          coords = [coords[1], coords[0]];
        }
        const [farmLng, farmLat] = coords;
        const isPig = farm.category === 'pig';

        return {
          id: `globe-arc-${farm.id}`,
          startLat: hubLat,
          startLng: hubLng,
          endLat: farmLat,
          endLng: farmLng,
          color: ['#facc15', isPig ? '#fb7185' : '#fb923c'],
        };
      });
    }, [activeTargetFarms, centralHub]);

    useImperativeHandle(ref, () => ({
      flyToFarm: (farm: Farm, zoom = 14.5) => {
        const map = mapRef.current;
        if (!map) return;
        let coords: [number, number] = [Number(farm.lng), Number(farm.lat)];
        if (Math.abs(coords[0]) < 30 && Math.abs(coords[1]) >= 30) {
          coords = [coords[1], coords[0]];
        }
        const [targetLng, targetLat] = coords;
        const clampedZoom = Math.min(zoom, 16.5);

        const padding = computeCameraPadding(
          true,
          latestStateRef.current.mobileSheetSnap
        );

        map.resize();
        map.flyTo({
          center: [targetLng, targetLat],
          zoom: clampedZoom,
          pitch: 0,
          bearing: 0,
          padding,
          duration: 1500,
          essential: true,
        });
      },
      flyToOverview: (duration = 1600) => {
        const map = mapRef.current;
        if (!map) return;
        const { center, zoom } = getSystemCenterAndZoom(
          visibleFarms.length > 0 ? visibleFarms : farms,
          centralHub
        );
        const clampedZoom = Math.min(zoom, 16.5);
        map.resize();
        map.flyTo({
          center,
          zoom: clampedZoom,
          pitch: 0,
          bearing: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          duration,
          essential: true,
        });
      },
      flyToHub: () => {
        if (!centralHub) return;
        const map = mapRef.current;
        if (map && latestStateRef.current.stage === 'map') {
          const hubLng = Number(centralHub.lng);
          const hubLat = Number(centralHub.lat);
          const padding = computeCameraPadding(
            true,
            latestStateRef.current.mobileSheetSnap
          );
          map.resize();
          map.flyTo({
            center: [hubLng, hubLat],
            zoom: 13.5,
            pitch: 0,
            bearing: 0,
            padding,
            duration: 1500,
            essential: true,
          });
        }
        if (globeRef.current && latestStateRef.current.stage === 'globe') {
          globeRef.current.pointOfView(
            {
              lat: Number(centralHub.lat),
              lng: Number(centralHub.lng),
              altitude: 0.72,
            },
            1300
          );
        }
      },
      flyToConnectedOverview: () => {
        const connectableList = visibleFarms.filter(
          (f) =>
            f.isConnectable &&
            (f.category === 'chicken' || f.category === 'pig')
        );
        const listForBounds =
          connectableList.length > 0 ? connectableList : visibleFarms;
        const { center, zoom } = getSystemCenterAndZoom(
          listForBounds,
          centralHub
        );

        // Nếu đang ở Quả địa cầu 3D: xoay mượt tới vùng phủ Việt Nam để thấy rõ các đốm sáng chạy trên Địa cầu
        if (globeRef.current) {
          globeRef.current.pointOfView(
            {
              lat: center[1],
              lng: center[0],
              altitude: 0.85,
            },
            1400
          );
        }

        // Đồng bộ sẵn góc nhìn bao quát trên Bản đồ 2D phẳng (pitch: 0)
        const map = mapRef.current;
        if (map) {
          const padding = computeCameraPadding(
            true,
            latestStateRef.current.mobileSheetSnap
          );
          const targetZoom = Math.min(Math.max(zoom - 0.25, 7.2), 13.8);
          map.resize();
          map.flyTo({
            center,
            zoom: targetZoom,
            pitch: 0,
            bearing: 0,
            padding,
            duration: 1500,
            essential: true,
          });
        }
      },
      flyToGlobe: () => {
        if (globeRef.current) {
          globeRef.current.pointOfView(
            {
              lat: 14.5,
              lng: 106.8,
              altitude: 1.75,
            },
            1500
          );
        }
      },
      resetToInitialView: (targetStage: AppStage) => {
        if (globeRef.current) {
          globeRef.current.pointOfView(
            {
              lat: 14.5,
              lng: 106.8,
              altitude: 1.75,
            },
            1400
          );
        }
        const map = mapRef.current;
        if (map && targetStage === 'map') {
          const allPoints = latestStateRef.current.farms;
          const hub = latestStateRef.current.centralHub;
          const { center, zoom } = getSystemCenterAndZoom(allPoints, hub);
          const clampedZoom = Math.min(zoom, 16.5);
          map.resize();
          map.flyTo({
            center,
            zoom: clampedZoom,
            pitch: 0,
            bearing: 0,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            duration: 1600,
            essential: true,
          });
        }
      },
      clearCameraPadding: () => {
        const map = mapRef.current;
        if (!map || !isMapLoadedRef.current) return;
        try {
          map.easeTo({
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            duration: 400,
          });
        } catch {
          // ignore
        }
      },
      getPositionDiagnostics: (): PositionDiagnosticItem[] => {
        const items: PositionDiagnosticItem[] = [];
        const hub = latestStateRef.current.centralHub;

        for (const f of latestStateRef.current.farms) {
          const isHub = Boolean(
            f.isFeedMill ||
              f.subType === 'hub' ||
              (hub?.id && f.id === hub.id)
          );
          const rendered = renderedCoordsMapRef.current.get(f.id) || {
            lat: f.lat,
            lng: f.lng,
          };
          const devMeters =
            calculateDistanceKm(f.lat, f.lng, rendered.lat, rendered.lng) *
            1000;
          items.push({
            id: f.id,
            name: f.name,
            isHub,
            category: isHub ? 'hub' : f.category,
            rawLat: f.lat,
            rawLng: f.lng,
            renderedLat: rendered.lat,
            renderedLng: rendered.lng,
            deviationMeters: devMeters,
            isAccurate: devMeters < 1,
          });
        }
        return items;
      },
    }));

    // =========================================================================
    // 1. KHỞI TẠO QUẢ ĐỊA CẦU 3D (`globe.gl`) — LUÔN HIỂN THỊ GHIM ICON TỪ XA TỚI GẦN
    // =========================================================================
    useEffect(() => {
      const container = globeContainerRef.current;
      if (!container || globeRef.current) return;

      const globe = new Globe(container, {
        animateIn: false,
      })
        .width(container.clientWidth || window.innerWidth)
        .height(container.clientHeight || window.innerHeight)
        .backgroundColor('rgba(0,0,0,0)')
        .globeImageUrl(GLOBE_EARTH_TEXTURE_URL)
        .bumpImageUrl(GLOBE_BUMP_TEXTURE_URL)
        .showAtmosphere(true)
        .atmosphereColor('#38bdf8')
        .atmosphereAltitude(0.18)
        // Custom 3D Sprite Layer: Hiển thị trực tiếp các ghim icon ở MỌI mức zoom (từ xa tới gần)
        .customLayerData([])
        .customThreeObject((d: object) => {
          const item = d as GlobeCustomPinDatum;
          const texture = getGlobePinTexture(
            item.subType,
            item.isSelected,
            maxAnisotropyRef.current
          );
          const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: item.opacity,
            depthTest: false,
            depthWrite: false,
          });
          const sprite = new THREE.Sprite(material);
          // Đặt tâm neo ở chính giữa đáy mũi ghim (0.5, 0) để mũi ghim chỉ chính xác 100% vào tọa độ gốc
          sprite.center.set(0.5, 0);
          sprite.renderOrder = item.isHub
            ? 1000
            : item.isSelected
            ? 999
            : Math.round(90 - item.lat);
          (sprite as THREE.Sprite & { __pinData?: GlobeCustomPinDatum }).__pinData =
            item;
          globeSpritesMapRef.current.set(item.id, sprite);
          return sprite;
        })
        .customThreeObjectUpdate((obj: THREE.Object3D, d: object) => {
          const item = d as GlobeCustomPinDatum;
          const sprite = obj as THREE.Sprite & {
            __pinData?: GlobeCustomPinDatum;
          };
          sprite.__pinData = item;
          globeSpritesMapRef.current.set(item.id, sprite);

          // Đặt đúng tọa độ địa lý với độ cao 0.012 để bám cố định 100% trên mặt cầu khi xoay/zoom
          const coords = globe.getCoords(item.lat, item.lng, 0.012);
          if (coords) {
            sprite.position.set(coords.x, coords.y, coords.z);
          }

          const mat = sprite.material as THREE.SpriteMaterial;
          const nextTex = getGlobePinTexture(
            item.subType,
            item.isSelected,
            maxAnisotropyRef.current
          );
          if (mat.map !== nextTex) {
            mat.map = nextTex;
            mat.needsUpdate = true;
          }
          mat.opacity = item.opacity;
          sprite.renderOrder = item.isHub
            ? 1000
            : item.isSelected
            ? 999
            : Math.round(90 - item.lat);
        })
        .onCustomLayerClick((obj: object) => {
          const item = obj as GlobeCustomPinDatum;
          if (!item) return;
          if (item.isHub) {
            latestStateRef.current.onSelectHub();
          } else if (item.farm) {
            latestStateRef.current.onSelectFarm(item.farm);
          }
        })
        .onCustomLayerHover((obj: object | null) => {
          const item = obj as GlobeCustomPinDatum | null;
          if (container) {
            container.style.cursor = item ? 'pointer' : 'grab';
          }
          setHoveredId(item ? item.id : null);
        })
        // Đường cung đốm sáng chạy liên tục một chiều từ Nhà Máy Cám ➔ Trại Gà & Trại Heo
        .arcsData([])
        .arcStartLat((d: object) => (d as GlobeArcDatum).startLat)
        .arcStartLng((d: object) => (d as GlobeArcDatum).startLng)
        .arcEndLat((d: object) => (d as GlobeArcDatum).endLat)
        .arcEndLng((d: object) => (d as GlobeArcDatum).endLng)
        .arcColor((d: object) => (d as GlobeArcDatum).color)
        .arcAltitudeAutoScale(0.38)
        .arcStroke(0.5)
        .arcDashLength(0.18)
        .arcDashGap(0.82)
        .arcDashInitialGap(() => Math.random())
        .arcDashAnimateTime(1600);

      // Bật bộ lọc anisotropic cao nhất của WebGL renderer để ghim icon 3D luôn sắc nét ở mọi góc nhìn
      try {
        const renderer = globe.renderer();
        if (renderer?.capabilities?.getMaxAnisotropy) {
          const maxAniso = renderer.capabilities.getMaxAnisotropy();
          maxAnisotropyRef.current = maxAniso;
          globeSpriteTextureCache.forEach((tex) => {
            tex.anisotropy = maxAniso;
            tex.needsUpdate = true;
          });
        }
      } catch {
        // ignore
      }

      // Đặt góc nhìn khởi tạo hướng về Việt Nam / Đông Nam Á
      globe.pointOfView(
        {
          lat: 14.5,
          lng: 106.8,
          altitude: 1.75,
        },
        0
      );

      // Cấu hình điều khiển xoay mượt và giới hạn zoom trên Địa cầu
      const controls = globe.controls();
      if (controls) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.45;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 118;
        controls.maxDistance = 460;
      }

      globeRef.current = globe;

      // Vòng lặp cập nhật kích thước (scale) của các THREE.Sprite theo khoảng cách camera
      // để từ nhìn xa toàn cầu cho tới phóng sát Việt Nam đều rõ nét, không che khuất nhau và không bao giờ biến mất
      let scaleAnimId: number;
      const updateSpriteScales = () => {
        const g = globeRef.current;
        if (g) {
          const cam = g.camera();
          const dist = cam ? cam.position.length() : 250;
          // Khoảng cách tâm Trái đất (bán kính chuẩn R=100): dist ~ 120 (gần) -> 380 (xa)
          const altitudeRatio = Math.max(0.15, (dist - 100) / 100);
          // Scale tỷ lệ thuận nhẹ với căn bậc hai của độ cao để nhìn xa vẫn to rõ và zoom sát thì tách rời nhau
          const baseScale = Math.max(
            2.6,
            Math.min(11.5, Math.pow(altitudeRatio, 0.72) * 5.8)
          );

          globeSpritesMapRef.current.forEach((sprite) => {
            const pin = (
              sprite as THREE.Sprite & { __pinData?: GlobeCustomPinDatum }
            ).__pinData;
            const mult = pin?.isHub ? 1.24 : pin?.isSelected ? 1.22 : 1.0;
            const s = baseScale * mult;
            sprite.scale.set(s, s, 1);
          });
        }
        scaleAnimId = requestAnimationFrame(updateSpriteScales);
      };
      scaleAnimId = requestAnimationFrame(updateSpriteScales);

      const handleResize = () => {
        if (!globeRef.current || !globeContainerRef.current) return;
        globeRef.current
          .width(globeContainerRef.current.clientWidth || window.innerWidth)
          .height(globeContainerRef.current.clientHeight || window.innerHeight);
      };

      window.addEventListener('resize', handleResize);
      return () => {
        cancelAnimationFrame(scaleAnimId);
        window.removeEventListener('resize', handleResize);
        globeRef.current = null;
      };
    }, []);

    // Đồng bộ danh sách ghim icon (`customLayerData`) lên Quả địa cầu 3D mỗi khi lọc/dữ liệu thay đổi
    useEffect(() => {
      const globe = globeRef.current;
      if (!globe) return;
      globeSpritesMapRef.current.clear();
      globe.customLayerData(globePinData);
    }, [globePinData]);

    // Đồng bộ luồng đốm sáng (`arcsData`) từ Nhà máy trung tâm ➔ Trại Gà & Trại Heo trên Quả địa cầu 3D
    useEffect(() => {
      const globe = globeRef.current;
      if (!globe) return;
      globe.arcsData(globeArcsData);
    }, [globeArcsData]);

    // Bật/tắt tự xoay Quả địa cầu khi đang mở thẻ thông tin hoặc khi chuyển sang bản đồ 2D
    useEffect(() => {
      const globe = globeRef.current;
      if (!globe) return;
      const controls = globe.controls();
      if (!controls) return;
      controls.autoRotate =
        stage === 'globe' && !selectedFarm && !isHubSelected;
    }, [stage, selectedFarm, isHubSelected]);

    // =========================================================================
    // 2. BẢN ĐỒ PHẲNG 2D NHẸ (MAPLIBRE GL — PITCH: 0, OPENSTREETMAP GỐC)
    // =========================================================================
    const buildFarmsSourceGeoJSON = useCallback(
      (
        allFarms: Farm[],
        hub: CentralHub | null,
        labels?: FarmCustomLabels
      ) => {
        renderedCoordsMapRef.current.clear();

        const features = allFarms.map((f) => {
          let coords: [number, number] = [Number(f.lng), Number(f.lat)];
          if (Math.abs(coords[0]) < 30 && Math.abs(coords[1]) >= 30) {
            coords = [coords[1], coords[0]];
          }
          const [exactLng, exactLat] = coords;

          renderedCoordsMapRef.current.set(f.id, {
            lat: exactLat,
            lng: exactLng,
          });

          const isHub = Boolean(
            f.isFeedMill ||
              f.subType === 'hub' ||
              (hub?.id && f.id === hub.id)
          );
          const iconKey = isHub
            ? 'farm-icon-hub'
            : f.subType
            ? `farm-icon-${f.subType}`
            : `farm-icon-${f.category}`;
          const markerAlias = isHub
            ? 'marker-factory'
            : f.category === 'chicken'
            ? 'marker-chicken'
            : f.category === 'pig'
            ? 'marker-pig'
            : 'marker-other';
          const catColor = isHub ? '#2b8fd0' : getCategoryConfig(f.category).hex;
          const displayLabel = getLocationDisplayLabel(f, labels);

          return {
            type: 'Feature' as const,
            properties: {
              id: f.id,
              name: f.name,
              displayLabel,
              category: isHub ? 'hub' : f.category,
              isHub,
              isConnectable: isHub ? false : Boolean(f.isConnectable),
              iconImage: iconKey,
              markerIcon: markerAlias,
              color: catColor,
              lat: exactLat,
              lng: exactLng,
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [exactLng, exactLat],
            },
          };
        });

        return {
          type: 'FeatureCollection' as const,
          features,
        };
      },
      []
    );

    const applyLayerFiltersAndStyles = useCallback(
      (
        map: maplibregl.Map,
        cats: Record<FarmCategory, boolean>,
        curSelectedId: string | null,
        curHubSelected: boolean,
        curHubId: string | null,
        curHoveredId: string | null,
        curQuery: string,
        curMatchedIds: Set<string>,
        curLite: boolean
      ) => {
        const allowedCategories: string[] = ['hub'];
        if (cats.chicken) allowedCategories.push('chicken');
        if (cats.pig) allowedCategories.push('pig');
        if (cats.other) allowedCategories.push('other');

        const categoryFilter: maplibregl.FilterSpecification = [
          'in',
          ['get', 'category'],
          ['literal', allowedCategories],
        ];

        const labelFilter: maplibregl.FilterSpecification = [
          'all',
          ['!=', ['get', 'isHub'], true],
          ['in', ['get', 'category'], ['literal', allowedCategories]],
        ];

        const activeSelectedId = curSelectedId
          ? curSelectedId
          : curHubSelected && curHubId
          ? curHubId
          : '__NONE__';

        const selectedFilter: maplibregl.FilterSpecification = [
          '==',
          ['get', 'id'],
          activeSelectedId,
        ];

        try {
          if (map.getLayer('farm-icons')) {
            map.setFilter('farm-icons', categoryFilter);
          }
          if (map.getLayer('farm-dots')) {
            map.setFilter('farm-dots', categoryFilter);
          }
          if (map.getLayer('farm-pulse')) {
            map.setFilter('farm-pulse', categoryFilter);
            map.setLayoutProperty(
              'farm-pulse',
              'visibility',
              curLite ? 'none' : 'visible'
            );
          }
          if (map.getLayer('farm-labels')) {
            map.setFilter('farm-labels', labelFilter);
          }
          if (map.getLayer('farm-selected')) {
            map.setFilter('farm-selected', selectedFilter);
          }
          if (map.getLayer('farm-selected-ring')) {
            map.setFilter('farm-selected-ring', selectedFilter);
          }

          const hasSearch = curQuery.length > 0;
          const matchedArray = Array.from(curMatchedIds);

          let featureAlphaExpr: maplibregl.ExpressionSpecification | number = 1;
          if (curHubSelected) {
            featureAlphaExpr = [
              'case',
              ['boolean', ['get', 'isHub'], false],
              1,
              ['boolean', ['get', 'isConnectable'], false],
              1,
              0.35,
            ];
          } else if (hasSearch) {
            featureAlphaExpr = [
              'case',
              ['in', ['get', 'id'], ['literal', matchedArray]],
              1,
              ['boolean', ['get', 'isHub'], false],
              0.72,
              0.35,
            ];
          }

          if (map.getLayer('farm-icons')) {
            map.setPaintProperty('farm-icons', 'icon-opacity', featureAlphaExpr);
          }

          if (map.getLayer('farm-dots')) {
            map.setPaintProperty(
              'farm-dots',
              'circle-opacity',
              featureAlphaExpr
            );
            map.setPaintProperty(
              'farm-dots',
              'circle-stroke-opacity',
              featureAlphaExpr
            );
          }

          if (map.getLayer('hub-label')) {
            const forceShowHubLabel =
              curHubSelected || (curHubId !== null && curHoveredId === curHubId);
            map.setPaintProperty(
              'hub-label',
              'text-opacity',
              forceShowHubLabel
                ? 1
                : [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    7.5,
                    0,
                    8.5,
                    1,
                  ]
            );
          }
        } catch {
          // ignore
        }
      },
      []
    );

    const setupCustomLayers = useCallback(
      (map: maplibregl.Map) => {
        const {
          farms: allFarms,
          visibleFarms: curVisibleFarms,
          centralHub: curHub,
          customLabels: curLabels,
          selectedFarm: curSelected,
          isHubSelected: curHubSelected,
          activeCategories: curCats,
          biosecurityRadius: curRadius,
          liteMode: curLite,
        } = latestStateRef.current;

        // Bản đồ 2D phẳng nhẹ: luôn dùng phép chiếu phẳng mercator
        try {
          map.setProjection({ type: 'mercator' });
        } catch {
          // ignore
        }

        // Đăng ký ĐỒNG BỘ 100% toàn bộ ảnh icon 3D (Canvas 2D 64x64)
        registerMapLibreFarmIcons(map);

        // Vòng bán kính an toàn sinh học
        const bioGeoJSON = buildBiosecurityGeoJSON(
          curVisibleFarms,
          curRadius,
          0.5
        );
        if (!map.getSource('biosecurity-zones')) {
          map.addSource('biosecurity-zones', {
            type: 'geojson',
            data: bioGeoJSON,
          });
        }

        if (!map.getLayer('biosecurity-outer-glow')) {
          map.addLayer({
            id: 'biosecurity-outer-glow',
            type: 'line',
            source: 'biosecurity-zones',
            filter: ['==', ['get', 'ringType'], 'outer'],
            paint: {
              'line-color': '#10b981',
              'line-width': 3.5,
              'line-blur': 2,
              'line-opacity': 0.5,
            },
          });
        }

        if (!map.getLayer('biosecurity-outer-line')) {
          map.addLayer({
            id: 'biosecurity-outer-line',
            type: 'line',
            source: 'biosecurity-zones',
            filter: ['==', ['get', 'ringType'], 'outer'],
            paint: {
              'line-color': '#10b981',
              'line-width': 2,
              'line-opacity': 0.9,
            },
          });
        }

        // Nguồn GeoJSON đường cong Bezier & hạt đốm sáng cung ứng chạy một chiều từ Nhà máy -> Trại Gà / Trại Heo
        const emptyCollection = {
          type: 'FeatureCollection' as const,
          features: [],
        };
        if (!map.getSource('supply-bezier-arcs')) {
          map.addSource('supply-bezier-arcs', {
            type: 'geojson',
            data: emptyCollection,
          });
        }
        if (!map.getSource('supply-particles')) {
          map.addSource('supply-particles', {
            type: 'geojson',
            data: emptyCollection,
          });
        }
        if (!map.getSource('supply-impact-rings')) {
          map.addSource('supply-impact-rings', {
            type: 'geojson',
            data: emptyCollection,
          });
        }

        if (!map.getLayer('supply-bezier-glow')) {
          map.addLayer({
            id: 'supply-bezier-glow',
            type: 'line',
            source: 'supply-bezier-arcs',
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                5,
                3.5,
                10,
                5,
                15,
                7,
              ],
              'line-blur': 2,
              'line-opacity': ['get', 'glowOpacity'],
            },
          });
        }

        if (!map.getLayer('supply-bezier-core')) {
          map.addLayer({
            id: 'supply-bezier-core',
            type: 'line',
            source: 'supply-bezier-arcs',
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': ['get', 'coreColor'],
              'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                5,
                1.5,
                10,
                2.2,
                15,
                3.0,
              ],
              'line-opacity': ['get', 'coreOpacity'],
            },
          });
        }

        if (!map.getLayer('supply-impact-rings-layer')) {
          map.addLayer({
            id: 'supply-impact-rings-layer',
            type: 'circle',
            source: 'supply-impact-rings',
            paint: {
              'circle-pitch-alignment': 'map',
              'circle-radius': ['get', 'radius'],
              'circle-color': ['get', 'color'],
              'circle-opacity': ['get', 'fillOpacity'],
              'circle-stroke-width': ['get', 'strokeWidth'],
              'circle-stroke-color': ['get', 'strokeColor'],
              'circle-stroke-opacity': ['get', 'strokeOpacity'],
            },
          });
        }

        if (!map.getLayer('supply-particles-glow')) {
          map.addLayer({
            id: 'supply-particles-glow',
            type: 'circle',
            source: 'supply-particles',
            paint: {
              'circle-pitch-alignment': 'map',
              'circle-radius': ['get', 'glowRadius'],
              'circle-color': ['get', 'color'],
              'circle-blur': 0.5,
              'circle-opacity': ['get', 'glowOpacity'],
            },
          });
        }

        if (!map.getLayer('supply-particles-core')) {
          map.addLayer({
            id: 'supply-particles-core',
            type: 'circle',
            source: 'supply-particles',
            paint: {
              'circle-pitch-alignment': 'map',
              'circle-radius': ['get', 'coreRadius'],
              'circle-color': '#fef08a',
              'circle-stroke-width': 1.2,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': ['get', 'coreOpacity'],
              'circle-stroke-opacity': ['get', 'coreOpacity'],
            },
          });
        }

        // Nguồn GeoJSON duy nhất "farms" cho toàn bộ điểm thật từ My Maps (bao gồm Nhà Máy Cám)
        const farmsGeoJSON = buildFarmsSourceGeoJSON(allFarms, curHub, curLabels);
        if (!map.getSource('farms')) {
          map.addSource('farms', {
            type: 'geojson',
            data: farmsGeoJSON,
          });
        } else {
          const src = map.getSource('farms') as
            | maplibregl.GeoJSONSource
            | undefined;
          src?.setData(farmsGeoJSON);
        }

        if (!map.getLayer('farm-pulse')) {
          map.addLayer({
            id: 'farm-pulse',
            type: 'circle',
            source: 'farms',
            layout: {
              visibility: curLite ? 'none' : 'visible',
            },
            paint: {
              'circle-pitch-alignment': 'map',
              'circle-radius': 10,
              'circle-color': ['get', 'color'],
              'circle-opacity': 0.2,
            },
          });
        }

        if (!map.getLayer('farm-dots')) {
          map.addLayer({
            id: 'farm-dots',
            type: 'circle',
            source: 'farms',
            paint: {
              'circle-pitch-alignment': 'viewport',
              'circle-radius': 4,
              'circle-color': ['get', 'color'],
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
            },
          });
        }

        if (!map.getLayer('farm-selected-ring')) {
          map.addLayer({
            id: 'farm-selected-ring',
            type: 'circle',
            source: 'farms',
            filter: ['==', ['get', 'id'], '__NONE__'],
            paint: {
              'circle-pitch-alignment': 'map',
              'circle-radius': 20,
              'circle-color': '#facc15',
              'circle-opacity': 0.3,
              'circle-stroke-width': 2.5,
              'circle-stroke-color': '#facc15',
              'circle-stroke-opacity': 0.95,
            },
          });
        }

        const deviceFactor = getDeviceSizeFactor();

        if (!map.getLayer('farm-labels')) {
          map.addLayer({
            id: 'farm-labels',
            type: 'symbol',
            source: 'farms',
            minzoom: 11,
            filter: ['!=', ['get', 'isHub'], true],
            layout: {
              'text-field': ['get', 'name'],
              'text-font': ['Noto Sans Regular'],
              'text-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                11,
                10.5,
                15,
                12.5,
              ],
              'text-anchor': 'top',
              'text-offset': [0, 0.35],
              'text-max-width': 14,
              'text-optional': true,
              'text-allow-overlap': false,
            },
            paint: {
              'text-color': '#0f2a24',
              'text-halo-color': '#ffffff',
              'text-halo-width': 2,
              'text-halo-blur': 0.5,
            },
          });
        }

        if (!map.getLayer('hub-label')) {
          map.addLayer({
            id: 'hub-label',
            type: 'symbol',
            source: 'farms',
            filter: ['==', ['get', 'isHub'], true],
            layout: {
              'text-field': ['get', 'name'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 11.5,
              'text-anchor': 'left',
              'text-offset': [1.4, -1.2],
              'text-optional': true,
              'text-allow-overlap': false,
            },
            paint: {
              'text-color': '#0f2a24',
              'text-halo-color': '#ffffff',
              'text-halo-width': 2.2,
              'text-opacity': 1,
            },
          });
        }

        // Layer symbol "farm-icons": Ghim 3D siêu nét 256x256 (pixelRatio: 4), Nhà Máy Cám lớn hơn 1.25x
        if (!map.getLayer('farm-icons')) {
          const hubMult: maplibregl.ExpressionSpecification = [
            'case',
            ['boolean', ['get', 'isHub'], false],
            1.25,
            1,
          ];
          map.addLayer({
            id: 'farm-icons',
            type: 'symbol',
            source: 'farms',
            layout: {
              'icon-image': ['get', 'iconImage'],
              'icon-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                2,
                ['*', 0.58 * deviceFactor, hubMult],
                6,
                ['*', 0.68 * deviceFactor, hubMult],
                10,
                ['*', 0.78 * deviceFactor, hubMult],
                14,
                ['*', 0.9 * deviceFactor, hubMult],
                18,
                ['*', 0.96 * deviceFactor, hubMult],
              ],
              'icon-anchor': 'bottom',
              'icon-offset': [0, 0],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-pitch-alignment': 'viewport',
              'icon-rotation-alignment': 'viewport',
              'symbol-sort-key': [
                'case',
                ['boolean', ['get', 'isHub'], false],
                1000,
                ['-', 90, ['get', 'lat']],
              ],
            },
            paint: {
              'icon-opacity': 1,
            },
          });
        }

        if (!map.getLayer('farm-selected')) {
          const hubSelMult: maplibregl.ExpressionSpecification = [
            'case',
            ['boolean', ['get', 'isHub'], false],
            1.2,
            1,
          ];
          map.addLayer({
            id: 'farm-selected',
            type: 'symbol',
            source: 'farms',
            filter: ['==', ['get', 'id'], '__NONE__'],
            layout: {
              'icon-image': ['get', 'iconImage'],
              'icon-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                2,
                ['*', 0.58 * 1.25 * deviceFactor, hubSelMult],
                6,
                ['*', 0.68 * 1.25 * deviceFactor, hubSelMult],
                10,
                ['*', 0.78 * 1.25 * deviceFactor, hubSelMult],
                14,
                ['*', 0.9 * 1.25 * deviceFactor, hubSelMult],
                18,
                ['*', 0.96 * 1.25 * deviceFactor, hubSelMult],
              ],
              'icon-anchor': 'bottom',
              'icon-offset': [0, 0],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-pitch-alignment': 'viewport',
              'icon-rotation-alignment': 'viewport',
            },
            paint: {
              'icon-opacity': 1,
            },
          });
        }

        applyLayerFiltersAndStyles(
          map,
          curCats,
          curSelected?.id || null,
          curHubSelected,
          curHub?.id || null,
          null,
          '',
          new Set(),
          curLite
        );
      },
      [applyLayerFiltersAndStyles, buildFarmsSourceGeoJSON]
    );

    // Khởi tạo Bản đồ 2D (MapLibre GL — mặc định OpenFreeMap Liberty giống Google My Maps, có chuyển Địa hình & Vệ tinh)
    useEffect(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      const initialStyle = getBasemapStyle(
        mapStyleMode,
        streetFallbackToOsmRef.current,
        esriMaxZoomRef.current
      );

      const { center, zoom } = getSystemCenterAndZoom(farms, centralHub);

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: initialStyle,
        center,
        zoom: Math.min(zoom, 15),
        minZoom: 2,
        maxZoom: 18,
        pitch: 0,
        bearing: 0,
        maxPitch: 0,
        dragRotate: false,
        touchPitch: false,
        pixelRatio: getOptimalPixelRatio(liteMode),
        maxTileCacheSize: 512,
        fadeDuration: 0,
        refreshExpiredTiles: false,
        attributionControl: false,
      });

      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        'bottom-left'
      );

      map.on('styleimagemissing', (e) => {
        if (e?.id) {
          addSingleFarmIconToMap(map, e.id);
        }
      });

      const activateOsmFallback = () => {
        if (streetFallbackToOsmRef.current) return;
        streetFallbackToOsmRef.current = true;
        setUsingOsmFallback(true);
        const savedCenter = map.getCenter();
        const savedZoom = map.getZoom();
        map.setStyle(createOsmFallbackStyle());
        map.once('style.load', () => {
          registerMapLibreFarmIcons(map);
          map.jumpTo({
            center: savedCenter,
            zoom: savedZoom,
            pitch: 0,
            bearing: 0,
          });
          setupCustomLayers(map);
        });
      };

      map.on(
        'error',
        (errEvent: maplibregl.ErrorEvent & { sourceId?: string }) => {
          const sourceId = errEvent?.sourceId || '';
          const errMsg = String(errEvent?.error?.message || '').toLowerCase();

          // 1. Nếu OpenFreeMap Liberty tải lỗi -> tự động quay về OpenStreetMap gốc (không API Key)
          if (
            currentStyleModeRef.current === 'street' &&
            !streetFallbackToOsmRef.current
          ) {
            const isStreetStyleError =
              errMsg.includes('openfreemap') ||
              errMsg.includes('style') ||
              errMsg.includes('failed to fetch') ||
              sourceId === 'openmaptiles';

            if (isStreetStyleError) {
              const now = Date.now();
              const recent = streetErrorTimestampsRef.current.filter(
                (ts) => now - ts <= 10_000
              );
              recent.push(now);
              streetErrorTimestampsRef.current = recent;

              if (recent.length >= 2 || errMsg.includes('failed to fetch')) {
                streetErrorTimestampsRef.current = [];
                activateOsmFallback();
              }
            }
            return;
          }

          // 2. Nếu lớp Địa hình hoặc Vệ tinh Esri tải lỗi -> tự động quay về Bản đồ đường mặc định
          if (
            currentStyleModeRef.current !== 'satellite' &&
            currentStyleModeRef.current !== 'terrain'
          ) {
            return;
          }

          const isEsriTileError =
            sourceId === 'esri-world-imagery' ||
            sourceId === 'esri-world-topo' ||
            errMsg.includes('arcgisonline') ||
            errMsg.includes('world_imagery') ||
            errMsg.includes('world_topo') ||
            errMsg.includes('tile');

          if (!isEsriTileError) return;

          const now = Date.now();
          const recent = tileErrorTimestampsRef.current.filter(
            (ts) => now - ts <= 10_000
          );
          recent.push(now);
          tileErrorTimestampsRef.current = recent;

          if (recent.length >= 4) {
            tileErrorTimestampsRef.current = [];
            latestStateRef.current.onSatelliteFallbackToStreet?.();
          }
        }
      );

      const queryInteractiveFeatureAtPoint = (point: maplibregl.Point) => {
        const activeLayers = [
          'farm-selected',
          'farm-icons',
          'farm-dots',
        ].filter((id) => Boolean(map.getLayer(id)));

        if (activeLayers.length === 0) return null;

        const touchBox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [point.x - 22, point.y - 22],
          [point.x + 22, point.y + 22],
        ];
        const feats = map.queryRenderedFeatures(touchBox, {
          layers: activeLayers,
        });

        if (feats.length === 0) return null;
        if (feats.length === 1) return feats[0];

        let bestFeat = feats[0];
        let bestDistSq = Number.POSITIVE_INFINITY;

        for (const f of feats) {
          const props = f.properties || {};
          const lng = Number(props.lng);
          const lat = Number(props.lat);
          if (Number.isFinite(lng) && Number.isFinite(lat)) {
            const screenPt = map.project([lng, lat]);
            const dx = screenPt.x - point.x;
            const dy = screenPt.y - 22 - point.y;
            const distSq = Math.min(
              dx * dx + dy * dy,
              dx * dx + (screenPt.y - point.y) * (screenPt.y - point.y)
            );
            if (distSq < bestDistSq) {
              bestDistSq = distSq;
              bestFeat = f;
            }
          }
        }

        return bestFeat;
      };

      map.on('click', (e) => {
        const feat = queryInteractiveFeatureAtPoint(e.point);
        if (!feat) {
          latestStateRef.current.onClearSelection();
          return;
        }

        const props = feat.properties || {};
        if (props.isHub) {
          latestStateRef.current.onSelectHub();
          return;
        }

        const farmId = props.id || props.farmId;
        if (farmId) {
          const matched = latestStateRef.current.farms.find(
            (f) => f.id === farmId
          );
          if (matched) {
            latestStateRef.current.onSelectFarm(matched);
          }
        }
      });

      map.on('mousemove', (e) => {
        const feat = queryInteractiveFeatureAtPoint(e.point);
        if (!feat) {
          map.getCanvas().style.cursor = '';
          setHoveredId((prev) => (prev !== null ? null : prev));
          setHoveredTooltip((prev) => (prev !== null ? null : prev));
          return;
        }

        map.getCanvas().style.cursor = 'pointer';
        const props = feat.properties || {};
        const farmId = String(props.id || props.farmId || '');
        if (props.isHub) {
          setHoveredId(farmId);
          setHoveredTooltip(null);
          return;
        }

        const matched = latestStateRef.current.farms.find(
          (f) => f.id === farmId
        );
        if (matched) {
          setHoveredId(matched.id);
          if (map.getZoom() < 11) {
            const projected = map.project([matched.lng, matched.lat]);
            const badge = getLocationDisplayLabel(
              matched,
              latestStateRef.current.customLabels
            );
            setHoveredTooltip({
              name: matched.name,
              badge,
              x: projected.x,
              y: projected.y,
            });
          } else {
            setHoveredTooltip(null);
          }
        }
      });

      map.on('zoom', () => {
        setCurrentZoom(map.getZoom());
      });

      map.on('load', () => {
        isMapLoadedRef.current = true;
        setupCustomLayers(map);
      });

      mapRef.current = map;

      const handleViewportResize = () => {
        if (!mapRef.current) return;
        try {
          mapRef.current.resize();
        } catch {
          // ignore
        }
      };

      const resizeObserver = new ResizeObserver(() => {
        handleViewportResize();
      });
      resizeObserver.observe(mapContainerRef.current);

      window.addEventListener('resize', handleViewportResize);
      window.addEventListener('orientationchange', handleViewportResize);

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', handleViewportResize);
        window.removeEventListener('orientationchange', handleViewportResize);
        map.remove();
        mapRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Khi chuyển từ Quả địa cầu 3D sang Bản đồ 2D, gọi map.resize() để khung vẽ khớp 100%
    useEffect(() => {
      if (stage === 'map' && mapRef.current) {
        setTimeout(() => {
          mapRef.current?.resize();
        }, 40);
      }
    }, [stage]);

    // Chuyển đổi 3 lớp nền Bản đồ đường | Địa hình | Vệ tinh
    const currentStyleModeRef = useRef<MapStyleMode>(mapStyleMode);
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;
      if (currentStyleModeRef.current === mapStyleMode) return;

      currentStyleModeRef.current = mapStyleMode;
      tileErrorTimestampsRef.current = [];

      const savedCenter = map.getCenter();
      const savedZoom = map.getZoom();

      const nextStyle = getBasemapStyle(
        mapStyleMode,
        streetFallbackToOsmRef.current,
        esriMaxZoomRef.current
      );

      map.setStyle(nextStyle);

      map.once('style.load', () => {
        registerMapLibreFarmIcons(map);
        map.jumpTo({
          center: savedCenter,
          zoom: savedZoom,
          pitch: 0,
          bearing: 0,
        });
        setupCustomLayers(map);
      });
    }, [mapStyleMode, setupCustomLayers]);

    // Cập nhật dữ liệu source "farms" trên Bản đồ 2D
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;

      const farmsSource = map.getSource('farms') as
        | maplibregl.GeoJSONSource
        | undefined;
      if (farmsSource) {
        farmsSource.setData(
          buildFarmsSourceGeoJSON(farms, centralHub, customLabels)
        );
      }
    }, [farms, centralHub, customLabels, buildFarmsSourceGeoJSON]);

    // Cập nhật vòng bán kính an toàn sinh học trên Bản đồ 2D
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;

      const bioSource = map.getSource(
        'biosecurity-zones'
      ) as maplibregl.GeoJSONSource | undefined;
      if (bioSource) {
        bioSource.setData(
          buildBiosecurityGeoJSON(visibleFarms, biosecurityRadius, 0.5)
        );
      }
    }, [visibleFarms, biosecurityRadius]);

    // Đồng bộ bộ lọc chip & opacity trên Bản đồ 2D
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;

      applyLayerFiltersAndStyles(
        map,
        activeCategories,
        selectedFarm?.id || null,
        isHubSelected,
        centralHub?.id || null,
        hoveredId,
        normalizedQuery,
        matchedFarmIds,
        liteMode
      );
    }, [
      activeCategories,
      selectedFarm,
      isHubSelected,
      centralHub,
      hoveredId,
      normalizedQuery,
      matchedFarmIds,
      liteMode,
      applyLayerFiltersAndStyles,
    ]);

    // =========================================================================
    // 3. LUỒNG ĐỐM SÁNG CHẠY MỘT CHIỀU TỪ NHÀ MÁY ➔ TRẠI GÀ & TRẠI HEO TRÊN BẢN ĐỒ 2D (60FPS)
    // =========================================================================
    const prevActiveTargetsRef = useRef<Farm[]>([]);
    const arcModeRef = useRef<'idle' | 'growing' | 'active' | 'shrinking'>(
      'idle'
    );
    const arcTransitionStartRef = useRef<number>(0);

    useEffect(() => {
      const now = performance.now();
      if (activeTargetFarms.length > 0) {
        prevActiveTargetsRef.current = activeTargetFarms;
        if (
          arcModeRef.current === 'idle' ||
          arcModeRef.current === 'shrinking'
        ) {
          arcModeRef.current = 'growing';
          arcTransitionStartRef.current = now;
        }
      } else {
        if (
          arcModeRef.current === 'growing' ||
          arcModeRef.current === 'active'
        ) {
          arcModeRef.current = 'shrinking';
          arcTransitionStartRef.current = now;
        }
      }
    }, [activeTargetFarms]);

    useEffect(() => {
      let animId: number;
      let phase = 0;

      const clearSupplyGeoJSONSources = () => {
        const map = mapRef.current;
        if (!map || !isMapLoadedRef.current) return;
        const empty = {
          type: 'FeatureCollection' as const,
          features: [],
        };
        try {
          (
            map.getSource('supply-bezier-arcs') as
              | maplibregl.GeoJSONSource
              | undefined
          )?.setData(empty);
          (
            map.getSource('supply-particles') as
              | maplibregl.GeoJSONSource
              | undefined
          )?.setData(empty);
          (
            map.getSource('supply-impact-rings') as
              | maplibregl.GeoJSONSource
              | undefined
          )?.setData(empty);
        } catch {
          // ignore
        }
      };

      const evaluateQuadraticBezier = (
        p0: [number, number],
        p1: [number, number],
        p2: [number, number],
        t: number
      ): [number, number] => {
        const inv = 1 - t;
        const lng = inv * inv * p0[0] + 2 * inv * t * p1[0] + t * t * p2[0];
        const lat = inv * inv * p0[1] + 2 * inv * t * p1[1] + t * t * p2[1];
        return [lng, lat];
      };

      const animateArcs = (now: number) => {
        const map = mapRef.current;
        const mode = arcModeRef.current;

        if (!map || !isMapLoadedRef.current) {
          animId = requestAnimationFrame(animateArcs);
          return;
        }

        if (mode === 'idle') {
          clearSupplyGeoJSONSources();
          return;
        }

        const farmsForArcs =
          activeTargetFarms.length > 0
            ? activeTargetFarms
            : prevActiveTargetsRef.current;

        if (!centralHub || farmsForArcs.length === 0) {
          arcModeRef.current = 'idle';
          clearSupplyGeoJSONSources();
          return;
        }

        const elapsedMs = now - arcTransitionStartRef.current;
        let globalFade = 1;

        if (mode === 'growing' && elapsedMs >= 1100) {
          arcModeRef.current = 'active';
        } else if (mode === 'shrinking') {
          if (elapsedMs >= 500) {
            arcModeRef.current = 'idle';
            prevActiveTargetsRef.current = [];
            clearSupplyGeoJSONSources();
            return;
          }
          globalFade = Math.max(0, 1 - elapsedMs / 500);
        }

        phase += liteMode ? 0.015 : 0.02;
        const total = Math.max(1, farmsForArcs.length);
        let hubCoords: [number, number] = [
          Number(centralHub.lng),
          Number(centralHub.lat),
        ];
        if (Math.abs(hubCoords[0]) < 30 && Math.abs(hubCoords[1]) >= 30) {
          hubCoords = [hubCoords[1], hubCoords[0]];
        }
        const [hubLng, hubLat] = hubCoords;

        const bezierLineFeatures: Array<{
          type: 'Feature';
          properties: Record<string, unknown>;
          geometry: {
            type: 'LineString';
            coordinates: Array<[number, number]>;
          };
        }> = [];
        const particleFeatures: Array<{
          type: 'Feature';
          properties: Record<string, unknown>;
          geometry: { type: 'Point'; coordinates: [number, number] };
        }> = [];
        const impactRingFeatures: Array<{
          type: 'Feature';
          properties: Record<string, unknown>;
          geometry: { type: 'Point'; coordinates: [number, number] };
        }> = [];

        // Vòng sóng nhẹ lan tỏa liên tục quanh Nhà máy Trung tâm
        for (let rIdx = 0; rIdx < 2; rIdx++) {
          const hubWave = (phase * 0.85 + rIdx * 0.5) % 1;
          impactRingFeatures.push({
            type: 'Feature',
            properties: {
              radius: 10 + hubWave * 26,
              color: '#38bdf8',
              fillOpacity: Math.max(0, (1 - hubWave) * 0.24 * globalFade),
              strokeWidth: 2.2,
              strokeColor: '#facc15',
              strokeOpacity: Math.max(0, (1 - hubWave) * 0.9 * globalFade),
            },
            geometry: {
              type: 'Point',
              coordinates: [hubLng, hubLat],
            },
          });
        }

        farmsForArcs.forEach((farm, idx) => {
          let reachProgress = 1;
          if (arcModeRef.current === 'growing') {
            const staggerDelay = total > 1 ? (idx / (total - 1)) * 380 : 0;
            const localElapsed = Math.max(0, elapsedMs - staggerDelay);
            const rawT = Math.min(1, localElapsed / 620);
            reachProgress = 1 - Math.pow(1 - rawT, 3);
          } else if (arcModeRef.current === 'shrinking') {
            const shrinkT = Math.min(1, elapsedMs / 500);
            reachProgress = Math.max(0, 1 - shrinkT);
          }

          let farmCoords: [number, number] = [
            Number(farm.lng),
            Number(farm.lat),
          ];
          if (Math.abs(farmCoords[0]) < 30 && Math.abs(farmCoords[1]) >= 30) {
            farmCoords = [farmCoords[1], farmCoords[0]];
          }
          const [farmLng, farmLat] = farmCoords;

          const dx = farmLng - hubLng;
          const dy = farmLat - hubLat;
          const bendSign = idx % 2 === 0 ? 1 : -1;
          const bendFactor = 0.16 * bendSign;
          const ctrlPt: [number, number] = [
            hubLng + dx * 0.5 - dy * bendFactor,
            hubLat + dy * 0.5 + dx * bendFactor,
          ];

          const isPig = farm.category === 'pig';
          const lineColor = isPig ? '#fb7185' : '#fb923c';
          const coreColor = isPig ? '#fda4af' : '#fdba74';

          if (reachProgress > 0.03) {
            const steps = 18;
            const coords: Array<[number, number]> = [];
            for (let s = 0; s <= steps; s++) {
              const t = (s / steps) * reachProgress;
              coords.push(
                evaluateQuadraticBezier(
                  [hubLng, hubLat],
                  ctrlPt,
                  [farmLng, farmLat],
                  t
                )
              );
            }

            bezierLineFeatures.push({
              type: 'Feature',
              properties: {
                id: `bezier-${farm.id}`,
                color: lineColor,
                coreColor,
                glowOpacity: 0.32 * globalFade,
                coreOpacity: 0.65 * globalFade,
              },
              geometry: {
                type: 'LineString',
                coordinates: coords,
              },
            });
          }

          // Nhiều đốm sáng phát quang chạy nối đuôi nhau một chiều từ Nhà máy (t = 0) ➔ Trại (t = 1)
          const streamCount = liteMode ? 1 : 2;
          const trailSteps = liteMode ? 2 : 4;

          for (let sIdx = 0; sIdx < streamCount; sIdx++) {
            const headT =
              ((phase * 0.54 + idx * 0.17 + sIdx * (1 / streamCount)) % 1) *
              reachProgress;

            for (let tr = 0; tr < trailSteps; tr++) {
              const trailT = headT - tr * 0.032;
              if (trailT <= 0.01 || trailT > reachProgress) continue;

              const pt = evaluateQuadraticBezier(
                [hubLng, hubLat],
                ctrlPt,
                [farmLng, farmLat],
                trailT
              );
              const tailFactor = 1 - tr / trailSteps;

              particleFeatures.push({
                type: 'Feature',
                properties: {
                  color: tr === 0 ? '#facc15' : lineColor,
                  coreRadius: tr === 0 ? 4.0 : 2.6 * tailFactor,
                  glowRadius: tr === 0 ? 8.8 : 5.8 * tailFactor,
                  coreOpacity:
                    (tr === 0 ? 0.98 : 0.78 * tailFactor) * globalFade,
                  glowOpacity:
                    (tr === 0 ? 0.8 : 0.5 * tailFactor) * globalFade,
                },
                geometry: {
                  type: 'Point',
                  coordinates: pt,
                },
              });
            }

            if (reachProgress > 0.92 && headT >= 0.82) {
              const impactWave = (headT - 0.82) / 0.18;
              impactRingFeatures.push({
                type: 'Feature',
                properties: {
                  radius: 6 + impactWave * 18,
                  color: lineColor,
                  fillOpacity: Math.max(
                    0,
                    (1 - impactWave) * 0.32 * globalFade
                  ),
                  strokeWidth: 2,
                  strokeColor: '#fef08a',
                  strokeOpacity: Math.max(
                    0,
                    (1 - impactWave) * 0.92 * globalFade
                  ),
                },
                geometry: {
                  type: 'Point',
                  coordinates: [farmLng, farmLat],
                },
              });
            }
          }
        });

        try {
          (
            map.getSource('supply-bezier-arcs') as
              | maplibregl.GeoJSONSource
              | undefined
          )?.setData({
            type: 'FeatureCollection',
            features: bezierLineFeatures,
          });
          (
            map.getSource('supply-particles') as
              | maplibregl.GeoJSONSource
              | undefined
          )?.setData({
            type: 'FeatureCollection',
            features: particleFeatures,
          });
          (
            map.getSource('supply-impact-rings') as
              | maplibregl.GeoJSONSource
              | undefined
          )?.setData({
            type: 'FeatureCollection',
            features: impactRingFeatures,
          });
        } catch {
          // ignore
        }

        animId = requestAnimationFrame(animateArcs);
      };

      animId = requestAnimationFrame(animateArcs);
      return () => cancelAnimationFrame(animId);
    }, [activeTargetFarms, centralHub, liteMode]);

    const currentPreset = APP_CONFIG.timePresets[timeOfDay];

    return (
      <div className="app-viewport relative bg-[#041829]">
        {/* Nền vũ trụ xanh đậm có sao mờ và quầng khí quyển cho Quả địa cầu 3D */}
        <SpaceOceanBackdrop visible={stage === 'globe'} liteMode={liteMode} />

        {/* 1. QUẢ ĐỊA CẦU 3D MẶC ĐỊNH (`globe.gl` + `THREE.Sprite` ghim icon rõ nét ở mọi mức zoom) */}
        <div
          ref={globeContainerRef}
          className={`fixed inset-0 z-10 transition-opacity duration-500 ${
            stage === 'globe'
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0'
          }`}
        />

        {/* 2. BẢN ĐỒ 2D PHẲNG NHẸ (MapLibre GL — Mặc định nền OpenStreetMap gốc, pitch: 0) */}
        <div
          ref={mapContainerRef}
          className={`fixed inset-0 z-10 transition-opacity duration-500 ${
            stage === 'map'
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0'
          }`}
        />

        {/* Tooltip tên trang trại + nhãn mô tả khi rê chuột vào icon ở mức zoom xa trên Bản đồ 2D */}
        {stage === 'map' && hoveredTooltip && (
          <div
            className="pointer-events-none fixed z-20 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/95 bg-white/95 px-3 py-1 text-[11px] font-extrabold text-[#0f2a24] shadow-md backdrop-blur-md"
            style={{
              left: `${hoveredTooltip.x}px`,
              top: `${Math.max(hoveredTooltip.y - 50, 12)}px`,
            }}
          >
            <span>{hoveredTooltip.name}</span>
            {hoveredTooltip.badge && (
              <span className="rounded-full bg-[#e6f4f1] px-2 py-0.5 text-[9.5px] font-bold text-[#145349]">
                {hoveredTooltip.badge}
              </span>
            )}
          </div>
        )}

        {/* Lớp phủ ánh sáng & mây CHỈ áp dụng cho Quả địa cầu 3D — tuyệt đối KHÔNG phủ mờ đè lên nền Bản đồ 2D */}
        {stage === 'globe' && (
          <>
            <div
              className="pointer-events-none fixed inset-0 z-10 transition-colors duration-1000"
              style={{ backgroundColor: currentPreset.ambientTint }}
              aria-hidden="true"
            />
            <AtmosphericCloudsOverlay zoom={currentZoom} liteMode={liteMode} />
          </>
        )}

        {/* Thanh chuyển nhanh 3 lớp nền trực tiếp trên Bản đồ 2D: Bản đồ đường | Địa hình | Vệ tinh */}
        {stage === 'map' && onSelectMapStyle && (
          <div
            className={`pointer-events-auto fixed left-2.5 bottom-[118px] z-20 items-center gap-0.5 rounded-full border border-white/95 bg-white/92 p-1 shadow-[0_8px_24px_rgba(15,42,36,0.16)] backdrop-blur-xl sm:bottom-[34px] ${
              selectedFarm || isHubSelected ? 'hidden sm:flex' : 'flex'
            }`}
            role="group"
            aria-label="Chọn lớp nền bản đồ"
          >
            {(
              [
                {
                  key: 'street' as MapStyleMode,
                  label: 'Bản đồ đường',
                  icon: <MapIcon className="h-3.5 w-3.5" />,
                },
                {
                  key: 'terrain' as MapStyleMode,
                  label: 'Địa hình',
                  icon: <Mountain className="h-3.5 w-3.5" />,
                },
                {
                  key: 'satellite' as MapStyleMode,
                  label: 'Vệ tinh',
                  icon: <Satellite className="h-3.5 w-3.5" />,
                },
              ] as const
            ).map((opt) => {
              const active = mapStyleMode === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onSelectMapStyle(opt.key)}
                  className={`flex min-h-[32px] items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold transition-all cursor-pointer ${
                    active
                      ? 'bg-[#2b8fd0] text-white shadow-xs'
                      : 'text-[#0f2a24]/75 hover:bg-emerald-950/5 hover:text-[#0f2a24]'
                  }`}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Nút tròn nhỏ ở góc dưới khi đang ở Địa cầu 3D: "Xem bản đồ chi tiết" */}
        {stage === 'globe' && !selectedFarm && !isHubSelected && (
          <div
            className="pointer-events-auto fixed left-1/2 z-20 -translate-x-1/2"
            style={{
              bottom: 'calc(var(--safe-bottom) + 74px)',
            }}
          >
            <motion.button
              type="button"
              whileHover={{ y: -2, scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={onEnterMapOverview}
              title="Chuyển sang Bản đồ 2D chi tiết"
              className="glass-panel group flex min-h-[44px] items-center gap-2.5 rounded-full border-white/95 px-5 py-2 text-xs font-extrabold text-[#0f2a24] shadow-[0_14px_32px_rgba(15,42,36,0.22)] transition-colors hover:border-[#2b8fd0] hover:bg-white cursor-pointer"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2b8fd0] text-white shadow-xs transition-transform group-hover:scale-110">
                <MapIcon className="h-3.5 w-3.5" />
              </span>
              <span>Xem bản đồ chi tiết</span>
            </motion.button>
          </div>
        )}

        {/* Ghi nguồn bản đồ ở góc trái dưới */}
        {stage === 'map' && (
          <div
            className="pointer-events-none fixed left-2.5 z-10 max-w-[68vw] truncate rounded-full border border-white/80 bg-white/85 px-2.5 py-0.5 text-[9px] font-semibold text-[#0f2a24] shadow-xs backdrop-blur-md sm:max-w-md sm:px-3 sm:py-1 sm:text-[10px]"
            style={{
              bottom: 'calc(var(--safe-bottom) + 6px)',
            }}
          >
            {mapStyleMode === 'satellite'
              ? 'Nguồn ảnh vệ tinh: Tiles © Esri — Esri, USDA, USGS, GeoEye, IGN & GIS Community'
              : mapStyleMode === 'terrain'
              ? 'Bản đồ địa hình: Tiles © Esri World Topo — OpenStreetMap & GIS Community'
              : usingOsmFallback
              ? 'Bản đồ đường: © OpenStreetMap contributors'
              : 'Bản đồ đường: © OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors'}
          </div>
        )}
      </div>
    );
  }
);
