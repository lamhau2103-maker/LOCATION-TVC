import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map as MapIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { APP_CONFIG, getCategoryConfig } from '../config';
import {
  AppStage,
  CentralHub,
  Farm,
  FarmCategory,
  MapStyleMode,
  PositionDiagnosticItem,
  TimeOfDay,
} from '../types';
import { buildAllFarms3DGeoJSON } from '../utils/buildings3d';
import {
  buildBiosecurityGeoJSON,
  calculateDistanceKm,
  getSystemCenterAndZoom,
} from '../utils/geo';
import {
  addSingleFarmIconToMap,
  registerMapLibreFarmIcons,
} from '../utils/icons';
import { AtmosphericCloudsOverlay } from './CursorSpotlight';

export interface MapSceneHandle {
  flyToFarm: (farm: Farm, zoom?: number) => void;
  flyToOverview: (duration?: number, pitch?: number) => void;
  flyToHub: () => void;
  flyToConnectedOverview: () => void;
  flyToGlobe: () => void;
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
  centralHub: CentralHub;
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
  isTourRunning: boolean;
  mapStyleMode: MapStyleMode;
  timeOfDay: TimeOfDay;
  liteMode: boolean;
  onSatelliteFallbackToStreet?: () => void;
}

const OPENFREEMAP_LIBERTY_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';
const ESRI_SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TERRARIUM_DEM_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const FALLBACK_GROUND_COLOR = '#d9ecd0';

function getTerrainExaggeration(zoom: number, isLite: boolean): number {
  if (isLite) return 0.55;
  return zoom >= 15 ? 1.2 : 1.4;
}

function getOptimalPixelRatio(isLite: boolean): number {
  if (isLite || typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio || 1;
  const isTouchOrTablet = window.innerWidth < 1024;
  return isTouchOrTablet ? Math.min(dpr, 1.65) : Math.min(dpr, 2);
}

/**
 * Hệ số kích thước theo thiết bị (điện thoại ~28px, iPad ~34px, laptop ~40px)
 * kết hợp với nội suy theo zoom (~0.5 ở zoom 6, ~0.7 ở zoom 12, ~0.85 từ zoom 15+)
 */
function getDeviceSizeFactor(): number {
  if (typeof window === 'undefined') return 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 640 || h < 500) return 0.78; // ~28px
  if (w < 1024) return 0.9; // ~34px
  return 1.0; // ~40px
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

function createSatelliteBaseStyle(
  satelliteMaxZoom = 16
): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: 'ThaiViet Satellite 3D',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
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
          'background-color': FALLBACK_GROUND_COLOR,
        },
      },
      {
        id: 'esri-satellite-base',
        type: 'raster',
        source: 'esri-world-imagery',
        paint: {
          'raster-opacity': 0.96,
          'raster-saturation': 0.08,
          'raster-contrast': 0.06,
        },
      },
    ],
  };
}

function lerpHexColor(hexA: string, hexB: string, t: number): string {
  const parseHex = (h: string) => {
    const clean = h.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = parseHex(hexA);
  const [r2, g2, b2] = parseHex(hexB);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Nền vũ trụ xanh đậm có sao mờ và quầng khí quyển xanh ngọc cho màn hình Địa cầu 3D
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
      className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-1000"
      style={{ opacity: visible ? 1 : 0.25 }}
    />
  );
};

