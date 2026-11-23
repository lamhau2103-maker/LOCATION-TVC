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
import { Map as MapIcon, Minus, Mountain, Plus, Satellite } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  APP_CONFIG,
  ARC_LINE_WEIGHT,
  getCategoryConfig,
  MAP_TILE_PRELOAD_CONFIG,
  MAP_ZOOM_CONFIG,
  RESPONSIVE_BREAKPOINTS,
} from '../config';
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

const OPENFREEMAP_GLYPHS_URL =
  'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

type StreetBasemapProvider = 'osm' | 'carto' | 'esri-street';

const CARTO_VOYAGER_PROBE_URL =
  'https://a.basemaps.cartocdn.com/rastertiles/voyager/10/815/480.png';

function getCartoVoyagerTiles(): string[] {
  const suffix =
    typeof window !== 'undefined' && window.devicePixelRatio > 1 ? '@2x' : '';
  return [
    `https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}${suffix}.png`,
    `https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}${suffix}.png`,
    `https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}${suffix}.png`,
    `https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}${suffix}.png`,
  ];
}

const OSM_STANDARD_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];

const ESRI_STREET_TILES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
];

const ESRI_TERRAIN_TOPO_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';

const ESRI_SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const GLOBE_EARTH_TEXTURE_URL =
  'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const GLOBE_BUMP_TEXTURE_URL =
  'https://unpkg.com/three-globe/example/img/earth-topology.png';

const BASEMAP_CANVAS_BG = MAP_TILE_PRELOAD_CONFIG.groundColorStreet;

try {
  if (typeof maplibregl.setWorkerUrl === 'function' && maplibreWorkerUrl) {
    maplibregl.setWorkerUrl(maplibreWorkerUrl);
  }
} catch {
  // ignore
}

function getOptimalPixelRatio(isLite: boolean): number {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio || 1;
  return isLite ? Math.min(dpr, 2) : Math.min(dpr, 2.5);
}

/**
 * Tính độ cao camera Quả địa cầu 3D theo tỷ lệ khung hình để trên điện thoại dọc (360x640, 390x844...)
 * Quả địa cầu luôn nằm giữa màn hình và KHÔNG BAO GIỜ bị cắt hai bên rìa ngang.
 */
function getResponsiveGlobeAltitude(): number {
  if (typeof window === 'undefined') return 1.75;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < h) {
    const aspect = Math.max(w / Math.max(h, 1), 0.48);
    return Math.min(2.65, Math.max(1.9, 1.48 / aspect));
  }
  if (h < RESPONSIVE_BREAKPOINTS.landscapeShortMaxHeight) {
    return 1.95;
  }
  return 1.75;
}

function getArcDeviceScale(): number {
  if (typeof window === 'undefined') return 1;
  return window.innerWidth <= RESPONSIVE_BREAKPOINTS.mobileMax ? 0.85 : 1;
}

/**
 * Hệ số kích thước theo thiết bị (nhân trên khung logic 64px từ ảnh gốc 256x256px):
 * - Zoom nhỏ (z8): ~29px trên điện thoại, ~33px trên laptop (trong khoảng 28–34px)
 * - Zoom lớn (z16): ~48px trên điện thoại, ~55px trên laptop (trong khoảng 44–56px)
 */
function getDeviceSizeFactor(): number {
  if (typeof window === 'undefined') return 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (
    w <= RESPONSIVE_BREAKPOINTS.mobileMax ||
    h < RESPONSIVE_BREAKPOINTS.landscapeShortMaxHeight
  ) {
    return 0.88;
  }
  if (w <= RESPONSIVE_BREAKPOINTS.tabletMax) return 0.94;
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

  if (h < RESPONSIVE_BREAKPOINTS.landscapeShortMaxHeight && w > h) {
    return {
      top: 44,
      right: Math.min(330, Math.round(w * 0.44)),
      bottom: 20,
      left: 20,
    };
  }

  if (w <= RESPONSIVE_BREAKPOINTS.mobileMax) {
    const ratio =
      mobileSheetSnap === 'collapsed'
        ? 0.28
        : mobileSheetSnap === 'full'
        ? 0.65
        : 0.54;
    return {
      top: 58,
      right: 16,
      bottom: Math.min(Math.round(h * ratio), h - 120),
      left: 16,
    };
  }

  if (w <= RESPONSIVE_BREAKPOINTS.tabletMax && h >= w) {
    return {
      top: 72,
      right: 24,
      bottom: Math.min(Math.round(h * 0.48), h - 160),
      left: 24,
    };
  }

  const cardWidth =
    w <= RESPONSIVE_BREAKPOINTS.tabletMax
      ? Math.max(320, Math.min(380, Math.round(w * 0.36)))
      : Math.max(320, Math.min(420, Math.round(w * 0.28)));
  return {
    top: 72,
    right: cardWidth + 28,
    bottom: 28,
    left: 28,
  };
}

function getGroundColorForMode(mode: MapStyleMode): string {
  if (mode === 'satellite') return MAP_TILE_PRELOAD_CONFIG.groundColorSatellite;
  if (mode === 'terrain') return MAP_TILE_PRELOAD_CONFIG.groundColorTerrain;
  return MAP_TILE_PRELOAD_CONFIG.groundColorStreet;
}

/**
 * TẠO DUY NHẤT MỘT STYLE NỀN TÍCH HỢP CỐ ĐỊNH (KHÔNG BAO GIỜ gọi lại map.setStyle() khi đổi nền/zoom)
 * - Giữ toàn bộ nguồn raster Đường (Esri Street dự phòng bên dưới + OpenStreetMap), Địa hình (Esri Topo) và Vệ tinh (Esri Imagery)
 * - Khi đổi nền chỉ cross-fade `raster-opacity` trong 320ms nên KHÔNG BAO GIỜ mất tile cache hay chớp trắng/xám!
 */