export const MapScene = React.forwardRef<MapSceneHandle, MapSceneProps>(
  (
    {
      stage,
      farms,
      centralHub,
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
      isTourRunning,
      mapStyleMode,
      timeOfDay,
      liteMode,
      onSatelliteFallbackToStreet,
    },
    ref
  ) => {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const deckOverlayRef = useRef<MapboxOverlay | null>(null);
    const isMapLoadedRef = useRef(false);

    const esriMaxZoomRef = useRef<number>(16);
    const tileErrorTimestampsRef = useRef<number[]>([]);
    const currentTerrainExaggerationRef = useRef<number>(1.4);

    const isGlobeDraggingRef = useRef(false);
    const resumeRotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

    const [currentZoom, setCurrentZoom] = useState(2.35);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [hoveredTooltip, setHoveredTooltip] = useState<{
      name: string;
      x: number;
      y: number;
    } | null>(null);

    const buildingGrowScaleRef = useRef(1);
    const buildingAnimTriggeredRef = useRef(false);

    // Lưu toạ độ thực tế đang vẽ trong nguồn WebGL "farms" để đối chiếu trong "Kiểm tra vị trí"
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
        visibleFarms
          .filter(
            (f) =>
              f.name.toLowerCase().normalize('NFC').includes(normalizedQuery) ||
              f.type.toLowerCase().normalize('NFC').includes(normalizedQuery) ||
              f.description
                .toLowerCase()
                .normalize('NFC')
                .includes(normalizedQuery)
          )
          .map((f) => f.id)
      );
    }, [visibleFarms, normalizedQuery]);

    const latestStateRef = useRef({
      stage,
      visibleFarms,
      farms,
      centralHub,
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

    /**
     * Truy vấn độ cao địa hình (mét) tại (lng, lat) để nâng hai đầu đường cung deck.gl không chìm vào đồi núi
     */
    const getPointElevationMeters = useCallback(
      (lng: number, lat: number): number => {
        const map = mapRef.current;
        if (!map || !isMapLoadedRef.current) return 8;
        try {
          if (typeof map.queryTerrainElevation === 'function') {
            const elev = map.queryTerrainElevation([lng, lat]);
            if (typeof elev === 'number' && Number.isFinite(elev)) {
              return Math.max(0, elev) + 12;
            }
          }
        } catch {
          // ignore
        }
        return 8;
      },
      []
    );

    useImperativeHandle(ref, () => ({
      flyToFarm: (farm: Farm, zoom = 15.8) => {
        const map = mapRef.current;
        if (!map) return;
        isGlobeDraggingRef.current = true;
        const clampedZoom = Math.min(zoom, 16.5);
        const padding = computeCameraPadding(
          true,
          latestStateRef.current.mobileSheetSnap
        );
        map.flyTo({
          center: [Number(farm.lng), Number(farm.lat)],
          zoom: clampedZoom,
          pitch: 60,
          bearing: -22 + ((farm.lat * 100) % 44),
          padding,
          duration: 2800,
          essential: true,
        });
      },
      flyToOverview: (duration = 4800, pitch = 65) => {
        const map = mapRef.current;
        if (!map) return;
        isGlobeDraggingRef.current = true;
        const { center, zoom } = getSystemCenterAndZoom(
          visibleFarms.length > 0 ? visibleFarms : farms,
          centralHub
        );
        const clampedZoom = Math.min(zoom, 16.5);
        const isFromGlobeLowZoom =
          map.getZoom() < 5.5 && clampedZoom < 13.5 && pitch >= 65;
        const targetPitch = isFromGlobeLowZoom ? 65 : Math.min(pitch, 60);
        map.flyTo({
          center,
          zoom: clampedZoom,
          pitch: targetPitch,
          bearing: 22,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          duration,
          essential: true,
        });
      },
      flyToHub: () => {
        const map = mapRef.current;
        if (!map) return;
        isGlobeDraggingRef.current = true;
        const padding = computeCameraPadding(
          true,
          latestStateRef.current.mobileSheetSnap
        );
        map.flyTo({
          center: [Number(centralHub.lng), Number(centralHub.lat)],
          zoom: Math.min(13.8, 16.5),
          pitch: 60,
          bearing: 12,
          padding,
          duration: 2600,
          essential: true,
        });
      },
      flyToConnectedOverview: () => {
        const map = mapRef.current;
        if (!map) return;
        isGlobeDraggingRef.current = true;
        const connectableList = visibleFarms.filter((f) => f.isConnectable);
        const listForBounds =
          connectableList.length > 0 ? connectableList : visibleFarms;
        const { center, zoom } = getSystemCenterAndZoom(
          listForBounds,
          centralHub
        );
        const padding = computeCameraPadding(
          true,
          latestStateRef.current.mobileSheetSnap
        );
        const targetZoom = Math.min(Math.max(zoom - 0.35, 7.2), 14.2);
        const targetPitch = map.getZoom() < 5 ? 45 : 54;
        map.flyTo({
          center,
          zoom: targetZoom,
          pitch: targetPitch,
          bearing: 14,
          padding,
          duration: 2600,
          essential: true,
        });
      },
      flyToGlobe: () => {
        const map = mapRef.current;
        if (!map) return;
        isGlobeDraggingRef.current = true;
        if (resumeRotateTimerRef.current) {
          clearTimeout(resumeRotateTimerRef.current);
        }
        map.flyTo({
          center: [Number(centralHub.lng), Number(centralHub.lat)],
          zoom: 2.35,
          pitch: 15,
          bearing: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          duration: 3000,
          essential: true,
        });
        resumeRotateTimerRef.current = setTimeout(() => {
          isGlobeDraggingRef.current = false;
        }, 3200);
      },
      clearCameraPadding: () => {
        const map = mapRef.current;
        if (!map || !isMapLoadedRef.current) return;
        try {
          map.easeTo({
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            duration: 450,
          });
        } catch {
          // ignore
        }
      },
      getPositionDiagnostics: (): PositionDiagnosticItem[] => {
        const items: PositionDiagnosticItem[] = [];
        const hub = latestStateRef.current.centralHub;
        const hubRendered =
          renderedCoordsMapRef.current.get('__CENTRAL_HUB__') || {
            lat: hub.lat,
            lng: hub.lng,
          };
        const hubDevMeters =
          calculateDistanceKm(
            hub.lat,
            hub.lng,
            hubRendered.lat,
            hubRendered.lng
          ) * 1000;

        items.push({
          id: '__CENTRAL_HUB__',
          name: hub.name,
          isHub: true,
          category: 'hub',
          rawLat: hub.lat,
          rawLng: hub.lng,
          renderedLat: hubRendered.lat,
          renderedLng: hubRendered.lng,
          deviationMeters: hubDevMeters,
          isAccurate: hubDevMeters < 1,
        });

        for (const f of latestStateRef.current.farms) {
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
            isHub: false,
            category: f.category,
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

    const getFarmsFor3DBuildings = useCallback(
      (map: maplibregl.Map, allVisibleFarms: Farm[], isLite: boolean) => {
        if (!isLite) return allVisibleFarms;
        try {
          const bounds = map.getBounds();
          if (!bounds) return allVisibleFarms;
          return allVisibleFarms.filter((f) =>
            bounds.contains([f.lng, f.lat])
          );
        } catch {
          return allVisibleFarms;
        }
      },
      []
    );

    const applySkyAndLight = useCallback(
      (
        map: maplibregl.Map,
        skyCfg: {
          skyColor: string;
          horizonColor: string;
          fogColor: string;
          lightColor: string;
          lightIntensity: number;
          lightPosition: [number, number, number];
        }
      ) => {
        try {
          if (typeof map.setSky === 'function') {
            map.setSky({
              'sky-color': skyCfg.skyColor,
              'horizon-color': skyCfg.horizonColor,
              'fog-color': skyCfg.fogColor,
              'sky-horizon-blend': 0.55,
              'horizon-fog-blend': 0.5,
              'fog-ground-blend': 0.45,
              'atmosphere-blend': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0,
                0.92,
                8,
                0.45,
                12,
                0,
              ],
            });
          }
        } catch {
          // ignore
        }

        try {
          if (typeof map.setLight === 'function') {
            map.setLight({
              anchor: 'map',
              position: skyCfg.lightPosition,
              color: skyCfg.lightColor,
              intensity: skyCfg.lightIntensity,
            });
          }
        } catch {
          // ignore
        }
      },
      []
    );

    /**
     * Xây dựng MỘT GeoJSON source duy nhất "farms" chứa tất cả trang trại + nhà máy trung tâm:
     * - Toạ độ [exactLng, exactLat] giữ nguyên 100% độ chính xác số thực gốc (không làm tròn, không jitter)
     * - Thuộc tính `lat` dùng cho `symbol-sort-key: ['-', 90, ['get', 'lat']]` để điểm phía nam (vĩ độ thấp hơn)
     *   luôn vẽ đè lên điểm phía bắc (vĩ độ cao hơn) giống Google My Maps.
     */
    const buildFarmsSourceGeoJSON = useCallback(
      (allFarms: Farm[], hub: CentralHub) => {
        const hubLng = Number(hub.lng);
        const hubLat = Number(hub.lat);
        renderedCoordsMapRef.current.set('__CENTRAL_HUB__', {
          lat: hubLat,
          lng: hubLng,
        });

        const features = [
          {
            type: 'Feature' as const,
            properties: {
              id: '__CENTRAL_HUB__',
              name: hub.name,
              category: 'hub',
              isHub: true,
              isConnectable: true,
              iconImage: 'farm-icon-hub',
              color: '#2b8fd0',
              lat: hubLat,
              lng: hubLng,
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [hubLng, hubLat],
            },
          },
          ...allFarms.map((f) => {
            const exactLng = Number(f.lng);
            const exactLat = Number(f.lat);
            renderedCoordsMapRef.current.set(f.id, {
              lat: exactLat,
              lng: exactLng,
            });

            const iconKey = f.subType
              ? `farm-icon-${f.subType}`
              : `farm-icon-${f.category}`;
            const catColor = getCategoryConfig(f.category).hex;

            return {
              type: 'Feature' as const,
              properties: {
                id: f.id,
                name: f.name,
                category: f.category,
                isHub: false,
                isConnectable: Boolean(f.isConnectable),
                iconImage: iconKey,
                color: catColor,
                lat: exactLat,
                lng: exactLng,
              },
              geometry: {
                type: 'Point' as const,
                coordinates: [exactLng, exactLat],
              },
            };
          }),
        ];

        return {
          type: 'FeatureCollection' as const,
          features,
        };
      },
      []
    );

    /**
     * Cập nhật filter & opacity của các layer WebGL ("farm-icons", "farm-pulse", "farm-surface-dot", "farm-labels", "farm-selected", "hub-label")
     * mà KHÔNG cần gọi source.setData khi chỉ đổi bộ lọc chip, tìm kiếm hoặc chọn điểm.
     */
    const applyLayerFiltersAndStyles = useCallback(
      (
        map: maplibregl.Map,
        cats: Record<FarmCategory, boolean>,
        curSelectedId: string | null,
        curHubSelected: boolean,
        curHoveredId: string | null,
        curTourRunning: boolean,
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
          ['!=', ['get', 'id'], '__CENTRAL_HUB__'],
          ['in', ['get', 'category'], ['literal', allowedCategories]],
        ];

        const activeSelectedId = curSelectedId
          ? curSelectedId
          : curHubSelected
          ? '__CENTRAL_HUB__'
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
          if (map.getLayer('farm-surface-dot')) {
            map.setFilter('farm-surface-dot', categoryFilter);
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

          // Biểu thức độ mờ (opacity):
          // - Khi chọn Nhà máy Trung tâm: các điểm không nối (văn phòng, kho, rửa xe) mờ nhẹ xuống 0.45
          // - Khi đang tìm kiếm: các điểm không khớp mờ xuống 0.35
          // - Khi chạy Tour tự động: các điểm không phải điểm hiện tại mờ xuống 0.48
          const hasSearch = curQuery.length > 0;
          const matchedArray = Array.from(curMatchedIds);

          let featureAlphaExpr: maplibregl.ExpressionSpecification | number = 1;
          if (curHubSelected) {
            featureAlphaExpr = [
              'case',
              ['==', ['get', 'id'], '__CENTRAL_HUB__'],
              1,
              ['boolean', ['get', 'isConnectable'], false],
              1,
              0.45,
            ];
          } else if (hasSearch) {
            featureAlphaExpr = [
              'case',
              ['==', ['get', 'id'], '__CENTRAL_HUB__'],
              0.7,
              ['in', ['get', 'id'], ['literal', matchedArray]],
              1,
              0.35,
            ];
          } else if (curTourRunning && curSelectedId) {
            featureAlphaExpr = [
              'case',
              ['==', ['get', 'id'], curSelectedId],
              1,
              0.48,
            ];
          }

          if (map.getLayer('farm-icons')) {
            map.setPaintProperty('farm-icons', 'icon-opacity', [
              'interpolate',
              ['linear'],
              ['zoom'],
              1.65,
              0,
              2.25,
              featureAlphaExpr,
              18,
              featureAlphaExpr,
            ]);
          }

          if (map.getLayer('farm-surface-dot')) {
            map.setPaintProperty(
              'farm-surface-dot',
              'circle-opacity',
              featureAlphaExpr
            );
            map.setPaintProperty(
              'farm-surface-dot',
              'circle-stroke-opacity',
              featureAlphaExpr
            );
          }

          // Nhãn "NHÀ MÁY TRUNG TÂM THÁI VIỆT": chỉ hiện khi rê chuột vào nhà máy, khi đang chọn nhà máy hoặc khi camera ở gần (zoom >= 9.5)
          if (map.getLayer('hub-label')) {
            const forceShowHubLabel =
              curHubSelected || curHoveredId === '__CENTRAL_HUB__';
            map.setPaintProperty(
              'hub-label',
              'text-opacity',
              forceShowHubLabel
                ? 1
                : [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    9.0,
                    0,
                    9.8,
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
          selectedFarm: curSelected,
          isHubSelected: curHubSelected,
          activeCategories: curCats,
          biosecurityRadius: curRadius,
          timeOfDay: curTime,
          liteMode: curLite,
        } = latestStateRef.current;

        // 1. Lớp background dự phòng màu xanh lá nhạt #d9ecd0 ở dưới cùng
        try {
          const styleLayers = map.getStyle()?.layers || [];
          const firstLayerId = styleLayers[0]?.id;
          if (!map.getLayer('fallback-ground-background')) {
            map.addLayer(
              {
                id: 'fallback-ground-background',
                type: 'background',
                paint: {
                  'background-color': FALLBACK_GROUND_COLOR,
                },
              },
              firstLayerId
            );
          } else {
            map.setPaintProperty(
              'fallback-ground-background',
              'background-color',
              FALLBACK_GROUND_COLOR
            );
          }
        } catch {
          // ignore
        }

        try {
          map.setProjection({ type: 'globe' });
        } catch {
          // Fallback
        }

        // 2. Địa hình 3D Terrarium DEM
        try {
          if (!map.getSource('terrarium-dem')) {
            map.addSource('terrarium-dem', {
              type: 'raster-dem',
              tiles: [TERRARIUM_DEM_TILES],
              encoding: 'terrarium',
              tileSize: 256,
              maxzoom: 15,
            });
          }

          const targetExag = getTerrainExaggeration(map.getZoom(), curLite);
          currentTerrainExaggerationRef.current = targetExag;
          map.setTerrain({
            source: 'terrarium-dem',
            exaggeration: targetExag,
          });

          if (!map.getLayer('terrain-hillshade')) {
            map.addLayer({
              id: 'terrain-hillshade',
              type: 'hillshade',
              source: 'terrarium-dem',
              paint: {
                'hillshade-exaggeration': curLite ? 0.12 : 0.26,
                'hillshade-shadow-color': '#0f2a24',
                'hillshade-highlight-color': '#fef9c3',
              },
            });
          }
        } catch {
          // ignore
        }

        const preset = APP_CONFIG.timePresets[curTime];
        applySkyAndLight(map, preset);

        // 3. Vòng bán kính an toàn sinh học
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
              'line-width': 4,
              'line-blur': 2.5,
              'line-opacity': 0.55,
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
              'line-width': 2.2,
              'line-opacity': 0.95,
            },
          });
        }

        if (!map.getLayer('biosecurity-ripple-line')) {
          map.addLayer({
            id: 'biosecurity-ripple-line',
            type: 'line',
            source: 'biosecurity-zones',
            filter: ['==', ['get', 'ringType'], 'ripple'],
            paint: {
              'line-color': '#10b981',
              'line-width': 1.8,
              'line-dasharray': [3, 2],
              'line-opacity': 0.55,
            },
          });
        }

        // 4. Cụm công trình chuồng trại 3D (dùng chung đúng toạ độ gốc)
        const farmsToBuild = getFarmsFor3DBuildings(
          map,
          curVisibleFarms,
          curLite
        );
        const buildingsGeoJSON = buildAllFarms3DGeoJSON(
          farmsToBuild,
          curTime === 'night'
        );

        if (!map.getSource('farms-3d-buildings')) {
          map.addSource('farms-3d-buildings', {
            type: 'geojson',
            data: buildingsGeoJSON,
          });
        }

        if (!map.getLayer('farms-3d-extrusion')) {
          const scale = buildingGrowScaleRef.current;
          map.addLayer({
            id: 'farms-3d-extrusion',
            type: 'fill-extrusion',
            source: 'farms-3d-buildings',
            minzoom: 13,
            paint: {
              'fill-extrusion-color': ['get', 'color'],
              'fill-extrusion-base': ['*', ['get', 'baseHeight'], scale],
              'fill-extrusion-height': ['*', ['get', 'targetHeight'], scale],
              'fill-extrusion-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13,
                0,
                13.8,
                0.85,
                15,
                0.96,
              ],
              'fill-extrusion-vertical-gradient': true,
            },
          });
        }

        // 5. Đăng ký toàn bộ ảnh icon 3D (canvas 64x64, pixelRatio: 2)
        void registerMapLibreFarmIcons(map);

        // 6. MỘT GeoJSON source duy nhất "farms" cho toàn bộ trang trại & nhà máy trung tâm
        const farmsGeoJSON = buildFarmsSourceGeoJSON(allFarms, curHub);
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

        // 6a. Layer vòng sóng "farm-pulse": Type circle, circle-pitch-alignment: "map" (nằm sát mặt đất)
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
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                1.5,
                6,
                6,
                9,
                12,
                13,
                16,
                16,
              ],
              'circle-color': ['get', 'color'],
              'circle-opacity': 0.24,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': ['get', 'color'],
              'circle-stroke-opacity': 0.55,
            },
          });
        }

        // 6b. Layer chấm tâm bề mặt "farm-surface-dot": nằm sát mặt đất tại đúng toạ độ (lat, lng)
        if (!map.getLayer('farm-surface-dot')) {
          map.addLayer({
            id: 'farm-surface-dot',
            type: 'circle',
            source: 'farms',
            paint: {
              'circle-pitch-alignment': 'map',
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                1.5,
                4.5,
                3.5,
                5.2,
                6,
                3.2,
                15,
                3.8,
              ],
              'circle-color': ['get', 'color'],
              'circle-stroke-width': 1.6,
              'circle-stroke-color': '#ffffff',
            },
          });
        }

        // 6c. Layer vòng sáng tại đúng toạ độ điểm đang chọn "farm-selected-ring"
        if (!map.getLayer('farm-selected-ring')) {
          map.addLayer({
            id: 'farm-selected-ring',
            type: 'circle',
            source: 'farms',
            filter: ['==', ['get', 'id'], '__NONE__'],
            paint: {
              'circle-pitch-alignment': 'map',
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                2,
                12,
                6,
                16,
                12,
                21,
                16,
                25,
              ],
              'circle-color': '#facc15',
              'circle-opacity': 0.28,
              'circle-stroke-width': 2.5,
              'circle-stroke-color': '#facc15',
              'circle-stroke-opacity': 0.95,
            },
          });
        }

        const deviceFactor = getDeviceSizeFactor();

        // 6d. Layer chữ "farm-labels": Tên trại chỉ hiện từ zoom 13+, text-anchor: "top", text-offset dưới ghim, viền halo trắng, text-optional: true
        if (!map.getLayer('farm-labels')) {
          map.addLayer({
            id: 'farm-labels',
            type: 'symbol',
            source: 'farms',
            minzoom: 13,
            filter: ['!=', ['get', 'id'], '__CENTRAL_HUB__'],
            layout: {
              'text-field': ['get', 'name'],
              'text-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13,
                11,
                16,
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

        // 6e. Layer nhãn Nhà máy Trung tâm "hub-label": đặt phía trên-bên cạnh icon, chỉ hiện khi rê chuột, khi chọn nhà máy hoặc khi camera ở gần
        if (!map.getLayer('hub-label')) {
          map.addLayer({
            id: 'hub-label',
            type: 'symbol',
            source: 'farms',
            filter: ['==', ['get', 'id'], '__CENTRAL_HUB__'],
            layout: {
              'text-field': ['get', 'name'],
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
              'text-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                9.0,
                0,
                9.8,
                1,
              ],
            },
          });
        }

        // 6f. Layer symbol "farm-icons":
        // - icon-anchor: "bottom" (mũi ghim trùng đúng toạ độ)
        // - icon-allow-overlap: true, icon-ignore-placement: true
        // - icon-pitch-alignment: "viewport", icon-rotation-alignment: "viewport"
        // - icon-size nội suy mượt theo zoom (~0.5 ở zoom 6, ~0.7 ở zoom 12, ~0.85 từ zoom 15+)
        // - Thứ tự chồng lấp: Điểm phía nam (vĩ độ thấp hơn) vẽ đè lên điểm phía bắc: symbol-sort-key = 90 - lat
        if (!map.getLayer('farm-icons')) {
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
                0.38 * deviceFactor,
                6,
                0.5 * deviceFactor,
                12,
                0.7 * deviceFactor,
                15,
                0.85 * deviceFactor,
                18,
                0.88 * deviceFactor,
              ],
              'icon-anchor': 'bottom',
              'icon-offset': [0, 0],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-pitch-alignment': 'viewport',
              'icon-rotation-alignment': 'viewport',
              'symbol-sort-key': ['-', 90, ['get', 'lat']],
            },
            paint: {
              'icon-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                1.65,
                0,
                2.25,
                1,
                18,
                1,
              ],
            },
          });
        }

        // 6g. Layer điểm chọn "farm-selected": Icon lớn hơn ~1.25 lần tại đúng toạ độ điểm đang chọn, không làm dịch chuyển các điểm khác
        if (!map.getLayer('farm-selected')) {
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
                0.38 * 1.25 * deviceFactor,
                6,
                0.5 * 1.25 * deviceFactor,
                12,
                0.7 * 1.25 * deviceFactor,
                15,
                0.85 * 1.25 * deviceFactor,
                18,
                0.88 * 1.25 * deviceFactor,
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
          null,
          false,
          '',
          new Set(),
          curLite
        );
      },
      [
        applyLayerFiltersAndStyles,
        applySkyAndLight,
        buildFarmsSourceGeoJSON,
        getFarmsFor3DBuildings,
      ]
    );

    // Khởi tạo MapLibre GL + Deck.gl MapboxOverlay + ResizeObserver
    useEffect(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      const initialStyle =
        mapStyleMode === 'satellite'
          ? createSatelliteBaseStyle(esriMaxZoomRef.current)
          : OPENFREEMAP_LIBERTY_STYLE;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: initialStyle,
        center: [centralHub.lng - 8, centralHub.lat + 1.2],
        zoom: 2.35,
        minZoom: 1.35,
        maxZoom: 18,
        pitch: 15,
        bearing: 0,
        maxPitch: 75,
        pixelRatio: getOptimalPixelRatio(liteMode),
        attributionControl: false,
      });

      map.setMaxZoom(18);
      map.setMinZoom(1.35);

      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        'bottom-left'
      );

      const deckOverlay = new MapboxOverlay({
        interleaved: false,
        layers: [],
      });
      map.addControl(deckOverlay as unknown as maplibregl.IControl);
      deckOverlayRef.current = deckOverlay;

      // Tự động tạo ảnh icon nếu MapLibre báo thiếu sau khi đổi nền bản đồ (styleimagemissing)
      map.on('styleimagemissing', (e) => {
        if (e?.id && e.id.startsWith('farm-icon-')) {
          void addSingleFarmIconToMap(map, e.id);
        }
      });

      const pauseGlobeSpin = () => {
        isGlobeDraggingRef.current = true;
        if (resumeRotateTimerRef.current) {
          clearTimeout(resumeRotateTimerRef.current);
        }
      };

      const scheduleResumeGlobeSpin = () => {
        if (resumeRotateTimerRef.current) {
          clearTimeout(resumeRotateTimerRef.current);
        }
        resumeRotateTimerRef.current = setTimeout(() => {
          isGlobeDraggingRef.current = false;
        }, 3000);
      };

      map.on('mousedown', pauseGlobeSpin);
      map.on('touchstart', pauseGlobeSpin);
      map.on('mouseup', scheduleResumeGlobeSpin);
      map.on('touchend', scheduleResumeGlobeSpin);
      map.on('dragend', scheduleResumeGlobeSpin);
      map.on('wheel', () => {
        pauseGlobeSpin();
        scheduleResumeGlobeSpin();
      });

      map.on(
        'error',
        (errEvent: maplibregl.ErrorEvent & { sourceId?: string }) => {
          if (currentStyleModeRef.current !== 'satellite') return;

          const sourceId = errEvent?.sourceId || '';
          const errMsg = String(errEvent?.error?.message || '').toLowerCase();
          const isSatelliteTileError =
            sourceId === 'esri-world-imagery' ||
            errMsg.includes('arcgisonline') ||
            errMsg.includes('world_imagery') ||
            errMsg.includes('tile');

          if (!isSatelliteTileError) return;

          const now = Date.now();
          const recent = tileErrorTimestampsRef.current.filter(
            (ts) => now - ts <= 10_000
          );
          recent.push(now);
          tileErrorTimestampsRef.current = recent;

          if (recent.length >= 2 && esriMaxZoomRef.current === 16) {
            esriMaxZoomRef.current = 15;
            try {
              const src = map.getSource('esri-world-imagery') as
                | (maplibregl.RasterTileSource & { maxzoom?: number })
                | undefined;
              if (src) {
                src.maxzoom = 15;
              }
            } catch {
              // ignore
            }
          }

          if (recent.length >= 5) {
            tileErrorTimestampsRef.current = [];
            latestStateRef.current.onSatelliteFallbackToStreet?.();
          }
        }
      );

      /**
       * Tìm điểm trang trại hoặc nhà máy bằng map.queryRenderedFeatures với vùng đệm tối thiểu 44x44px quanh điểm chạm,
       * ưu tiên điểm có khoảng cách màn hình gần tâm chạm nhất.
       */
      const queryInteractiveFeatureAtPoint = (point: maplibregl.Point) => {
        const activeLayers = [
          'farm-selected',
          'farm-icons',
          'farm-surface-dot',
          'farms-3d-extrusion',
        ].filter((id) => Boolean(map.getLayer(id)));

        if (activeLayers.length === 0) return null;

        // Vùng đệm 44x44px quanh điểm chạm (bán kính 22px)
        const touchBox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [point.x - 22, point.y - 22],
          [point.x + 22, point.y + 22],
        ];
        const feats = map.queryRenderedFeatures(touchBox, {
          layers: activeLayers,
        });

        if (feats.length === 0) return null;
        if (feats.length === 1) return feats[0];

        // Ưu tiên điểm có toạ độ chiếu trên màn hình gần vị trí chạm nhất
        let bestFeat = feats[0];
        let bestDistSq = Number.POSITIVE_INFINITY;

        for (const f of feats) {
          const props = f.properties || {};
          const lng = Number(props.lng);
          const lat = Number(props.lat);
          if (Number.isFinite(lng) && Number.isFinite(lat)) {
            const screenPt = map.project([lng, lat]);
            const dx = screenPt.x - point.x;
            const dy = screenPt.y - 22 - point.y; // Tâm thân ghim nằm cao hơn mũi ghim ~22px
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
        if (props.isHub || props.id === '__CENTRAL_HUB__') {
          latestStateRef.current.onSelectHub();
          return;
        }

        const farmId = props.id || props.farmId;
        if (farmId) {
          const matched = latestStateRef.current.visibleFarms.find(
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
        if (props.isHub || props.id === '__CENTRAL_HUB__') {
          setHoveredId('__CENTRAL_HUB__');
          setHoveredTooltip(null);
          return;
        }

        const farmId = String(props.id || props.farmId || '');
        const matched = latestStateRef.current.visibleFarms.find(
          (f) => f.id === farmId
        );
        if (matched) {
          setHoveredId(matched.id);
          // Nếu đang ở mức zoom < 13 (chưa hiện layer chữ farm-labels), hiển thị tooltip nhỏ trên đầu ghim khi hover
          if (map.getZoom() < 13) {
            const projected = map.project([matched.lng, matched.lat]);
            setHoveredTooltip({
              name: matched.name,
              x: projected.x,
              y: projected.y,
            });
          } else {
            setHoveredTooltip(null);
          }
        }
      });

      map.on('zoom', () => {
        const z = map.getZoom();
        setCurrentZoom(z);

        if (map.getSource('terrarium-dem')) {
          const desiredExag = getTerrainExaggeration(
            z,
            latestStateRef.current.liteMode
          );
          if (
            Math.abs(desiredExag - currentTerrainExaggerationRef.current) > 0.01
          ) {
            currentTerrainExaggerationRef.current = desiredExag;
            try {
              map.setTerrain({
                source: 'terrarium-dem',
                exaggeration: desiredExag,
              });
            } catch {
              // ignore
            }
          }
        }

        if (z >= 14.8 && !buildingAnimTriggeredRef.current) {
          buildingAnimTriggeredRef.current = true;
          const start = performance.now();
          const duration = 950;

          const animateGrow = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            buildingGrowScaleRef.current = eased;

            if (map.getLayer('farms-3d-extrusion')) {
              map.setPaintProperty(
                'farms-3d-extrusion',
                'fill-extrusion-base',
                ['*', ['get', 'baseHeight'], eased]
              );
              map.setPaintProperty(
                'farms-3d-extrusion',
                'fill-extrusion-height',
                ['*', ['get', 'targetHeight'], eased]
              );
            }

            if (t < 1) {
              requestAnimationFrame(animateGrow);
            }
          };
          requestAnimationFrame(animateGrow);
        } else if (z < 13.5) {
          buildingAnimTriggeredRef.current = false;
        }
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
      window.visualViewport?.addEventListener('resize', handleViewportResize);

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', handleViewportResize);
        window.removeEventListener('orientationchange', handleViewportResize);
        window.visualViewport?.removeEventListener(
          'resize',
          handleViewportResize
        );
        if (resumeRotateTimerRef.current) {
          clearTimeout(resumeRotateTimerRef.current);
        }
        map.remove();
        mapRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Xoay tự động Quả Địa Cầu 3D liên tục, tạm dừng khi người dùng kéo hoặc khi đang mở Card chi tiết
    useEffect(() => {
      if (stage !== 'globe') return;
      isGlobeDraggingRef.current = false;

      let animId: number;
      const rotateGlobe = () => {
        const map = mapRef.current;
        if (
          map &&
          isMapLoadedRef.current &&
          stage === 'globe' &&
          !isGlobeDraggingRef.current &&
          !latestStateRef.current.selectedFarm &&
          !latestStateRef.current.isHubSelected
        ) {
          const center = map.getCenter();
          map.setCenter([center.lng + 0.075, center.lat]);
        }
        animId = requestAnimationFrame(rotateGlobe);
      };

      animId = requestAnimationFrame(rotateGlobe);
      return () => cancelAnimationFrame(animId);
    }, [stage]);

    // Chuyển đổi nền Vệ tinh ↔ Đường phố: tự động nạp lại source, layer và ảnh icon sau sự kiện style.load, giữ nguyên vị trí camera
    const currentStyleModeRef = useRef<MapStyleMode>(mapStyleMode);
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;
      if (currentStyleModeRef.current === mapStyleMode) return;

      currentStyleModeRef.current = mapStyleMode;
      tileErrorTimestampsRef.current = [];

      const savedCenter = map.getCenter();
      const savedZoom = map.getZoom();
      const savedPitch = map.getPitch();
      const savedBearing = map.getBearing();

      const nextStyle =
        mapStyleMode === 'satellite'
          ? createSatelliteBaseStyle(esriMaxZoomRef.current)
          : OPENFREEMAP_LIBERTY_STYLE;

      map.setStyle(nextStyle);

      map.once('style.load', () => {
        map.jumpTo({
          center: savedCenter,
          zoom: savedZoom,
          pitch: savedPitch,
          bearing: savedBearing,
        });
        setupCustomLayers(map);
      });
    }, [mapStyleMode, setupCustomLayers]);

    // Nội suy mượt 2 giây khi đổi giữa 4 mốc giờ
    const prevTimeRef = useRef<TimeOfDay>(timeOfDay);
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;

      const fromPreset = APP_CONFIG.timePresets[prevTimeRef.current];
      const toPreset = APP_CONFIG.timePresets[timeOfDay];
      prevTimeRef.current = timeOfDay;

      const buildingSource = map.getSource(
        'farms-3d-buildings'
      ) as maplibregl.GeoJSONSource | undefined;
      if (buildingSource) {
        const farmsToBuild = getFarmsFor3DBuildings(
          map,
          visibleFarms,
          liteMode
        );
        buildingSource.setData(
          buildAllFarms3DGeoJSON(farmsToBuild, timeOfDay === 'night')
        );
      }

      if (fromPreset === toPreset) {
        applySkyAndLight(map, toPreset);
        return;
      }

      let animId: number;
      const startTime = performance.now();
      const duration = 2000;

      const step = (now: number) => {
        const t = Math.min(1, (now - startTime) / duration);
        const s = t * t * (3 - 2 * t);

        const interpolated = {
          skyColor: lerpHexColor(fromPreset.skyColor, toPreset.skyColor, s),
          horizonColor: lerpHexColor(
            fromPreset.horizonColor,
            toPreset.horizonColor,
            s
          ),
          fogColor: lerpHexColor(fromPreset.fogColor, toPreset.fogColor, s),
          lightColor: lerpHexColor(
            fromPreset.lightColor,
            toPreset.lightColor,
            s
          ),
          lightIntensity:
            fromPreset.lightIntensity +
            (toPreset.lightIntensity - fromPreset.lightIntensity) * s,
          lightPosition: [
            fromPreset.lightPosition[0] +
              (toPreset.lightPosition[0] - fromPreset.lightPosition[0]) * s,
            fromPreset.lightPosition[1] +
              (toPreset.lightPosition[1] - fromPreset.lightPosition[1]) * s,
            fromPreset.lightPosition[2] +
              (toPreset.lightPosition[2] - fromPreset.lightPosition[2]) * s,
          ] as [number, number, number],
        };

        applySkyAndLight(map, interpolated);

        if (t < 1) {
          animId = requestAnimationFrame(step);
        }
      };

      animId = requestAnimationFrame(step);
      return () => cancelAnimationFrame(animId);
    }, [
      timeOfDay,
      visibleFarms,
      liteMode,
      applySkyAndLight,
      getFarmsFor3DBuildings,
    ]);

    // Cập nhật độ phân giải pixelRatio và mức phóng đại địa hình 3D khi bật/tắt Chế độ nhẹ
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;
      try {
        if (typeof map.setPixelRatio === 'function') {
          map.setPixelRatio(getOptimalPixelRatio(liteMode));
        }
        if (map.getSource('terrarium-dem')) {
          const targetExag = getTerrainExaggeration(map.getZoom(), liteMode);
          currentTerrainExaggerationRef.current = targetExag;
          map.setTerrain({
            source: 'terrarium-dem',
            exaggeration: targetExag,
          });
        }
      } catch {
        // ignore
      }
    }, [liteMode]);

    // CHỈ gọi source.setData trên source "farms" khi dữ liệu farms hoặc centralHub thực sự thay đổi
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;

      const farmsSource = map.getSource('farms') as
        | maplibregl.GeoJSONSource
        | undefined;
      if (farmsSource) {
        farmsSource.setData(buildFarmsSourceGeoJSON(farms, centralHub));
      }
    }, [farms, centralHub, buildFarmsSourceGeoJSON]);

    // Cập nhật chuồng 3D & vùng bán kính an toàn khi danh sách hiển thị hoặc bán kính thay đổi
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

      const buildingSource = map.getSource(
        'farms-3d-buildings'
      ) as maplibregl.GeoJSONSource | undefined;
      if (buildingSource) {
        const farmsToBuild = getFarmsFor3DBuildings(
          map,
          visibleFarms,
          liteMode
        );
        buildingSource.setData(
          buildAllFarms3DGeoJSON(farmsToBuild, timeOfDay === 'night')
        );
      }
    }, [
      visibleFarms,
      biosecurityRadius,
      liteMode,
      timeOfDay,
      getFarmsFor3DBuildings,
    ]);

    // Lọc theo chip / tìm kiếm / điểm đang chọn chỉ dùng setFilter và setPaintProperty của layer (không gọi setData)
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;

      applyLayerFiltersAndStyles(
        map,
        activeCategories,
        selectedFarm?.id || null,
        isHubSelected,
        hoveredId,
        isTourRunning,
        normalizedQuery,
        matchedFarmIds,
        liteMode
      );
    }, [
      activeCategories,
      selectedFarm,
      isHubSelected,
      hoveredId,
      isTourRunning,
      normalizedQuery,
      matchedFarmIds,
      liteMode,
      applyLayerFiltersAndStyles,
    ]);

    // Layer vòng sóng "farm-pulse": animate bán kính và độ mờ qua setPaintProperty giới hạn ~20fps (50ms); tắt hẳn trong Chế độ nhẹ
    useEffect(() => {
      if (liteMode) return;

      let ripplePhase = 0;
      const interval = setInterval(() => {
        const map = mapRef.current;
        if (!map || !isMapLoadedRef.current) return;

        ripplePhase = (ripplePhase + 0.025) % 1;
        const pulseWave = (Math.sin(ripplePhase * Math.PI * 2) + 1) / 2;

        if (map.getLayer('farm-pulse')) {
          map.setPaintProperty('farm-pulse', 'circle-radius', [
            'interpolate',
            ['linear'],
            ['zoom'],
            1.5,
            5 + pulseWave * 3.5,
            6,
            7 + pulseWave * 5,
            12,
            10 + pulseWave * 6,
            16,
            13 + pulseWave * 7,
          ]);
          map.setPaintProperty(
            'farm-pulse',
            'circle-opacity',
            0.12 + (1 - pulseWave) * 0.24
          );
        }

        if (stage === 'map' && Math.round(ripplePhase * 40) % 2 === 0) {
          const bioSource = map.getSource(
            'biosecurity-zones'
          ) as maplibregl.GeoJSONSource | undefined;
          if (bioSource) {
            bioSource.setData(
              buildBiosecurityGeoJSON(
                visibleFarms,
                biosecurityRadius,
                ripplePhase
              )
            );
          }

          if (map.getLayer('biosecurity-ripple-line')) {
            const opacity = Math.max(0.08, (1 - ripplePhase) * 0.75);
            map.setPaintProperty(
              'biosecurity-ripple-line',
              'line-opacity',
              opacity
            );
          }
        }
      }, 50); // ~20fps

      return () => clearInterval(interval);
    }, [visibleFarms, biosecurityRadius, liteMode, stage]);

    /**
     * PHẦN B: ĐƯỜNG CUNG VỆT SÁNG TỪ NHÀ MÁY TRUNG TÂM CHỈ NỐI TRẠI GÀ VÀ TRẠI HEO
     * - Mặc định ẩn toàn bộ đường cung.
     * - Chỉ khởi tạo ArcLayer khi đang chọn Nhà máy Trung tâm (isHubSelected) hoặc bật đường đơn lẻ (singleArcFarmId),
     *   và huỷ hoàn toàn ArcLayer khi tắt.
     * - Cộng độ cao địa hình ở hai đầu bằng map.queryTerrainElevation để không chìm vào đồi núi.
     */
    const activeTargetFarms = useMemo(() => {
      if (isHubSelected) {
        return visibleFarms.filter(
          (f) =>
            f.isConnectable &&
            (f.category === 'chicken' || f.category === 'pig')
        );
      }
      if (singleArcFarmId) {
        return visibleFarms.filter(
          (f) =>
            f.id === singleArcFarmId &&
            f.isConnectable &&
            (f.category === 'chicken' || f.category === 'pig')
        );
      }
      return [];
    }, [isHubSelected, singleArcFarmId, visibleFarms]);

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

      const animateArcs = (now: number) => {
        const overlay = deckOverlayRef.current;
        const mode = arcModeRef.current;

        if (!overlay) {
          animId = requestAnimationFrame(animateArcs);
          return;
        }

        if (mode === 'idle') {
          overlay.setProps({ layers: [] });
          return;
        }

        const farmsForArcs =
          activeTargetFarms.length > 0
            ? activeTargetFarms
            : prevActiveTargetsRef.current;

        if (farmsForArcs.length === 0) {
          arcModeRef.current = 'idle';
          overlay.setProps({ layers: [] });
          return;
        }

        const elapsedMs = now - arcTransitionStartRef.current;
        let globalFade = 1;

        if (mode === 'growing' && elapsedMs >= 1250) {
          arcModeRef.current = 'active';
        } else if (mode === 'shrinking') {
          if (elapsedMs >= 600) {
            arcModeRef.current = 'idle';
            prevActiveTargetsRef.current = [];
            overlay.setProps({ layers: [] });
            return;
          }
          globalFade = Math.max(0, 1 - elapsedMs / 600);
        }

        phase += liteMode ? 0.015 : 0.024;
        const total = Math.max(1, farmsForArcs.length);
        const hubElev = getPointElevationMeters(
          Number(centralHub.lng),
          Number(centralHub.lat)
        );

        const arcData = farmsForArcs.map((farm, idx) => {
          let reachProgress = 1;
          if (arcModeRef.current === 'growing') {
            const staggerDelay = total > 1 ? (idx / (total - 1)) * 480 : 0;
            const localElapsed = Math.max(0, elapsedMs - staggerDelay);
            const rawT = Math.min(1, localElapsed / 720);
            reachProgress = 1 - Math.pow(1 - rawT, 3);
          } else if (arcModeRef.current === 'shrinking') {
            const shrinkT = Math.min(1, elapsedMs / 600);
            reachProgress = Math.max(0, 1 - shrinkT);
          }

          const farmElev = getPointElevationMeters(
            Number(farm.lng),
            Number(farm.lat)
          );

          const currentTargetLng =
            centralHub.lng + (farm.lng - centralHub.lng) * reachProgress;
          const currentTargetLat =
            centralHub.lat + (farm.lat - centralHub.lat) * reachProgress;
          const currentTargetElev =
            hubElev + (farmElev - hubElev) * reachProgress;

          const particleT = ((phase * 0.55 + idx * 0.21) % 1) * reachProgress;
          const particleLng =
            centralHub.lng + (farm.lng - centralHub.lng) * particleT;
          const particleLat =
            centralHub.lat + (farm.lat - centralHub.lat) * particleT;
          const particleElev = hubElev + (farmElev - hubElev) * particleT;

          const pulse = (Math.sin(phase * 2.5 - idx * 0.7) + 1) / 2;

          // Trại gà = Cam #fb923c [251, 146, 60]; Trại heo = Hồng san hô #fb7185 [251, 113, 133]
          const targetRgb: [number, number, number] =
            farm.category === 'pig' ? [251, 113, 133] : [251, 146, 60];

          return {
            id: farm.id,
            source: [
              Number(centralHub.lng),
              Number(centralHub.lat),
              hubElev,
            ] as [number, number, number],
            target: [currentTargetLng, currentTargetLat, currentTargetElev] as [
              number,
              number,
              number,
            ],
            exactFarmPos: [Number(farm.lng), Number(farm.lat), farmElev] as [
              number,
              number,
              number,
            ],
            particlePos: [particleLng, particleLat, particleElev] as [
              number,
              number,
              number,
            ],
            targetRgb,
            pulse,
            reachProgress,
            alphaScale: globalFade * (reachProgress > 0.02 ? 1 : 0),
          };
        });

        const mainArcLayer = new ArcLayer({
          id: 'thaiviet-connectable-arcs',
          data: arcData,
          getSourcePosition: (d) => d.source,
          getTargetPosition: (d) => d.target,
          getSourceColor: (d): [number, number, number, number] => [
            250,
            204,
            21,
            Math.round(235 * d.alphaScale),
          ],
          getTargetColor: (d): [number, number, number, number] => [
            d.targetRgb[0],
            d.targetRgb[1],
            d.targetRgb[2],
            Math.round(245 * d.alphaScale),
          ],
          getWidth: (d) => 3.2 + d.pulse * 1.1,
          getHeight: 0.42,
          greatCircle: true,
          updateTriggers: {
            getTargetPosition: [elapsedMs, mode],
            getSourceColor: [globalFade, elapsedMs],
            getTargetColor: [globalFade, elapsedMs],
            getWidth: [phase],
          },
        });

        const endpointGlowLayer = new ScatterplotLayer({
          id: 'thaiviet-arc-endpoints',
          data: arcData.filter((d) => d.reachProgress > 0.85),
          getPosition: (d) => d.exactFarmPos,
          getFillColor: (d): [number, number, number, number] => [
            d.targetRgb[0],
            d.targetRgb[1],
            d.targetRgb[2],
            Math.round((150 + d.pulse * 105) * d.alphaScale),
          ],
          getLineColor: [255, 255, 255, Math.round(240 * globalFade)],
          getRadius: 450,
          radiusMinPixels: 4.5,
          radiusMaxPixels: 9,
          stroked: true,
          lineWidthMinPixels: 1.5,
          updateTriggers: {
            getFillColor: [phase, globalFade],
          },
        });

        const layersList: Array<ArcLayer | ScatterplotLayer> = [
          mainArcLayer,
          endpointGlowLayer,
        ];

        // Chế độ nhẹ: bỏ hạt chạy, chỉ vẽ nét đơn giản
        if (!liteMode) {
          const particleLayer = new ScatterplotLayer({
            id: 'thaiviet-arc-particles',
            data: arcData.filter((d) => d.reachProgress > 0.25),
            getPosition: (d) => d.particlePos,
            getFillColor: [250, 204, 21, Math.round(245 * globalFade)],
            getLineColor: [255, 255, 255, Math.round(255 * globalFade)],
            getRadius: 480,
            radiusMinPixels: 3,
            radiusMaxPixels: 6,
            stroked: true,
            lineWidthMinPixels: 1.5,
            updateTriggers: {
              getPosition: [phase, elapsedMs],
              getFillColor: [globalFade],
            },
          });
          layersList.push(particleLayer);
        }

        overlay.setProps({
          layers: layersList,
        });

        animId = requestAnimationFrame(animateArcs);
      };

      animId = requestAnimationFrame(animateArcs);
      return () => cancelAnimationFrame(animId);
    }, [activeTargetFarms, centralHub, liteMode, getPointElevationMeters]);

    const currentPreset = APP_CONFIG.timePresets[timeOfDay];

    return (
      <div className="app-viewport relative bg-[#041829]">
        {/* Nền vũ trụ xanh đậm có sao mờ và quầng khí quyển xanh ngọc */}
        <SpaceOceanBackdrop visible={stage === 'globe'} liteMode={liteMode} />

        {/* Khung chứa MapLibre GL */}
        <div ref={mapContainerRef} className="relative z-10 h-full w-full" />

        {/* Tooltip tên trang trại khi rê chuột vào icon ở mức zoom xa (< 13) */}
        {hoveredTooltip && (
          <div
            className="pointer-events-none fixed z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/95 bg-white/95 px-3 py-1 text-[11px] font-extrabold text-[#0f2a24] shadow-md backdrop-blur-md"
            style={{
              left: `${hoveredTooltip.x}px`,
              top: `${Math.max(hoveredTooltip.y - 50, 12)}px`,
            }}
          >
            {hoveredTooltip.name}
          </div>
        )}

        {/* Lớp phủ sắc thái ánh sáng môi trường theo 4 mốc giờ */}
        <div
          className="pointer-events-none fixed inset-0 z-10 transition-colors duration-1000"
          style={{ backgroundColor: currentPreset.ambientTint }}
          aria-hidden="true"
        />

        {/* Lớp Mây trắng mờ SVG trôi chậm phía trên bản đồ, ẩn dần khi zoom sát */}
        <AtmosphericCloudsOverlay zoom={currentZoom} liteMode={liteMode} />

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
              title="Xem bản đồ chi tiết"
              className="glass-panel group flex min-h-[44px] items-center gap-2.5 rounded-full border-white/95 px-5 py-2 text-xs font-extrabold text-[#0f2a24] shadow-[0_14px_32px_rgba(15,42,36,0.22)] transition-colors hover:border-[#2b8fd0] hover:bg-white cursor-pointer"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2b8fd0] text-white shadow-xs transition-transform group-hover:scale-110">
                <MapIcon className="h-3.5 w-3.5" />
              </span>
              <span>Xem bản đồ chi tiết</span>
            </motion.button>
          </div>
        )}

        {/* Ghi nguồn chuẩn quy định khi dùng nền Ảnh Vệ Tinh Esri World Imagery */}
        {mapStyleMode === 'satellite' && (
          <div
            className="pointer-events-none fixed left-2.5 z-10 max-w-[68vw] truncate rounded-full border border-white/80 bg-white/80 px-2.5 py-0.5 text-[9px] font-semibold text-[#0f2a24] shadow-xs backdrop-blur-md sm:max-w-md sm:px-3 sm:py-1 sm:text-[10px]"
            style={{
              bottom: 'calc(var(--safe-bottom) + 6px)',
            }}
          >
            Nguồn ảnh vệ tinh: Tiles &copy; Esri &mdash; Source: Esri, USDA,
            USGS, GeoEye, IGN &amp; GIS Community
          </div>
        )}
      </div>
    );
  }
);