function createUnifiedBasemapStyle(
  initialMode: MapStyleMode,
  satelliteMaxZoom = 18
): maplibregl.StyleSpecification {
  const crossfadeTransition = {
    duration: MAP_TILE_PRELOAD_CONFIG.basemapCrossfadeMs,
    delay: 0,
  };
  const rasterFade = MAP_TILE_PRELOAD_CONFIG.rasterFadeDurationMs;

  return {
    version: 8,
    name: 'ThaiViet Unified Zero-Flicker Basemap',
    glyphs: OPENFREEMAP_GLYPHS_URL,
    sources: {
      'esri-world-street': {
        type: 'raster',
        tiles: ESRI_STREET_TILES,
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Tiles © Esri — World Street Map',
      },
      'osm-standard': {
        type: 'raster',
        tiles: OSM_STANDARD_TILES,
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
      'esri-world-topo': {
        type: 'raster',
        tiles: [ESRI_TERRAIN_TOPO_TILES],
        tileSize: 256,
        maxzoom: 18,
        attribution:
          'Tiles © Esri — Esri World Topo Map, OpenStreetMap & GIS Community',
      },
      'esri-world-imagery': {
        type: 'raster',
        tiles: [ESRI_SATELLITE_TILES],
        tileSize: 256,
        maxzoom: satelliteMaxZoom,
        attribution:
          'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics & GIS Community',
      },
    },
    layers: [
      {
        id: 'basemap-ground-bg',
        type: 'background',
        paint: {
          'background-color': getGroundColorForMode(initialMode),
          'background-color-transition': crossfadeTransition,
        },
      },
      // Lớp nền đệm an toàn nằm ngay dưới OSM: nếu 1 ô tile OSM tải chậm/lỗi, bản đồ vẫn hiện nền đường thật thay vì ô trắng
      {
        id: 'esri-street-base',
        type: 'raster',
        source: 'esri-world-street',
        paint: {
          'raster-opacity': initialMode === 'street' ? 1 : 0,
          'raster-opacity-transition': crossfadeTransition,
          'raster-fade-duration': rasterFade,
        },
      },
      {
        id: 'osm-standard-base',
        type: 'raster',
        source: 'osm-standard',
        paint: {
          'raster-opacity': initialMode === 'street' ? 1 : 0,
          'raster-opacity-transition': crossfadeTransition,
          'raster-fade-duration': rasterFade,
        },
      },
      {
        id: 'esri-terrain-base',
        type: 'raster',
        source: 'esri-world-topo',
        paint: {
          'raster-opacity': initialMode === 'terrain' ? 1 : 0,
          'raster-opacity-transition': crossfadeTransition,
          'raster-fade-duration': rasterFade,
        },
      },
      {
        id: 'esri-satellite-base',
        type: 'raster',
        source: 'esri-world-imagery',
        paint: {
          'raster-opacity': initialMode === 'satellite' ? 1 : 0,
          'raster-opacity-transition': crossfadeTransition,
          'raster-fade-duration': rasterFade,
        },
      },
    ],
  };
}

/**
 * Chuyển đổi mượt lớp nền bằng cross-fade opacity — TUYỆT ĐỐI không gọi map.setStyle()
 */
function applyBasemapVisibility(
  map: maplibregl.Map,
  mode: MapStyleMode,
  streetProvider: StreetBasemapProvider
): void {
  try {
    if (map.getLayer('basemap-ground-bg')) {
      map.setPaintProperty(
        'basemap-ground-bg',
        'background-color',
        getGroundColorForMode(mode)
      );
    }

    const isStreet = mode === 'street';
    const showEsriFallback = isStreet;
    const showOsm = isStreet && streetProvider === 'osm';
    const showCarto = isStreet && streetProvider === 'carto';
    const showTerrain = mode === 'terrain';
    const showSatellite = mode === 'satellite';

    if (map.getLayer('esri-street-base')) {
      map.setPaintProperty(
        'esri-street-base',
        'raster-opacity',
        showEsriFallback ? 1 : 0
      );
    }
    if (map.getLayer('osm-standard-base')) {
      map.setPaintProperty(
        'osm-standard-base',
        'raster-opacity',
        showOsm ? 1 : 0
      );
    }
    if (map.getLayer('carto-voyager-base')) {
      map.setPaintProperty(
        'carto-voyager-base',
        'raster-opacity',
        showCarto ? 1 : 0
      );
    }
    if (map.getLayer('esri-terrain-base')) {
      map.setPaintProperty(
        'esri-terrain-base',
        'raster-opacity',
        showTerrain ? 1 : 0
      );
    }
    if (map.getLayer('esri-satellite-base')) {
      map.setPaintProperty(
        'esri-satellite-base',
        'raster-opacity',
        showSatellite ? 1 : 0
      );
    }
  } catch {
    // ignore
  }
}

/**
 * Gắn động lớp Carto Voyager (khi probe xác nhận không bị watermark API KEY) mà KHÔNG reset style
 */
function ensureCartoLayerAttached(map: maplibregl.Map): void {
  try {
    if (!map.getSource('carto-voyager')) {
      map.addSource('carto-voyager', {
        type: 'raster',
        tiles: getCartoVoyagerTiles(),
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors © CARTO',
      });
    }
    if (!map.getLayer('carto-voyager-base')) {
      const beforeId = map.getLayer('esri-terrain-base')
        ? 'esri-terrain-base'
        : undefined;
      map.addLayer(
        {
          id: 'carto-voyager-base',
          type: 'raster',
          source: 'carto-voyager',
          paint: {
            'raster-opacity': 0,
            'raster-opacity-transition': {
              duration: MAP_TILE_PRELOAD_CONFIG.basemapCrossfadeMs,
              delay: 0,
            },
            'raster-fade-duration':
              MAP_TILE_PRELOAD_CONFIG.rasterFadeDurationMs,
          },
        },
        beforeId
      );
    }
  } catch {
    // ignore
  }
}

/**
 * Chuyển toạ độ (lng, lat, z) sang chỉ số ô tile Web Mercator để preload nhẹ mức zoom liền kề (z-1, z+1)
 */
function lngLatToTileXY(
  lng: number,
  lat: number,
  zoom: number
): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return {
    x: ((x % n) + n) % n,
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

function buildPreloadTileUrl(
  mode: MapStyleMode,
  provider: StreetBasemapProvider,
  z: number,
  x: number,
  y: number
): string {
  if (mode === 'satellite') {
    return ESRI_SATELLITE_TILES.replace('{z}', String(z))
      .replace('{y}', String(y))
      .replace('{x}', String(x));
  }
  if (mode === 'terrain') {
    return ESRI_TERRAIN_TOPO_TILES.replace('{z}', String(z))
      .replace('{y}', String(y))
      .replace('{x}', String(x));
  }
  if (provider === 'carto') {
    const tiles = getCartoVoyagerTiles();
    const tpl = tiles[(x + y) % tiles.length];
    return tpl
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
  }
  if (provider === 'esri-street') {
    return ESRI_STREET_TILES[0]
      .replace('{z}', String(z))
      .replace('{y}', String(y))
      .replace('{x}', String(x));
  }
  return OSM_STANDARD_TILES[0]
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

function preloadAdjacentZoomTiles(
  map: maplibregl.Map,
  mode: MapStyleMode,
  provider: StreetBasemapProvider,
  cacheSet: Set<string>
): void {
  if (typeof window === 'undefined') return;
  const center = map.getCenter();
  const curZ = Math.round(map.getZoom());
  const targetZooms = [curZ - 1, curZ + 1].filter((z) => z >= 3 && z <= 17);
  let queued = 0;
  const limit = MAP_TILE_PRELOAD_CONFIG.preloadTileCount;

  for (const z of targetZooms) {
    const { x, y } = lngLatToTileXY(center.lng, center.lat, z);
    const n = Math.pow(2, z);
    const offsets: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
    ];
    for (const [dx, dy] of offsets) {
      if (queued >= limit) return;
      const nx = (((x + dx) % n) + n) % n;
      const ny = Math.max(0, Math.min(n - 1, y + dy));
      const url = buildPreloadTileUrl(mode, provider, z, nx, ny);
      if (cacheSet.has(url)) continue;
      if (cacheSet.size > 240) {
        cacheSet.clear();
      }
      cacheSet.add(url);
      const img = new Image();
      img.decoding = 'async';
      img.crossOrigin = 'anonymous';
      img.src = url;
      queued++;
    }
  }
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
    if (liteMode || !visible) return;
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

    // Giảm số hạt sao trên điện thoại để tiết kiệm pin & giữ 60fps
    const starCount =
      window.innerWidth <= RESPONSIVE_BREAKPOINTS.mobileMax
        ? 55
        : window.innerWidth <= RESPONSIVE_BREAKPOINTS.tabletMax
        ? 90
        : 140;
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
  }, [liteMode, visible]);

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
    const streetProviderRef = useRef<StreetBasemapProvider>('osm');
    const streetErrorTimestampsRef = useRef<number[]>([]);
    const [streetProvider, setStreetProvider] =
      useState<StreetBasemapProvider>('osm');

    // Tránh gọi React setState theo từng frame zoom/pan -> giữ trạng thái tương tác bằng ref để chống re-render & chống giật
    const isMapInteractingRef = useRef<boolean>(false);
    const interactionResumeTimerRef = useRef<number | null>(null);
    const preloadedTileUrlsRef = useRef<Set<string>>(new Set());
    const lastPreloadTsRef = useRef<number>(0);

    const hoveredArcFarmIdRef = useRef<string | null>(null);
    const arcDirtyRef = useRef<boolean>(true);
    const lastRenderedArcHighlightRef = useRef<string | null>(null);

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

    const showFactoryArcs = useMemo(() => {
      if (singleArcFarmId) return true;
      if (isHubSelected) return true;
      if (selectedFarm) {
        if (
          selectedFarm.isFeedMill ||
          selectedFarm.subType === 'hub' ||
          (centralHub?.id && selectedFarm.id === centralHub.id)
        ) {
          return true;
        }
        return false;
      }
      return true;
    }, [selectedFarm, isHubSelected, singleArcFarmId, centralHub]);

    // Danh sách các trại Gà & Heo đang bật kết nối một chiều từ Nhà Máy Cám thật theo quy tắc showFactoryArcs
    const activeTargetFarms = useMemo(() => {
      if (!centralHub || !showFactoryArcs) return [];
      const hubId = centralHub.id;
      const connectable = visibleFarms.filter(
        (f) =>
          !f.isFeedMill &&
          f.id !== hubId &&
          f.isConnectable &&
          (f.category === 'chicken' || f.category === 'pig')
      );
      if (singleArcFarmId) {
        const single = connectable.filter((f) => f.id === singleArcFarmId);
        return single.length > 0 ? single : connectable;
      }
      return connectable;
    }, [centralHub, singleArcFarmId, visibleFarms, showFactoryArcs]);

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
      if (!centralHub || !showFactoryArcs || activeTargetFarms.length === 0) return [];
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
    }, [activeTargetFarms, centralHub, showFactoryArcs]);

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
          duration: MAP_ZOOM_CONFIG.flyToDurationMs,
          essential: true,
        });
      },
      flyToOverview: (duration = MAP_ZOOM_CONFIG.overviewDurationMs) => {
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
            duration: MAP_ZOOM_CONFIG.flyToDurationMs,
            essential: true,
          });
        }
        if (globeRef.current && latestStateRef.current.stage === 'globe') {
          globeRef.current.pointOfView(
            {
              lat: Number(centralHub.lat),
              lng: Number(centralHub.lng),
              altitude: Math.min(1.05, getResponsiveGlobeAltitude() * 0.45),
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
              altitude: Math.min(1.25, getResponsiveGlobeAltitude() * 0.52),
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
            duration: MAP_ZOOM_CONFIG.flyToDurationMs,
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
              altitude: getResponsiveGlobeAltitude(),
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
              altitude: getResponsiveGlobeAltitude(),
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
            duration: MAP_ZOOM_CONFIG.overviewDurationMs,
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
        .arcStroke(0.26)
        .arcDashLength(0.18)
        .arcDashGap(0.82)
        .arcDashInitialGap(() => Math.random())
        .arcDashAnimateTime(1600);

      // Giới hạn pixelRatio hợp lý trên mobile (tối đa 2) & bật anisotropic tối đa cho ghim icon 3D sắc nét
      try {
        const renderer = globe.renderer();
        if (renderer?.setPixelRatio) {
          const isSmallMobile =
            window.innerWidth <= RESPONSIVE_BREAKPOINTS.mobileMax;
          renderer.setPixelRatio(
            Math.min(
              window.devicePixelRatio || 1,
              isSmallMobile || latestStateRef.current.liteMode ? 1.75 : 2
            )
          );
        }
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

      // Đặt góc nhìn khởi tạo hướng về Việt Nam / Đông Nam Á (tự cân tỷ lệ để không bị cắt trên điện thoại dọc)
      globe.pointOfView(
        {
          lat: 14.5,
          lng: 106.8,
          altitude: getResponsiveGlobeAltitude(),
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
        controls.maxDistance = 480;
      }

      globeRef.current = globe;

      // Vòng lặp cập nhật kích thước (scale) của các THREE.Sprite theo khoảng cách camera
      // (tự tạm nghỉ khi người dùng đang ở chế độ Bản đồ 2D để dành trọn 60fps cho bản đồ)
      let scaleAnimId: number;
      const updateSpriteScales = () => {
        const g = globeRef.current;
        if (g && latestStateRef.current.stage === 'globe') {
          const cam = g.camera();
          const dist = cam ? cam.position.length() : 250;
          const altitudeRatio = Math.max(0.15, (dist - 100) / 100);
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

        if (
          latestStateRef.current.stage === 'globe' &&
          !latestStateRef.current.selectedFarm &&
          !latestStateRef.current.isHubSelected
        ) {
          const pov = globeRef.current.pointOfView();
          globeRef.current.pointOfView(
            {
              lat: pov?.lat ?? 14.5,
              lng: pov?.lng ?? 106.8,
              altitude: getResponsiveGlobeAltitude(),
            },
            300
          );
        }
      };

      window.addEventListener('resize', handleResize);
      window.addEventListener('orientationchange', handleResize);
      return () => {
        cancelAnimationFrame(scaleAnimId);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
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
    // 2. BẢN ĐỒ PHẲNG 2D CHI TIẾT (MAPLIBRE GL — ICON 3D RETINA 256x256 + CLUSTERING)
    // =========================================================================
    const buildFarmsSourceGeoJSON = useCallback(
      (
        allFarms: Farm[],
        hub: CentralHub | null,
        cats: Record<FarmCategory, boolean>,
        labels?: FarmCustomLabels
      ) => {
        renderedCoordsMapRef.current.clear();

        const farmFeatures: Array<{
          type: 'Feature';
          properties: Record<string, unknown>;
          geometry: { type: 'Point'; coordinates: [number, number] };
        }> = [];
        const hubFeatures: Array<{
          type: 'Feature';
          properties: Record<string, unknown>;
          geometry: { type: 'Point'; coordinates: [number, number] };
        }> = [];

        for (const f of allFarms) {
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
          const resolvedSub = isHub ? 'hub' : f.subType || f.category;
          const iconKey = `farm-icon-${resolvedSub}`;
          const selectedIconKey = `farm-icon-${resolvedSub}-selected`;
          const markerAlias = isHub
            ? 'marker-factory'
            : f.category === 'chicken'
            ? 'marker-chicken'
            : f.category === 'pig'
            ? 'marker-pig'
            : 'marker-other';
          const catColor = isHub ? '#2b8fd0' : getCategoryConfig(f.category).hex;
          const displayLabel = getLocationDisplayLabel(f, labels);

          const feature = {
            type: 'Feature' as const,
            properties: {
              id: f.id,
              name: f.name,
              displayLabel,
              category: isHub ? 'hub' : f.category,
              isHub,
              isConnectable: isHub ? false : Boolean(f.isConnectable),
              iconImage: iconKey,
              selectedIconImage: selectedIconKey,
              markerIcon: markerAlias,
              color: catColor,
              lat: exactLat,
              lng: exactLng,
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [exactLng, exactLat] as [number, number],
            },
          };

          if (isHub) {
            hubFeatures.push(feature);
          } else if (cats[f.category]) {
            farmFeatures.push(feature);
          }
        }

        return {
          farmsCollection: {
            type: 'FeatureCollection' as const,
            features: farmFeatures,
          },
          hubCollection: {
            type: 'FeatureCollection' as const,
            features: hubFeatures,
          },
        };
      },
      []
    );

    const buildSelectedPinGeoJSON = useCallback(
      (
        curSelected: Farm | null,
        curHubSelected: boolean,
        curHub: CentralHub | null,
        labels?: FarmCustomLabels
      ) => {
        const selectedFarmFeatures: Array<{
          type: 'Feature';
          properties: Record<string, unknown>;
          geometry: { type: 'Point'; coordinates: [number, number] };
        }> = [];
        const pulseFeatures: Array<{
          type: 'Feature';
          properties: Record<string, unknown>;
          geometry: { type: 'Point'; coordinates: [number, number] };
        }> = [];

        if (curSelected) {
          let coords: [number, number] = [
            Number(curSelected.lng),
            Number(curSelected.lat),
          ];
          if (Math.abs(coords[0]) < 30 && Math.abs(coords[1]) >= 30) {
            coords = [coords[1], coords[0]];
          }
          const [exactLng, exactLat] = coords;
          const isHub = Boolean(
            curSelected.isFeedMill ||
              curSelected.subType === 'hub' ||
              (curHub?.id && curSelected.id === curHub.id)
          );
          const resolvedSub = isHub
            ? 'hub'
            : curSelected.subType || curSelected.category;
          const catColor = isHub
            ? '#facc15'
            : getCategoryConfig(curSelected.category).hex;

          if (!isHub) {
            selectedFarmFeatures.push({
              type: 'Feature',
              properties: {
                id: curSelected.id,
                name: curSelected.name,
                displayLabel: getLocationDisplayLabel(curSelected, labels),
                category: curSelected.category,
                isHub: false,
                selectedIconImage: `farm-icon-${resolvedSub}-selected`,
                color: catColor,
                lat: exactLat,
                lng: exactLng,
              },
              geometry: {
                type: 'Point',
                coordinates: [exactLng, exactLat],
              },
            });
          }

          pulseFeatures.push({
            type: 'Feature',
            properties: {
              id: curSelected.id,
              color: catColor,
              isHub,
            },
            geometry: {
              type: 'Point',
              coordinates: [exactLng, exactLat],
            },
          });
        } else if (curHubSelected && curHub) {
          let coords: [number, number] = [
            Number(curHub.lng),
            Number(curHub.lat),
          ];
          if (Math.abs(coords[0]) < 30 && Math.abs(coords[1]) >= 30) {
            coords = [coords[1], coords[0]];
          }
          pulseFeatures.push({
            type: 'Feature',
            properties: {
              id: curHub.id,
              color: '#facc15',
              isHub: true,
            },
            geometry: {
              type: 'Point',
              coordinates: coords,
            },
          });
        }

        return {
          selectedCollection: {
            type: 'FeatureCollection' as const,
            features: selectedFarmFeatures,
          },
          pulseCollection: {
            type: 'FeatureCollection' as const,
            features: pulseFeatures,
          },
        };
      },
      []
    );

    const applyLayerFiltersAndStyles = useCallback(
      (
        map: maplibregl.Map,
        curSelectedId: string | null,
        curHubSelected: boolean,
        curHubId: string | null,
        curHoveredId: string | null,
        curQuery: string,
        curMatchedIds: Set<string>
      ) => {
        const activeSelectedId = curSelectedId || '__NONE__';
        const activeHoveredId =
          curHoveredId &&
          curHoveredId !== activeSelectedId &&
          curHoveredId !== curHubId
            ? curHoveredId
            : '__NONE__';
        const isHubHovered =
          curHubId !== null && curHoveredId === curHubId && !curHubSelected;

        const unclusteredBaseFilter: maplibregl.FilterSpecification = [
          'all',
          ['!', ['has', 'point_count']],
          ['!=', ['get', 'id'], activeSelectedId],
          ['!=', ['get', 'id'], activeHoveredId],
        ];

        const hoveredFilter: maplibregl.FilterSpecification = [
          'all',
          ['!', ['has', 'point_count']],
          ['==', ['get', 'id'], activeHoveredId],
        ];

        const labelFilter: maplibregl.FilterSpecification = [
          '!',
          ['has', 'point_count'],
        ];

        try {
          if (map.getLayer('farm-icons')) {
            map.setFilter('farm-icons', unclusteredBaseFilter);
          }
          if (map.getLayer('farm-hovered')) {
            map.setFilter('farm-hovered', hoveredFilter);
          }
          if (map.getLayer('farm-labels')) {
            map.setFilter('farm-labels', labelFilter);
          }

          const hasSearch = curQuery.length > 0;
          const matchedArray = Array.from(curMatchedIds);

          let featureAlphaExpr: maplibregl.ExpressionSpecification | number = 1;
          if (curHubSelected) {
            featureAlphaExpr = [
              'case',
              ['boolean', ['get', 'isConnectable'], false],
              1,
              0.38,
            ];
          } else if (hasSearch) {
            featureAlphaExpr = [
              'case',
              ['in', ['get', 'id'], ['literal', matchedArray]],
              1,
              0.35,
            ];
          }

          if (map.getLayer('farm-icons')) {
            map.setPaintProperty('farm-icons', 'icon-opacity', featureAlphaExpr);
          }

          // Nhà Máy Cám trung tâm: phóng to & nâng nhẹ khi hover (1.1x) hoặc khi được chọn (1.16x trên cỡ lớn sẵn 1.25x)
          if (map.getLayer('hub-icon')) {
            const deviceFactor = getDeviceSizeFactor();
            const hubScaleMult = curHubSelected
              ? 1.42
              : isHubHovered
              ? 1.36
              : 1.25;
            map.setLayoutProperty(
              'hub-icon',
              'icon-image',
              curHubSelected ? 'farm-icon-hub-selected' : 'farm-icon-hub'
            );
            map.setLayoutProperty('hub-icon', 'icon-size', [
              'interpolate',
              ['linear'],
              ['zoom'],
              4,
              0.46 * deviceFactor * hubScaleMult,
              8,
              0.52 * deviceFactor * hubScaleMult,
              12,
              0.68 * deviceFactor * hubScaleMult,
              14,
              0.78 * deviceFactor * hubScaleMult,
              16,
              0.86 * deviceFactor * hubScaleMult,
              19,
              0.9 * deviceFactor * hubScaleMult,
            ]);
            map.setLayoutProperty(
              'hub-icon',
              'icon-offset',
              curHubSelected || isHubHovered ? [0, -3] : [0, 0]
            );
            map.setPaintProperty(
              'hub-icon',
              'icon-opacity',
              hasSearch && curHubId && !curMatchedIds.has(curHubId) ? 0.78 : 1
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
              'line-width': 3.4,
              'line-blur': 2.0,
              'line-opacity': 0.32,
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
              'line-color': '#059669',
              'line-width': 1.8,
              'line-opacity': 0.88,
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

        // Độ dày đường cung thanh mảnh hơn 50-60% theo hằng số ARC_LINE_WEIGHT, tự thu phóng theo zoom & thiết bị
        const arcDeviceScale = getArcDeviceScale();
        const glowBase5 = Number(
          (ARC_LINE_WEIGHT * 1.15 * arcDeviceScale).toFixed(2)
        );
        const glowBase10 = Number(
          (ARC_LINE_WEIGHT * 1.65 * arcDeviceScale).toFixed(2)
        );
        const glowBase15 = Number(
          (ARC_LINE_WEIGHT * 2.2 * arcDeviceScale).toFixed(2)
        );
        const coreBase5 = Number(
          (ARC_LINE_WEIGHT * 0.58 * arcDeviceScale).toFixed(2)
        );
        const coreBase10 = Number(
          (ARC_LINE_WEIGHT * 0.82 * arcDeviceScale).toFixed(2)
        );
        const coreBase15 = Number(
          (ARC_LINE_WEIGHT * 1.16 * arcDeviceScale).toFixed(2)
        );
        const coreBase18 = Number(
          (ARC_LINE_WEIGHT * 1.28 * arcDeviceScale).toFixed(2)
        );

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
                ['*', glowBase5, ['coalesce', ['get', 'widthScale'], 1]],
                10,
                ['*', glowBase10, ['coalesce', ['get', 'widthScale'], 1]],
                15,
                ['*', glowBase15, ['coalesce', ['get', 'widthScale'], 1]],
              ],
              'line-blur': 1.6,
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
                ['*', coreBase5, ['coalesce', ['get', 'widthScale'], 1]],
                10,
                ['*', coreBase10, ['coalesce', ['get', 'widthScale'], 1]],
                15,
                ['*', coreBase15, ['coalesce', ['get', 'widthScale'], 1]],
                18,
                ['*', coreBase18, ['coalesce', ['get', 'widthScale'], 1]],
              ],
              'line-opacity': ['get', 'coreOpacity'],
            },
          });
        }

        // Lớp vùng chạm/rê chuột ẩn rộng 14px giúp dễ hover/chạm vào từng đường cung mảnh
        if (!map.getLayer('supply-bezier-hit')) {
          map.addLayer({
            id: 'supply-bezier-hit',
            type: 'line',
            source: 'supply-bezier-arcs',
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': '#ffffff',
              'line-width': 14,
              'line-opacity': 0,
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
              'circle-stroke-width': 0.9,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': ['get', 'coreOpacity'],
              'circle-stroke-opacity': ['get', 'coreOpacity'],
            },
          });
        }

        // 1. Nguồn GeoJSON "farms" có gom cụm (clustering) ở zoom nhỏ (zoom <= 11) cho các trang trại
        //    (KHÔNG bao gồm Nhà Máy Cám để Nhà Máy Cám không bao giờ bị gom cụm)
        const { farmsCollection, hubCollection } = buildFarmsSourceGeoJSON(
          allFarms,
          curHub,
          curCats,
          curLabels
        );
        const { selectedCollection, pulseCollection } = buildSelectedPinGeoJSON(
          curSelected,
          curHubSelected,
          curHub,
          curLabels
        );

        if (!map.getSource('farms')) {
          map.addSource('farms', {
            type: 'geojson',
            data: farmsCollection,
            cluster: true,
            clusterMaxZoom: 11,
            clusterRadius: 46,
            clusterProperties: {
              chickenCount: [
                '+',
                ['case', ['==', ['get', 'category'], 'chicken'], 1, 0],
              ],
              pigCount: [
                '+',
                ['case', ['==', ['get', 'category'], 'pig'], 1, 0],
              ],
              otherCount: [
                '+',
                ['case', ['==', ['get', 'category'], 'other'], 1, 0],
              ],
            },
          });
        } else {
          (
            map.getSource('farms') as maplibregl.GeoJSONSource | undefined
          )?.setData(farmsCollection);
        }

        // 2. Nguồn GeoJSON riêng "hub-source" (KHÔNG cluster) cho Nhà Máy Cám trung tâm
        if (!map.getSource('hub-source')) {
          map.addSource('hub-source', {
            type: 'geojson',
            data: hubCollection,
          });
        } else {
          (
            map.getSource('hub-source') as maplibregl.GeoJSONSource | undefined
          )?.setData(hubCollection);
        }

        // 3. Nguồn riêng cho điểm đang chọn & vòng pulse quanh chân ghim (luôn rõ ở mọi zoom)
        if (!map.getSource('selected-pin-source')) {
          map.addSource('selected-pin-source', {
            type: 'geojson',
            data: selectedCollection,
          });
        } else {
          (
            map.getSource('selected-pin-source') as
              | maplibregl.GeoJSONSource
              | undefined
          )?.setData(selectedCollection);
        }

        if (!map.getSource('selected-pulse-source')) {
          map.addSource('selected-pulse-source', {
            type: 'geojson',
            data: pulseCollection,
          });
        } else {
          (
            map.getSource('selected-pulse-source') as
              | maplibregl.GeoJSONSource
              | undefined
          )?.setData(pulseCollection);
        }

        // Vòng sáng pulse nhịp thở quanh chân ghim khi được chọn
        if (!map.getLayer('farm-selected-pulse-outer')) {
          map.addLayer({
            id: 'farm-selected-pulse-outer',
            type: 'circle',
            source: 'selected-pulse-source',
            paint: {
              'circle-pitch-alignment': 'map',
              'circle-radius': 18,
              'circle-color': ['get', 'color'],
              'circle-opacity': 0.28,
              'circle-stroke-width': 2.6,
              'circle-stroke-color': '#facc15',
              'circle-stroke-opacity': 0.9,
            },
          });
        }

        if (!map.getLayer('farm-selected-pulse-inner')) {
          map.addLayer({
            id: 'farm-selected-pulse-inner',
            type: 'circle',
            source: 'selected-pulse-source',
            paint: {
              'circle-pitch-alignment': 'map',
              'circle-radius': 10,
              'circle-color': '#facc15',
              'circle-opacity': 0.35,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-opacity': 0.95,
            },
          });
        }

        // Bong bóng cụm (cluster) ở zoom nhỏ: đổ bóng mềm, viền trắng dày, màu theo loại chiếm đa số
        const clusterRadiusExpr: maplibregl.ExpressionSpecification = [
          'step',
          ['get', 'point_count'],
          18,
          5,
          22,
          12,
          26,
        ];

        const clusterColorExpr: maplibregl.ExpressionSpecification = [
          'case',
          [
            'all',
            ['>=', ['get', 'pigCount'], ['get', 'chickenCount']],
            ['>=', ['get', 'pigCount'], ['get', 'otherCount']],
          ],
          '#f43f5e',
          [
            'all',
            ['>=', ['get', 'chickenCount'], ['get', 'pigCount']],
            ['>=', ['get', 'chickenCount'], ['get', 'otherCount']],
          ],
          '#f97316',
          '#14b8a6',
        ];

        if (!map.getLayer('farm-clusters-shadow')) {
          map.addLayer({
            id: 'farm-clusters-shadow',
            type: 'circle',
            source: 'farms',
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': 'rgba(15, 23, 42, 0.32)',
              'circle-radius': clusterRadiusExpr,
              'circle-blur': 0.65,
              'circle-translate': [0, 3.5],
            },
          });
        }

        if (!map.getLayer('farm-clusters')) {
          map.addLayer({
            id: 'farm-clusters',
            type: 'circle',
            source: 'farms',
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': clusterColorExpr,
              'circle-radius': clusterRadiusExpr,
              'circle-stroke-width': 3.5,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': 0.96,
            },
          });
        }

        if (!map.getLayer('farm-cluster-count')) {
          map.addLayer({
            id: 'farm-cluster-count',
            type: 'symbol',
            source: 'farms',
            filter: ['has', 'point_count'],
            layout: {
              'text-field': ['get', 'point_count_abbreviated'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 13,
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            },
            paint: {
              'text-color': '#ffffff',
              'text-halo-color': 'rgba(15, 23, 42, 0.35)',
              'text-halo-width': 1,
            },
          });
        }

        const deviceFactor = getDeviceSizeFactor();

        // Kích thước chuẩn từ ảnh gốc 256x256px (64px logic):
        // z8 ~ 29–33px (28–34px), z12 ~ 39–44px, z16 ~ 48–55px (44–56px)
        const buildPinSizeExpr = (
          mult: number
        ): maplibregl.ExpressionSpecification => [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          0.46 * deviceFactor * mult,
          8,
          0.52 * deviceFactor * mult,
          12,
          0.68 * deviceFactor * mult,
          14,
          0.78 * deviceFactor * mult,
          16,
          0.86 * deviceFactor * mult,
          19,
          0.9 * deviceFactor * mult,
        ];

        // Layer tên trại dưới chân ghim khi phóng gần (zoom >= 11)
        if (!map.getLayer('farm-labels')) {
          map.addLayer({
            id: 'farm-labels',
            type: 'symbol',
            source: 'farms',
            minzoom: 11,
            filter: ['!', ['has', 'point_count']],
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
              'text-offset': [0, 0.4],
              'text-max-width': 14,
              'text-optional': true,
              'text-allow-overlap': false,
            },
            paint: {
              'text-color': '#0f2a24',
              'text-halo-color': '#ffffff',
              'text-halo-width': 2.2,
              'text-halo-blur': 0.4,
            },
          });
        }

        // Layer ghim 3D chuẩn cho các trang trại tách cụm
        if (!map.getLayer('farm-icons')) {
          map.addLayer({
            id: 'farm-icons',
            type: 'symbol',
            source: 'farms',
            filter: ['!', ['has', 'point_count']],
            layout: {
              'icon-image': ['get', 'iconImage'],
              'icon-size': buildPinSizeExpr(1),
              'icon-anchor': 'bottom',
              'icon-offset': [0, 0],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-pitch-alignment': 'viewport',
              'icon-rotation-alignment': 'viewport',
              'symbol-sort-key': ['-', 90, ['get', 'lat']],
            },
            paint: {
              'icon-opacity': 1,
            },
          });
        }

        // Layer Hover: phóng 1.1x và nâng nhẹ 3D
        if (!map.getLayer('farm-hovered')) {
          map.addLayer({
            id: 'farm-hovered',
            type: 'symbol',
            source: 'farms',
            filter: ['==', ['get', 'id'], '__NONE__'],
            layout: {
              'icon-image': ['get', 'iconImage'],
              'icon-size': buildPinSizeExpr(1.1),
              'icon-anchor': 'bottom',
              'icon-offset': [0, -3],
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

        // Layer Đang chọn: phóng to 1.22x với hào quang vàng rực (từ nguồn không gom cụm)
        if (!map.getLayer('farm-selected')) {
          map.addLayer({
            id: 'farm-selected',
            type: 'symbol',
            source: 'selected-pin-source',
            layout: {
              'icon-image': ['get', 'selectedIconImage'],
              'icon-size': buildPinSizeExpr(1.22),
              'icon-anchor': 'bottom',
              'icon-offset': [0, -3],
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

        // Layer Nhà Máy Cám trung tâm (KHÔNG bao giờ bị gom cụm, luôn to nổi bật với viền vàng)
        if (!map.getLayer('hub-label')) {
          map.addLayer({
            id: 'hub-label',
            type: 'symbol',
            source: 'hub-source',
            layout: {
              'text-field': ['get', 'name'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 12,
              'text-anchor': 'left',
              'text-offset': [1.6, -1.3],
              'text-optional': true,
              'text-allow-overlap': false,
            },
            paint: {
              'text-color': '#0f2a24',
              'text-halo-color': '#ffffff',
              'text-halo-width': 2.4,
              'text-opacity': 1,
            },
          });
        }

        if (!map.getLayer('hub-icon')) {
          map.addLayer({
            id: 'hub-icon',
            type: 'symbol',
            source: 'hub-source',
            layout: {
              'icon-image': 'farm-icon-hub',
              'icon-size': buildPinSizeExpr(1.25),
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
          curSelected?.id || null,
          curHubSelected,
          curHub?.id || null,
          null,
          '',
          new Set()
        );
      },
      [
        applyLayerFiltersAndStyles,
        buildFarmsSourceGeoJSON,
        buildSelectedPinGeoJSON,
      ]
    );

    // Khởi tạo Bản đồ 2D (MapLibre GL — Style hợp nhất 1 lần duy nhất, giữ cache tile chống chớp trắng/xám)
    useEffect(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      const initialStyle = createUnifiedBasemapStyle(
        mapStyleMode,
        esriMaxZoomRef.current
      );

      const { center, zoom } = getSystemCenterAndZoom(farms, centralHub);

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: initialStyle,
        center,
        zoom: Math.min(zoom, 15),
        minZoom: 2,
        maxZoom: 19,
        pitch: 0,
        bearing: 0,
        maxPitch: 0,
        dragRotate: false,
        touchPitch: false,
        pixelRatio: getOptimalPixelRatio(liteMode),
        maxTileCacheSize: MAP_TILE_PRELOAD_CONFIG.maxTileCacheSize,
        maxTileCacheZoomLevels: MAP_TILE_PRELOAD_CONFIG.maxTileCacheZoomLevels,
        fadeDuration: MAP_TILE_PRELOAD_CONFIG.rasterFadeDurationMs,
        refreshExpiredTiles: false,
        attributionControl: false,
      });

      // Tinh chỉnh tốc độ cuộn chuột & pinch zoom mượt, tránh nhảy bậc quá mạnh gây trống tile
      try {
        map.scrollZoom.setWheelZoomRate(MAP_ZOOM_CONFIG.wheelZoomRate);
        map.scrollZoom.setZoomRate(MAP_ZOOM_CONFIG.trackpadZoomRate);
      } catch {
        // ignore
      }

      map.on('styleimagemissing', (e) => {
        if (e?.id) {
          addSingleFarmIconToMap(map, e.id);
        }
      });

      // Chuyển nguồn nền Đường bằng cross-fade opacity — TUYỆT ĐỐI không gọi map.setStyle() để giữ nguyên tile cache
      const switchStreetProvider = (nextProvider: StreetBasemapProvider) => {
        if (streetProviderRef.current === nextProvider) return;
        streetProviderRef.current = nextProvider;
        setStreetProvider(nextProvider);
        if (!isMapLoadedRef.current) return;
        if (nextProvider === 'carto') {
          ensureCartoLayerAttached(map);
        }
        applyBasemapVisibility(map, currentStyleModeRef.current, nextProvider);
      };

      // Tự động thăm dò 1 tile Carto Voyager: chỉ kích hoạt Carto nếu ảnh trả về là tile bản đồ thật (> 3500 bytes),
      // tránh ảnh giả 2049 bytes "API KEY REQUIRED" mà Carto vẫn trả HTTP 200. Nếu bị chặn, giữ nguyên OpenStreetMap chuẩn.
      let isProbeCancelled = false;
      const probeCartoVoyager = async () => {
        try {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 3500);
          const res = await fetch(CARTO_VOYAGER_PROBE_URL, {
            method: 'GET',
            mode: 'cors',
            signal: controller.signal,
          });
          window.clearTimeout(timer);
          if (!res.ok || isProbeCancelled) return;
          const blob = await res.blob();
          if (!isProbeCancelled && blob.size > 3500 && mapRef.current === map) {
            switchStreetProvider('carto');
          }
        } catch {
          // Carto không khả dụng -> giữ nguyên OpenStreetMap chuẩn
        }
      };
      void probeCartoVoyager();

      map.on(
        'error',
        (errEvent: maplibregl.ErrorEvent & { sourceId?: string }) => {
          const sourceId = errEvent?.sourceId || '';
          const errMsg = String(errEvent?.error?.message || '').toLowerCase();

          // 1. Tự động fallback cho chế độ "Đường": Carto -> OpenStreetMap -> Esri World Street Map (không mất nền)
          if (currentStyleModeRef.current === 'street') {
            if (
              streetProviderRef.current === 'carto' &&
              (sourceId === 'carto-voyager' || errMsg.includes('carto'))
            ) {
              switchStreetProvider('osm');
              return;
            }

            if (
              streetProviderRef.current === 'osm' &&
              (sourceId === 'osm-standard' || errMsg.includes('openstreetmap'))
            ) {
              const now = Date.now();
              const recent = streetErrorTimestampsRef.current.filter(
                (ts) => now - ts <= 10_000
              );
              recent.push(now);
              streetErrorTimestampsRef.current = recent;

              if (recent.length >= 3) {
                streetErrorTimestampsRef.current = [];
                switchStreetProvider('esri-street');
              }
            }
            return;
          }

          // 2. Nếu lớp Địa hình hoặc Vệ tinh Esri tải lỗi -> tự động cross-fade về Bản đồ đường
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
          'hub-icon',
          'hub-label',
          'farm-selected',
          'farm-hovered',
          'farm-icons',
          'farm-clusters',
        ].filter((id) => Boolean(map.getLayer(id)));

        if (activeLayers.length === 0) return null;

        const touchBox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [point.x - 26, point.y - 26],
          [point.x + 26, point.y + 26],
        ];
        const feats = map.queryRenderedFeatures(touchBox, {
          layers: activeLayers,
        });

        if (feats.length === 0) return null;
        if (feats.length === 1) return feats[0];

        const hubFeat = feats.find(
          (f) =>
            f.layer?.id === 'hub-icon' ||
            f.layer?.id === 'hub-label' ||
            f.properties?.isHub ||
            f.properties?.isFeedMill
        );
        if (hubFeat) return hubFeat;

        let bestFeat = feats[0];
        let bestDistSq = Number.POSITIVE_INFINITY;

        for (const f of feats) {
          const props = f.properties || {};
          if (props.cluster && f.geometry?.type === 'Point') {
            const c = f.geometry.coordinates as [number, number];
            const screenPt = map.project(c);
            const dx = screenPt.x - point.x;
            const dy = screenPt.y - point.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
              bestDistSq = distSq;
              bestFeat = f;
            }
            continue;
          }
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

      const queryArcAtPoint = (point: maplibregl.Point) => {
        if (!showFactoryArcs) return null;
        if (!map.getLayer('supply-bezier-hit')) return null;
        const arcBox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [point.x - 8, point.y - 8],
          [point.x + 8, point.y + 8],
        ];
        const feats = map.queryRenderedFeatures(arcBox, {
          layers: ['supply-bezier-hit'],
        });
        return feats.length > 0 ? feats[0] : null;
      };

      map.on('click', (e) => {
        const feat = queryInteractiveFeatureAtPoint(e.point);
        if (!feat) {
          // Hỗ trợ chạm/click trực tiếp vào đường cung mảnh để nổi bật & xem thông tin trại đích
          const arcFeat = queryArcAtPoint(e.point);
          const arcFarmId = String(arcFeat?.properties?.farmId || '');
          if (arcFarmId) {
            hoveredArcFarmIdRef.current = arcFarmId;
            arcDirtyRef.current = true;
            const matchedArcFarm = latestStateRef.current.farms.find(
              (f) => f.id === arcFarmId
            );
            if (matchedArcFarm) {
              latestStateRef.current.onSelectFarm(matchedArcFarm);
              return;
            }
          }
          hoveredArcFarmIdRef.current = null;
          arcDirtyRef.current = true;
          latestStateRef.current.onClearSelection();
          return;
        }

        const props = feat.properties || {};

        if (props.cluster && props.cluster_id !== undefined) {
          const clusterId = Number(props.cluster_id);
          const farmsSource = map.getSource('farms') as
            | maplibregl.GeoJSONSource
            | undefined;
          if (farmsSource && feat.geometry?.type === 'Point') {
            const centerCoords = feat.geometry.coordinates as [number, number];
            void farmsSource
              .getClusterExpansionZoom(clusterId)
              .then((expansionZoom) => {
                map.easeTo({
                  center: centerCoords,
                  zoom: Math.min(
                    Math.max(expansionZoom + 0.65, map.getZoom() + 1.5),
                    15.5
                  ),
                  duration: 650,
                  essential: true,
                });
              })
              .catch(() => {
                map.easeTo({
                  center: centerCoords,
                  zoom: Math.min(map.getZoom() + 2, 15),
                  duration: 600,
                });
              });
          }
          return;
        }

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
        if (isMapInteractingRef.current) return;

        const feat = queryInteractiveFeatureAtPoint(e.point);
        if (!feat) {
          const arcFeat = queryArcAtPoint(e.point);
          const arcFarmId = String(arcFeat?.properties?.farmId || '');
          if (arcFarmId) {
            map.getCanvas().style.cursor = 'pointer';
            if (hoveredArcFarmIdRef.current !== arcFarmId) {
              hoveredArcFarmIdRef.current = arcFarmId;
              arcDirtyRef.current = true;
            }
            const matchedArcFarm = latestStateRef.current.farms.find(
              (f) => f.id === arcFarmId
            );
            if (matchedArcFarm) {
              setHoveredTooltip({
                name: `Tuyến tới ${matchedArcFarm.name}`,
                badge:
                  matchedArcFarm.category === 'pig' ? 'Trại heo' : 'Trại gà',
                x: e.point.x,
                y: e.point.y,
              });
            }
            setHoveredId((prev) => (prev !== null ? null : prev));
            return;
          }

          if (hoveredArcFarmIdRef.current !== null) {
            hoveredArcFarmIdRef.current = null;
            arcDirtyRef.current = true;
          }
          map.getCanvas().style.cursor = '';
          setHoveredId((prev) => (prev !== null ? null : prev));
          setHoveredTooltip((prev) => (prev !== null ? null : prev));
          return;
        }

        map.getCanvas().style.cursor = 'pointer';
        const props = feat.properties || {};

        if (props.cluster) {
          if (hoveredArcFarmIdRef.current !== null) {
            hoveredArcFarmIdRef.current = null;
            arcDirtyRef.current = true;
          }
          setHoveredId((prev) => (prev !== null ? null : prev));
          if (feat.geometry?.type === 'Point') {
            const c = feat.geometry.coordinates as [number, number];
            const projected = map.project(c);
            const totalPts = Number(props.point_count || 0);
            setHoveredTooltip({
              name: `Cụm ${totalPts} địa điểm`,
              badge: 'Bấm để phóng to',
              x: projected.x,
              y: projected.y,
            });
          }
          return;
        }

        const farmId = String(props.id || props.farmId || '');
        if (props.isHub) {
          if (hoveredArcFarmIdRef.current !== null) {
            hoveredArcFarmIdRef.current = null;
            arcDirtyRef.current = true;
          }
          setHoveredId(farmId);
          setHoveredTooltip(null);
          return;
        }

        const matched = latestStateRef.current.farms.find(
          (f) => f.id === farmId
        );
        if (matched) {
          if (hoveredArcFarmIdRef.current !== matched.id) {
            hoveredArcFarmIdRef.current = matched.id;
            arcDirtyRef.current = true;
          }
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

      // Tạm dừng các vòng lặp hiệu ứng nặng khi đang kéo/zoom để giữ mượt 60fps & preload tile mức zoom liền kề khi dừng
      const markInteractionStart = () => {
        if (interactionResumeTimerRef.current !== null) {
          window.clearTimeout(interactionResumeTimerRef.current);
          interactionResumeTimerRef.current = null;
        }
        isMapInteractingRef.current = true;
        setHoveredTooltip((prev) => (prev !== null ? null : prev));
      };

      const markInteractionEnd = () => {
        if (interactionResumeTimerRef.current !== null) {
          window.clearTimeout(interactionResumeTimerRef.current);
        }
        interactionResumeTimerRef.current = window.setTimeout(() => {
          isMapInteractingRef.current = false;
          arcDirtyRef.current = true;

          // Preload nhẹ các tile mức zoom lân cận (z-1, z+1) theo throttle để zoom ra/vào không bị trống
          const now = Date.now();
          if (
            now - lastPreloadTsRef.current >=
            MAP_TILE_PRELOAD_CONFIG.moveThrottleMs
          ) {
            lastPreloadTsRef.current = now;
            preloadAdjacentZoomTiles(
              map,
              currentStyleModeRef.current,
              streetProviderRef.current,
              preloadedTileUrlsRef.current
            );
          }
        }, 80);
      };

      map.on('movestart', markInteractionStart);
      map.on('zoomstart', markInteractionStart);
      map.on('moveend', markInteractionEnd);
      map.on('zoomend', markInteractionEnd);

      map.on('load', () => {
        isMapLoadedRef.current = true;
        if (streetProviderRef.current === 'carto') {
          ensureCartoLayerAttached(map);
        }
        applyBasemapVisibility(
          map,
          currentStyleModeRef.current,
          streetProviderRef.current
        );
        setupCustomLayers(map);
        // Preload trước một số tile mức zoom lân cận quanh vùng trung tâm
        preloadAdjacentZoomTiles(
          map,
          currentStyleModeRef.current,
          streetProviderRef.current,
          preloadedTileUrlsRef.current
        );
      });

      mapRef.current = map;

      // Khi đổi kích thước cửa sổ hoặc xoay màn hình -> giữ nguyên tâm & mức zoom hiện tại
      let resizeRafId: number | null = null;
      const handleViewportResize = () => {
        if (!mapRef.current) return;
        if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          const m = mapRef.current;
          if (!m) return;
          try {
            const preservedCenter = m.getCenter();
            const preservedZoom = m.getZoom();
            m.resize();
            m.jumpTo({
              center: preservedCenter,
              zoom: preservedZoom,
              pitch: 0,
              bearing: 0,
            });
            arcDirtyRef.current = true;
          } catch {
            // ignore
          }
        });
      };

      const resizeObserver = new ResizeObserver(() => {
        handleViewportResize();
      });
      resizeObserver.observe(mapContainerRef.current);

      window.addEventListener('resize', handleViewportResize);
      window.addEventListener('orientationchange', handleViewportResize);

      return () => {
        isProbeCancelled = true;
        if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
        if (interactionResumeTimerRef.current !== null) {
          window.clearTimeout(interactionResumeTimerRef.current);
        }
        resizeObserver.disconnect();
        window.removeEventListener('resize', handleViewportResize);
        window.removeEventListener('orientationchange', handleViewportResize);
        map.remove();
        mapRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Khi chuyển từ Quả địa cầu 3D sang Bản đồ 2D, gọi map.resize() + triggerRepaint() (giữ nguyên 1 instance duy nhất)
    useEffect(() => {
      if (stage === 'map' && mapRef.current) {
        mapRef.current.resize();
        mapRef.current.triggerRepaint();
        arcDirtyRef.current = true;
        const t = window.setTimeout(() => {
          mapRef.current?.resize();
          mapRef.current?.triggerRepaint();
        }, 60);
        return () => window.clearTimeout(t);
      }
    }, [stage]);

    // Chuyển đổi 3 lớp nền Đường | Địa hình | Vệ tinh bằng cross-fade opacity (KHÔNG gọi map.setStyle() -> ZERO chớp trắng/xám!)
    const currentStyleModeRef = useRef<MapStyleMode>(mapStyleMode);
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      if (currentStyleModeRef.current === mapStyleMode) return;

      currentStyleModeRef.current = mapStyleMode;
      tileErrorTimestampsRef.current = [];

      if (isMapLoadedRef.current) {
        applyBasemapVisibility(map, mapStyleMode, streetProviderRef.current);
        preloadAdjacentZoomTiles(
          map,
          mapStyleMode,
          streetProviderRef.current,
          preloadedTileUrlsRef.current
        );
      }
    }, [mapStyleMode]);

    // Cập nhật dữ liệu source "farms" (có gom cụm) & "hub-source" (không gom cụm) trên Bản đồ 2D
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;

      const { farmsCollection, hubCollection } = buildFarmsSourceGeoJSON(
        farms,
        centralHub,
        activeCategories,
        customLabels
      );
      (
        map.getSource('farms') as maplibregl.GeoJSONSource | undefined
      )?.setData(farmsCollection);
      (
        map.getSource('hub-source') as maplibregl.GeoJSONSource | undefined
      )?.setData(hubCollection);
    }, [
      farms,
      centralHub,
      activeCategories,
      customLabels,
      buildFarmsSourceGeoJSON,
    ]);

    // Cập nhật nguồn riêng cho điểm đang chọn & vòng pulse quanh chân ghim
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;

      const { selectedCollection, pulseCollection } = buildSelectedPinGeoJSON(
        selectedFarm,
        isHubSelected,
        centralHub,
        customLabels
      );
      (
        map.getSource('selected-pin-source') as
          | maplibregl.GeoJSONSource
          | undefined
      )?.setData(selectedCollection);
      (
        map.getSource('selected-pulse-source') as
          | maplibregl.GeoJSONSource
          | undefined
      )?.setData(pulseCollection);
    }, [
      selectedFarm,
      isHubSelected,
      centralHub,
      customLabels,
      buildSelectedPinGeoJSON,
    ]);

    // Hiệu ứng vòng sáng pulse nhịp nhàng quanh chân ghim đang chọn trên Bản đồ 2D (tự tạm dừng khi đang kéo/zoom)
    useEffect(() => {
      const map = mapRef.current;
      if (stage !== 'map' || (!selectedFarm && !isHubSelected) || !map) return;

      let rafId = 0;
      const startTime = performance.now();

      const animateSelectedPulse = (now: number) => {
        if (!mapRef.current || !isMapLoadedRef.current) return;

        if (!isMapInteractingRef.current) {
          const cycle = ((now - startTime) % 1500) / 1500;
          const eased = 1 - Math.pow(1 - cycle, 2);
          const outerRadius = 11 + eased * 20;
          const outerStrokeOpacity = Math.max(0, (1 - cycle) * 0.88);
          const outerFillOpacity = Math.max(0, (1 - cycle) * 0.3);
          const innerRadius = 8 + Math.sin(cycle * Math.PI) * 3.2;

          try {
            if (map.getLayer('farm-selected-pulse-outer')) {
              map.setPaintProperty(
                'farm-selected-pulse-outer',
                'circle-radius',
                outerRadius
              );
              map.setPaintProperty(
                'farm-selected-pulse-outer',
                'circle-opacity',
                outerFillOpacity
              );
              map.setPaintProperty(
                'farm-selected-pulse-outer',
                'circle-stroke-opacity',
                outerStrokeOpacity
              );
            }
            if (map.getLayer('farm-selected-pulse-inner')) {
              map.setPaintProperty(
                'farm-selected-pulse-inner',
                'circle-radius',
                innerRadius
              );
            }
          } catch {
            // ignore
          }
        }

        rafId = requestAnimationFrame(animateSelectedPulse);
      };

      rafId = requestAnimationFrame(animateSelectedPulse);
      return () => cancelAnimationFrame(rafId);
    }, [stage, selectedFarm, isHubSelected]);

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

    // Đồng bộ hover 1.1x, trạng thái chọn & opacity trên Bản đồ 2D
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;

      applyLayerFiltersAndStyles(
        map,
        selectedFarm?.id || null,
        isHubSelected,
        centralHub?.id || null,
        hoveredId,
        normalizedQuery,
        matchedFarmIds
      );
    }, [
      selectedFarm,
      isHubSelected,
      centralHub,
      hoveredId,
      normalizedQuery,
      matchedFarmIds,
      applyLayerFiltersAndStyles,
    ]);

    // =========================================================================
    // 3. LUỒNG ĐỐM SÁNG CHẠY MỘT CHIỀU TỪ NHÀ MÁY ➔ TRẠI GÀ & TRẠI HEO TRÊN BẢN ĐỒ 2D
    //    - Cache tọa độ Bezier 1 lần, không tính lại mỗi frame zoom/pan
    //    - Đường cung mảnh thanh thoát hơn 50-60%, nổi bật khi rê chuột/chạm
    //    - Tự tạm dừng khi đang kéo/zoom và lọc bỏ cung ngoài viewport để đạt 60fps
    // =========================================================================
    const prevActiveTargetsRef = useRef<Farm[]>([]);
    const arcModeRef = useRef<'idle' | 'growing' | 'active' | 'shrinking'>(
      'idle'
    );
    const arcTransitionStartRef = useRef<number>(0);

    const evaluateQuadraticBezier = useCallback(
      (
        p0: [number, number],
        p1: [number, number],
        p2: [number, number],
        t: number
      ): [number, number] => {
        const inv = 1 - t;
        const lng = inv * inv * p0[0] + 2 * inv * t * p1[0] + t * t * p2[0];
        const lat = inv * inv * p0[1] + 2 * inv * t * p1[1] + t * t * p2[1];
        return [lng, lat];
      },
      []
    );

    useEffect(() => {
      const now = performance.now();
      arcDirtyRef.current = true;
      if (showFactoryArcs && activeTargetFarms.length > 0) {
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
    }, [activeTargetFarms, showFactoryArcs]);

    // Đánh dấu cập nhật highlight đường cung khi điểm đang chọn thay đổi
    useEffect(() => {
      arcDirtyRef.current = true;
    }, [selectedFarm, singleArcFarmId]);

    // Cache hình học đường cung Bezier tĩnh một lần cho từng tập mục tiêu (tránh tính lại 18 điểm mỗi frame)
    const cachedArcGeometries = useMemo(() => {
      const targets =
        activeTargetFarms.length > 0
          ? activeTargetFarms
          : prevActiveTargetsRef.current;
      if (!centralHub || targets.length === 0) return [];

      let hubCoords: [number, number] = [
        Number(centralHub.lng),
        Number(centralHub.lat),
      ];
      if (Math.abs(hubCoords[0]) < 30 && Math.abs(hubCoords[1]) >= 30) {
        hubCoords = [hubCoords[1], hubCoords[0]];
      }
      const [hubLng, hubLat] = hubCoords;

      return targets.map((farm, idx) => {
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

        const steps = 18;
        const fullCoords: Array<[number, number]> = [];
        let minLng = Math.min(hubLng, farmLng);
        let maxLng = Math.max(hubLng, farmLng);
        let minLat = Math.min(hubLat, farmLat);
        let maxLat = Math.max(hubLat, farmLat);

        for (let s = 0; s <= steps; s++) {
          const pt = evaluateQuadraticBezier(
            [hubLng, hubLat],
            ctrlPt,
            [farmLng, farmLat],
            s / steps
          );
          fullCoords.push(pt);
          if (pt[0] < minLng) minLng = pt[0];
          if (pt[0] > maxLng) maxLng = pt[0];
          if (pt[1] < minLat) minLat = pt[1];
          if (pt[1] > maxLat) maxLat = pt[1];
        }

        const isPig = farm.category === 'pig';
        return {
          farm,
          idx,
          hubLng,
          hubLat,
          farmLng,
          farmLat,
          ctrlPt,
          fullCoords,
          bbox: [minLng, minLat, maxLng, maxLat] as [
            number,
            number,
            number,
            number,
          ],
          lineColor: isPig ? '#e11d48' : '#ea580c',
          coreColor: isPig ? '#f43f5e' : '#f97316',
        };
      });
    }, [activeTargetFarms, centralHub, evaluateQuadraticBezier]);

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

        if (!centralHub || cachedArcGeometries.length === 0) {
          arcModeRef.current = 'idle';
          clearSupplyGeoJSONSources();
          return;
        }

        // Tạm dừng cập nhật nặng khi người dùng đang zoom/kéo hoặc đang ở màn hình Quả địa cầu 3D
        if (
          isMapInteractingRef.current ||
          latestStateRef.current.stage !== 'map'
        ) {
          animId = requestAnimationFrame(animateArcs);
          return;
        }

        const elapsedMs = now - arcTransitionStartRef.current;
        let globalFade = 1;

        if (mode === 'growing' && elapsedMs >= 300) {
          arcModeRef.current = 'active';
          arcDirtyRef.current = true;
        } else if (mode === 'shrinking') {
          if (elapsedMs >= 300) {
            arcModeRef.current = 'idle';
            prevActiveTargetsRef.current = [];
            clearSupplyGeoJSONSources();
            return;
          }
          globalFade = Math.max(0, 1 - elapsedMs / 300);
        }

        phase += liteMode ? 0.015 : 0.02;
        const total = Math.max(1, cachedArcGeometries.length);
        const hubLng = cachedArcGeometries[0].hubLng;
        const hubLat = cachedArcGeometries[0].hubLat;

        const activeHighlightId =
          hoveredArcFarmIdRef.current ||
          latestStateRef.current.selectedFarm?.id ||
          null;
        const hasMultiHighlight =
          total > 1 &&
          activeHighlightId !== null &&
          cachedArcGeometries.some((g) => g.farm.id === activeHighlightId);

        const highlightKey = hasMultiHighlight ? activeHighlightId : null;
        const shouldUploadArcLines =
          arcModeRef.current !== 'active' ||
          arcDirtyRef.current ||
          lastRenderedArcHighlightRef.current !== highlightKey;

        // Lọc viewport có đệm để chỉ vẽ các đường cung nằm trong vùng nhìn thấy
        const bounds = map.getBounds();
        const padLng = Math.max(
          0.15,
          (bounds.getEast() - bounds.getWest()) * 0.2
        );
        const padLat = Math.max(
          0.15,
          (bounds.getNorth() - bounds.getSouth()) * 0.2
        );
        const viewWest = bounds.getWest() - padLng;
        const viewEast = bounds.getEast() + padLng;
        const viewSouth = bounds.getSouth() - padLat;
        const viewNorth = bounds.getNorth() + padLat;

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

        // Vòng sóng nhẹ lan tỏa liên tục quanh Nhà Máy Cám (tỷ lệ thanh mảnh cân đối)
        for (let rIdx = 0; rIdx < 2; rIdx++) {
          const hubWave = (phase * 0.85 + rIdx * 0.5) % 1;
          impactRingFeatures.push({
            type: 'Feature',
            properties: {
              radius: 8 + hubWave * 20,
              color: '#38bdf8',
              fillOpacity: Math.max(0, (1 - hubWave) * 0.18 * globalFade),
              strokeWidth: 1.5,
              strokeColor: '#facc15',
              strokeOpacity: Math.max(0, (1 - hubWave) * 0.8 * globalFade),
            },
            geometry: {
              type: 'Point',
              coordinates: [hubLng, hubLat],
            },
          });
        }

        const streamCount = liteMode ? 1 : 2;
        const trailSteps = liteMode ? 2 : 3;

        for (const arc of cachedArcGeometries) {
          const [minLng, minLat, maxLng, maxLat] = arc.bbox;
          if (
            maxLng < viewWest ||
            minLng > viewEast ||
            maxLat < viewSouth ||
            minLat > viewNorth
          ) {
            continue;
          }

          let reachProgress = 1;
          if (arcModeRef.current === 'growing') {
            const staggerDelay = total > 1 ? (arc.idx / (total - 1)) * 380 : 0;
            const localElapsed = Math.max(0, elapsedMs - staggerDelay);
            const rawT = Math.min(1, localElapsed / 620);
            reachProgress = 1 - Math.pow(1 - rawT, 3);
          } else if (arcModeRef.current === 'shrinking') {
            const shrinkT = Math.min(1, elapsedMs / 500);
            reachProgress = Math.max(0, 1 - shrinkT);
          }

          const isHighlighted = hasMultiHighlight && arc.farm.id === highlightKey;
          const isDimmed = hasMultiHighlight && !isHighlighted;

          if (shouldUploadArcLines && reachProgress > 0.03) {
            let coords: Array<[number, number]>;
            if (reachProgress >= 0.995) {
              coords = arc.fullCoords;
            } else {
              const steps = 18;
              coords = [];
              for (let s = 0; s <= steps; s++) {
                const t = (s / steps) * reachProgress;
                coords.push(
                  evaluateQuadraticBezier(
                    [arc.hubLng, arc.hubLat],
                    arc.ctrlPt,
                    [arc.farmLng, arc.farmLat],
                    t
                  )
                );
              }
            }

            bezierLineFeatures.push({
              type: 'Feature',
              properties: {
                id: `bezier-${arc.farm.id}`,
                farmId: arc.farm.id,
                color: arc.lineColor,
                coreColor: arc.coreColor,
                widthScale: isHighlighted ? 1.48 : isDimmed ? 0.85 : 1.0,
                glowOpacity:
                  (isHighlighted ? 0.42 : isDimmed ? 0.08 : 0.22) * globalFade,
                coreOpacity:
                  (isHighlighted ? 0.98 : isDimmed ? 0.28 : 0.84) * globalFade,
              },
              geometry: {
                type: 'LineString',
                coordinates: coords,
              },
            });
          }

          const particleOpacityMult = isDimmed ? 0.3 : 1;

          // Hạt đốm sáng vàng thu nhỏ tỷ lệ đồng bộ với đường cung mảnh
          for (let sIdx = 0; sIdx < streamCount; sIdx++) {
            const headT =
              ((phase * 0.54 + arc.idx * 0.17 + sIdx * (1 / streamCount)) % 1) *
              reachProgress;

            for (let tr = 0; tr < trailSteps; tr++) {
              const trailT = headT - tr * 0.032;
              if (trailT <= 0.01 || trailT > reachProgress) continue;

              const pt = evaluateQuadraticBezier(
                [arc.hubLng, arc.hubLat],
                arc.ctrlPt,
                [arc.farmLng, arc.farmLat],
                trailT
              );
              const tailFactor = 1 - tr / trailSteps;
              const boost = isHighlighted ? 1.18 : 1;

              particleFeatures.push({
                type: 'Feature',
                properties: {
                  color: tr === 0 ? '#facc15' : arc.lineColor,
                  coreRadius: (tr === 0 ? 2.7 : 1.7 * tailFactor) * boost,
                  glowRadius: (tr === 0 ? 5.6 : 3.5 * tailFactor) * boost,
                  coreOpacity:
                    (tr === 0 ? 0.96 : 0.72 * tailFactor) *
                    globalFade *
                    particleOpacityMult,
                  glowOpacity:
                    (tr === 0 ? 0.7 : 0.4 * tailFactor) *
                    globalFade *
                    particleOpacityMult,
                },
                geometry: {
                  type: 'Point',
                  coordinates: pt,
                },
              });
            }

            if (reachProgress > 0.92 && headT >= 0.82 && !isDimmed) {
              const impactWave = (headT - 0.82) / 0.18;
              impactRingFeatures.push({
                type: 'Feature',
                properties: {
                  radius: 5 + impactWave * 13,
                  color: arc.lineColor,
                  fillOpacity: Math.max(
                    0,
                    (1 - impactWave) * 0.24 * globalFade
                  ),
                  strokeWidth: 1.5,
                  strokeColor: '#fef08a',
                  strokeOpacity: Math.max(
                    0,
                    (1 - impactWave) * 0.85 * globalFade
                  ),
                },
                geometry: {
                  type: 'Point',
                  coordinates: [arc.farmLng, arc.farmLat],
                },
              });
            }
          }
        }

        try {
          if (shouldUploadArcLines) {
            (
              map.getSource('supply-bezier-arcs') as
                | maplibregl.GeoJSONSource
                | undefined
            )?.setData({
              type: 'FeatureCollection',
              features: bezierLineFeatures,
            });
            arcDirtyRef.current = false;
            lastRenderedArcHighlightRef.current = highlightKey;
          }
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
    }, [cachedArcGeometries, centralHub, evaluateQuadraticBezier, liteMode]);

    const handleZoomIn = useCallback(() => {
      const map = mapRef.current;
      if (!map) return;
      map.zoomTo(Math.min(19, map.getZoom() + MAP_ZOOM_CONFIG.zoomButtonStep), {
        duration: MAP_ZOOM_CONFIG.zoomButtonDurationMs,
      });
    }, []);

    const handleZoomOut = useCallback(() => {
      const map = mapRef.current;
      if (!map) return;
      map.zoomTo(Math.max(2, map.getZoom() - MAP_ZOOM_CONFIG.zoomButtonStep), {
        duration: MAP_ZOOM_CONFIG.zoomButtonDurationMs,
      });
    }, []);

    const currentPreset = APP_CONFIG.timePresets[timeOfDay];

    return (
      <div
        className={`app-viewport relative transition-colors duration-500 ${
          stage === 'map' ? 'bg-[#f2efe9]' : 'bg-[#041829]'
        }`}
      >
        {/* Nền vũ trụ xanh đậm có sao mờ và quầng khí quyển cho Quả địa cầu 3D */}
        <SpaceOceanBackdrop visible={stage === 'globe'} liteMode={liteMode} />

        {/* 1. QUẢ ĐỊA CẦU 3D MẶC ĐỊNH (`globe.gl` + `THREE.Sprite` ghim icon rõ nét ở mọi mức zoom) */}
        <div
          ref={globeContainerRef}
          className={`map-gesture-surface fixed inset-0 z-10 transition-opacity duration-500 ${
            stage === 'globe'
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0'
          }`}
        />

        {/* 2. BẢN ĐỒ 2D PHẲNG NHẸ (MapLibre GL — Style hợp nhất chống chớp nền, pitch: 0) */}
        <div
          ref={mapContainerRef}
          className={`map-gesture-surface fixed inset-0 z-10 transition-opacity duration-500 ${
            stage === 'map'
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0'
          }`}
        />

        {/* Tooltip tên trang trại + nhãn mô tả khi rê chuột vào icon hoặc tuyến đường cung ở Bản đồ 2D */}
        {stage === 'map' && hoveredTooltip && (
          <div
            className="pointer-events-none fixed z-20 flex max-w-[80vw] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/95 bg-white/95 px-3 py-1 text-[11px] font-extrabold text-[#0f2a24] shadow-md backdrop-blur-md"
            style={{
              left: `${hoveredTooltip.x}px`,
              top: `${Math.max(hoveredTooltip.y - 50, 12)}px`,
            }}
          >
            <span className="truncate">{hoveredTooltip.name}</span>
            {hoveredTooltip.badge && (
              <span className="shrink-0 rounded-full bg-[#e6f4f1] px-2 py-0.5 text-[9.5px] font-bold text-[#145349]">
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
            <AtmosphericCloudsOverlay zoom={6.2} liteMode={liteMode} />
          </>
        )}

        {/* Cụm nút phóng to / thu nhỏ (+/-) tối thiểu 44x44px chuẩn chạm trên Bản đồ 2D */}
        {stage === 'map' && (
          <div
            className={`pointer-events-auto fixed right-2.5 z-20 flex-col gap-1.5 sm:right-4 ${
              selectedFarm || isHubSelected ? 'hidden sm:flex' : 'flex'
            }`}
            style={{
              bottom: 'calc(var(--safe-bottom) + 124px)',
            }}
            role="group"
            aria-label="Điều khiển phóng to thu nhỏ bản đồ"
          >
            <button
              type="button"
              onClick={handleZoomIn}
              title="Phóng to bản đồ"
              aria-label="Phóng to bản đồ"
              className="glass-panel flex h-11 w-11 items-center justify-center rounded-full border border-white/95 bg-white/92 text-[#0f2a24] shadow-[0_8px_20px_rgba(15,42,36,0.16)] transition-colors hover:border-[#2b8fd0] hover:text-[#2b8fd0] active:scale-95 cursor-pointer"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              title="Thu nhỏ bản đồ"
              aria-label="Thu nhỏ bản đồ"
              className="glass-panel flex h-11 w-11 items-center justify-center rounded-full border border-white/95 bg-white/92 text-[#0f2a24] shadow-[0_8px_20px_rgba(15,42,36,0.16)] transition-colors hover:border-[#2b8fd0] hover:text-[#2b8fd0] active:scale-95 cursor-pointer"
            >
              <Minus className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Thanh chuyển nhanh 3 lớp nền trực tiếp ở góc Bản đồ 2D: Đường | Địa hình | Vệ tinh */}
        {stage === 'map' && onSelectMapStyle && (
          <div
            className={`pointer-events-auto fixed left-2.5 bottom-[122px] z-20 max-w-[calc(100vw-72px)] items-center gap-0.5 rounded-full border border-white/95 bg-white/94 p-1 shadow-[0_8px_24px_rgba(15,42,36,0.18)] backdrop-blur-xl sm:bottom-[36px] sm:left-4 sm:max-w-none ${
              selectedFarm || isHubSelected ? 'hidden sm:flex' : 'flex'
            }`}
            role="group"
            aria-label="Chọn lớp nền bản đồ"
          >
            {(
              [
                {
                  key: 'street' as MapStyleMode,
                  label: 'Đường',
                  icon: <MapIcon className="h-3.5 w-3.5 shrink-0" />,
                },
                {
                  key: 'terrain' as MapStyleMode,
                  label: 'Địa hình',
                  icon: <Mountain className="h-3.5 w-3.5 shrink-0" />,
                },
                {
                  key: 'satellite' as MapStyleMode,
                  label: 'Vệ tinh',
                  icon: <Satellite className="h-3.5 w-3.5 shrink-0" />,
                },
              ] as const
            ).map((opt) => {
              const active = mapStyleMode === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onSelectMapStyle(opt.key)}
                  className={`flex min-h-[36px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold whitespace-nowrap transition-all cursor-pointer sm:px-3 ${
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
              bottom: 'calc(var(--safe-bottom) + 114px)',
            }}
          >
            <motion.button
              type="button"
              whileHover={{ y: -2, scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={onEnterMapOverview}
              title="Chuyển sang Bản đồ 2D chi tiết"
              className="glass-panel group flex min-h-[44px] items-center gap-2.5 rounded-full border-white/95 px-5 py-2 text-xs font-extrabold whitespace-nowrap text-[#0f2a24] shadow-[0_14px_32px_rgba(15,42,36,0.22)] transition-colors hover:border-[#2b8fd0] hover:bg-white cursor-pointer sm:text-sm"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2b8fd0] text-white shadow-xs transition-transform group-hover:scale-110">
                <MapIcon className="h-3.5 w-3.5" />
              </span>
              <span>Xem bản đồ chi tiết</span>
            </motion.button>
          </div>
        )}

        {/* Ghi nguồn (attribution) tự động cập nhật theo lớp nền đang bật ở góc trái dưới */}
        {stage === 'map' && (
          <div
            className="pointer-events-none fixed left-2.5 z-20 max-w-[75vw] truncate rounded-full border border-white/85 bg-white/88 px-2.5 py-0.5 text-[9.5px] font-semibold text-[#0f2a24] shadow-xs backdrop-blur-md sm:left-4 sm:max-w-lg sm:px-3 sm:py-1 sm:text-[10px]"
            style={{
              bottom: 'calc(var(--safe-bottom) + 6px)',
            }}
          >
            {mapStyleMode === 'satellite'
              ? '© Esri — Source: Esri, Maxar, Earthstar Geographics & GIS Community'
              : mapStyleMode === 'terrain'
              ? '© Esri — Esri World Topo Map, OpenStreetMap & GIS Community'
              : streetProvider === 'carto'
              ? '© OpenStreetMap contributors © CARTO'
              : streetProvider === 'esri-street'
              ? '© Esri — Esri, DeLorme, NAVTEQ, USGS, TomTom'
              : '© OpenStreetMap contributors'}
          </div>
        )}
      </div>
    );
  }
);
