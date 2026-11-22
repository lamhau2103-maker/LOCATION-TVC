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
import { registerMapLibreFarmIcons } from '../utils/icons';
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
 * Hệ số kích thước icon cố định theo pixel màn hình từng thiết bị:
 * - Điện thoại (< 640px): ~28px
 * - iPad / Tablet (640 - 1024px): ~34px
 * - Laptop / Màn lớn (>= 1024px): ~40px
 * (Texture gốc có kích thước hiển thị 64x76 ở scale 1.0)
 */
function getDeviceBaseIconScale(): number {
  if (typeof window === 'undefined') return 0.62;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 640 || h < 500) return 0.46; // ~28-30px
  if (w < 1024) return 0.54; // ~34px
  return 0.63; // ~40px
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

  // Điện thoại xoay ngang (chiều cao < 500px): Card nằm bên phải rộng ~320px
  if (h < 500 && w > h) {
    return {
      top: 44,
      right: Math.min(330, Math.round(w * 0.44)),
      bottom: 20,
      left: 20,
    };
  }

  // Điện thoại dọc (< 640px): Card là bottom-sheet 3 mức
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

  // iPad / Tablet dọc (640 <= w < 1024 và h > w): Card là bottom-sheet cao tối đa 60dvh
  if (w < 1024 && h > w) {
    return {
      top: 72,
      right: 24,
      bottom: Math.min(Math.round(h * 0.46), h - 160),
      left: 24,
    };
  }

  // Laptop / Màn lớn / iPad ngang: Card là panel bên phải rộng clamp(320px, 28vw, 420px)
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
      bouncingFarmId,
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

    // Mức maxzoom của Esri World Imagery (mặc định 16, tự hạ xuống 15 nếu phát hiện ô ảnh thiếu/xám)
    const esriMaxZoomRef = useRef<number>(16);
    const tileErrorTimestampsRef = useRef<number[]>([]);
    const currentTerrainExaggerationRef = useRef<number>(1.4);

    // Tự động xoay địa cầu & tạm dừng 3 giây khi người dùng kéo/vuốt
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
      isHub?: boolean;
    } | null>(null);
    const [hubScreenPos, setHubScreenPos] = useState<{
      x: number;
      y: number;
      visible: boolean;
    } | null>(null);

    const buildingGrowScaleRef = useRef(1);
    const buildingAnimTriggeredRef = useRef(false);

    // Lưu toạ độ thực tế đang được đưa vào nguồn 3D WebGL để đối chiếu trong "Kiểm tra vị trí"
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
      biosecurityRadius,
      timeOfDay,
      liteMode,
      onSelectFarm,
      onSelectHub,
      onClearSelection,
      onSatelliteFallbackToStreet,
    };

    // Tính toán nhãn Nhà máy Trung tâm trên màn hình (chỉ hiện khi hover, khi chọn nhà máy hoặc khi camera ở gần)
    const updateHubLabelScreenPosition = useCallback(() => {
      const map = mapRef.current;
      if (!map || !isMapLoadedRef.current) return;
      const hub = latestStateRef.current.centralHub;
      try {
        const pt = map.project([hub.lng, hub.lat]);
        const center = map.getCenter();
        // Kiểm tra điểm có nằm ở nửa mặt trước của quả địa cầu không (góc lệch kinh độ/vĩ độ < 82 độ)
        const dLng = Math.abs(
          ((((hub.lng - center.lng) % 360) + 540) % 360) - 180
        );
        const dLat = Math.abs(hub.lat - center.lat);
        const isFrontHemisphere =
          map.getZoom() > 4.5 || (dLng < 78 && dLat < 78);

        setHubScreenPos({
          x: pt.x,
          y: pt.y,
          visible: isFrontHemisphere,
        });
      } catch {
        // ignore
      }
    }, []);

    // Điều khiển camera điện ảnh (có tính padding của Card để không bao giờ che khuất điểm đang chọn)
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
        const hubRendered = renderedCoordsMapRef.current.get('__CENTRAL_HUB__') || {
          lat: hub.lat,
          lng: hub.lng,
        };
        const hubDevKm = calculateDistanceKm(
          hub.lat,
          hub.lng,
          hubRendered.lat,
          hubRendered.lng
        );
        const hubDevMeters = hubDevKm * 1000;
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
          const devKm = calculateDistanceKm(
            f.lat,
            f.lng,
            rendered.lat,
            rendered.lng
          );
          const devMeters = devKm * 1000;
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
     * Xây dựng GeoJSON FeatureCollection cho toàn bộ điểm trang trại (100% toạ độ gốc không làm tròn)
     */
    const buildFarmsPinGeoJSON = useCallback(
      (
        list: Farm[],
        curSelectedId: string | null,
        curHoveredId: string | null,
        curHubSelected: boolean,
        curTourRunning: boolean,
        curSearchQuery: string,
        curMatchedIds: Set<string>,
        curBouncingId?: string | null
      ) => {
        const hasSearch = curSearchQuery.length > 0;
        const baseScale = getDeviceBaseIconScale();

        return {
          type: 'FeatureCollection' as const,
          features: list.map((f) => {
            const exactLng = Number(f.lng);
            const exactLat = Number(f.lat);
            renderedCoordsMapRef.current.set(f.id, {
              lat: exactLat,
              lng: exactLng,
            });

            const isSelected = curSelectedId === f.id;
            const isHovered = curHoveredId === f.id;
            const isBouncing = curBouncingId === f.id;
            const isMatched = hasSearch && curMatchedIds.has(f.id);

            let opacity = 1;
            if (curHubSelected && !f.isConnectable) {
              opacity = 0.45;
            } else if (curTourRunning && !isSelected) {
              opacity = 0.45;
            } else if (hasSearch && !isMatched && !isSelected) {
              opacity = 0.35;
            }

            let scaleMult = 1;
            if (isBouncing) scaleMult = 1.32;
            else if (isSelected) scaleMult = 1.24;
            else if (isHovered || isMatched) scaleMult = 1.15;

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
                iconImage: iconKey,
                color: catColor,
                opacity,
                pinScale: baseScale * scaleMult,
                sortRank: isSelected ? 100 : isHovered ? 80 : f.isConnectable ? 50 : 10,
              },
              geometry: {
                type: 'Point' as const,
                coordinates: [exactLng, exactLat],
              },
            };
          }),
        };
      },
      []
    );

    const buildHubPinGeoJSON = useCallback(
      (
        hub: CentralHub,
        curHubSelected: boolean,
        curHoveredId: string | null
      ) => {
        const exactLng = Number(hub.lng);
        const exactLat = Number(hub.lat);
        renderedCoordsMapRef.current.set('__CENTRAL_HUB__', {
          lat: exactLat,
          lng: exactLng,
        });

        const baseScale = getDeviceBaseIconScale();
        const isHovered = curHoveredId === '__CENTRAL_HUB__';
        const scaleMult = curHubSelected ? 1.3 : isHovered ? 1.18 : 1.08;

        return {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              properties: {
                id: '__CENTRAL_HUB__',
                name: hub.name,
                isHub: true,
                iconImage: 'farm-icon-hub',
                color: '#2b8fd0',
                pinScale: baseScale * scaleMult,
              },
              geometry: {
                type: 'Point' as const,
                coordinates: [exactLng, exactLat],
              },
            },
          ],
        };
      },
      []
    );

    const setupCustomLayers = useCallback(
      (map: maplibregl.Map) => {
        const {
          visibleFarms: curFarms,
          centralHub: curHub,
          selectedFarm: curSelected,
          isHubSelected: curHubSelected,
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
        const bioGeoJSON = buildBiosecurityGeoJSON(curFarms, curRadius, 0.5);
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

        // 4. Cụm công trình chuồng trại 3D
        const farmsToBuild = getFarmsFor3DBuildings(map, curFarms, curLite);
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

        // 5. Đăng ký toàn bộ ảnh icon 3D (Gà, Heo, Văn phòng, Kho, Rửa xe, Nhà trại, Nhà máy Trung tâm)
        void registerMapLibreFarmIcons(map);

        const farmsGeoJSON = buildFarmsPinGeoJSON(
          curFarms,
          curSelected?.id || null,
          null,
          curHubSelected,
          false,
          '',
          new Set()
        );

        if (!map.getSource('farms-symbol-source')) {
          map.addSource('farms-symbol-source', {
            type: 'geojson',
            data: farmsGeoJSON,
          });
        }

        // Vòng sóng nhẹ nằm sát bề mặt tại đúng toạ độ trang trại
        if (!map.getLayer('farms-sonar-ring')) {
          map.addLayer({
            id: 'farms-sonar-ring',
            type: 'circle',
            source: 'farms-symbol-source',
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                1.5,
                6,
                4.5,
                9,
                12,
                13,
                16,
                16,
              ],
              'circle-color': ['get', 'color'],
              'circle-opacity': ['*', ['get', 'opacity'], 0.22],
              'circle-stroke-width': 1.5,
              'circle-stroke-color': ['get', 'color'],
              'circle-stroke-opacity': ['*', ['get', 'opacity'], 0.55],
            },
          });
        }

        // Chấm tâm nhỏ nằm sát bề mặt đúng tại toạ độ (lat, lng)
        // Ở mức rất xa (altitude > 1.5 ~ zoom < 3.6): hiển thị chấm màu rõ nét
        if (!map.getLayer('farms-surface-dot')) {
          map.addLayer({
            id: 'farms-surface-dot',
            type: 'circle',
            source: 'farms-symbol-source',
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                1.5,
                4.2,
                3.5,
                5.2,
                5.5,
                3.2,
                15,
                3.8,
              ],
              'circle-color': ['get', 'color'],
              'circle-stroke-width': 1.6,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': ['get', 'opacity'],
              'circle-stroke-opacity': ['get', 'opacity'],
            },
          });
        }

        // Ghim Icon 3D gắn trực tiếp vào toạ độ trên địa cầu & bản đồ (neo bằng mũi ghim dưới đáy 'bottom')
        // Ba mức theo độ cao camera / zoom:
        // - Rất xa (zoom < 3.1, altitude > 1.5): chỉ hiện chấm màu + vòng sóng, ghim mờ dần
        // - Trung bình (zoom 3.4 - 6.2, altitude 0.6 - 1.5): ghim thu nhỏ ~70%
        // - Gần (zoom >= 6.5, altitude < 0.6): ghim đầy đủ 100% kèm viền
        if (!map.getLayer('farms-symbol-layer')) {
          map.addLayer({
            id: 'farms-symbol-layer',
            type: 'symbol',
            source: 'farms-symbol-source',
            layout: {
              'icon-image': ['get', 'iconImage'],
              'icon-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                2.0,
                ['*', ['get', 'pinScale'], 0.62],
                4.5,
                ['*', ['get', 'pinScale'], 0.72],
                7.2,
                ['get', 'pinScale'],
                16.5,
                ['*', ['get', 'pinScale'], 1.06],
              ],
              'icon-anchor': 'bottom',
              'icon-offset': [0, 0],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-pitch-alignment': 'viewport',
              'icon-rotation-alignment': 'viewport',
              'symbol-sort-key': ['get', 'sortRank'],
            },
            paint: {
              'icon-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                1.8,
                0,
                2.25,
                ['get', 'opacity'],
                16.5,
                ['get', 'opacity'],
              ],
            },
          });
        }

        // 6. Nguồn & Layer 3D cho NHÀ MÁY TRUNG TÂM THÁI VIỆT
        const hubGeoJSON = buildHubPinGeoJSON(curHub, curHubSelected, null);
        if (!map.getSource('hub-symbol-source')) {
          map.addSource('hub-symbol-source', {
            type: 'geojson',
            data: hubGeoJSON,
          });
        }

        if (!map.getLayer('hub-sonar-ring')) {
          map.addLayer({
            id: 'hub-sonar-ring',
            type: 'circle',
            source: 'hub-symbol-source',
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                1.5,
                9,
                5,
                14,
                12,
                20,
              ],
              'circle-color': '#2b8fd0',
              'circle-opacity': 0.25,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#2b8fd0',
              'circle-stroke-opacity': 0.75,
            },
          });
        }

        if (!map.getLayer('hub-surface-dot')) {
          map.addLayer({
            id: 'hub-surface-dot',
            type: 'circle',
            source: 'hub-symbol-source',
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                1.5,
                5.5,
                4,
                6.2,
                8,
                4.2,
              ],
              'circle-color': '#2b8fd0',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            },
          });
        }

        if (!map.getLayer('hub-symbol-layer')) {
          map.addLayer({
            id: 'hub-symbol-layer',
            type: 'symbol',
            source: 'hub-symbol-source',
            layout: {
              'icon-image': ['get', 'iconImage'],
              'icon-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                2.0,
                ['*', ['get', 'pinScale'], 0.72],
                4.5,
                ['*', ['get', 'pinScale'], 0.84],
                7.5,
                ['*', ['get', 'pinScale'], 1.12],
                16.5,
                ['*', ['get', 'pinScale'], 1.18],
              ],
              'icon-anchor': 'bottom',
              'icon-offset': [0, 0],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-pitch-alignment': 'viewport',
              'icon-rotation-alignment': 'viewport',
            },
            paint: {
              'icon-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                1.7,
                0,
                2.15,
                1,
              ],
            },
          });
        }

        updateHubLabelScreenPosition();
      },
      [
        applySkyAndLight,
        buildFarmsPinGeoJSON,
        buildHubPinGeoJSON,
        getFarmsFor3DBuildings,
        updateHubLabelScreenPosition,
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

      // Xử lý lỗi tải ô ảnh vệ tinh
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

      // Raycast tìm điểm trang trại hoặc nhà máy trong vùng bấm tối thiểu 44x44px
      const queryInteractiveFeatureAtPoint = (point: maplibregl.Point) => {
        const activeLayers = [
          'hub-symbol-layer',
          'hub-surface-dot',
          'farms-symbol-layer',
          'farms-surface-dot',
          'farms-3d-extrusion',
        ].filter((id) => Boolean(map.getLayer(id)));

        if (activeLayers.length === 0) return null;

        // Đầu tiên thử vùng chính xác 16x16px, nếu không trúng thì mở rộng ra đúng vùng 44x44px (bán kính 22px)
        const tightBox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [point.x - 8, point.y - 8],
          [point.x + 8, point.y + 8],
        ];
        let feats = map.queryRenderedFeatures(tightBox, {
          layers: activeLayers,
        });

        if (feats.length === 0) {
          const touchBox: [maplibregl.PointLike, maplibregl.PointLike] = [
            [point.x - 22, point.y - 22],
            [point.x + 22, point.y + 22],
          ];
          feats = map.queryRenderedFeatures(touchBox, {
            layers: activeLayers,
          });
        }

        return feats[0] || null;
      };

      map.on('click', (e) => {
        const feat = queryInteractiveFeatureAtPoint(e.point);
        if (!feat) {
          // Bấm vào nền trống -> tắt đường sáng / đóng card
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
          const projected = map.project([matched.lng, matched.lat]);
          setHoveredTooltip({
            name: matched.name,
            x: projected.x,
            y: projected.y,
          });
        }
      });

      map.on('move', () => {
        updateHubLabelScreenPosition();
      });

      map.on('zoom', () => {
        const z = map.getZoom();
        setCurrentZoom(z);
        updateHubLabelScreenPosition();

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

      // Lắng nghe ResizeObserver, orientationchange, visualViewport để tự động co giãn không lệch tâm
      const handleViewportResize = () => {
        if (!mapRef.current) return;
        try {
          mapRef.current.resize();
          updateHubLabelScreenPosition();
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

    // Chuyển đổi nền Vệ tinh / Đường phố sáng
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

    // Đồng bộ dữ liệu nguồn 3D cho trang trại & nhà máy trung tâm mỗi khi danh sách hoặc trạng thái chọn thay đổi
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

      const symbolSource = map.getSource(
        'farms-symbol-source'
      ) as maplibregl.GeoJSONSource | undefined;
      if (symbolSource) {
        symbolSource.setData(
          buildFarmsPinGeoJSON(
            visibleFarms,
            selectedFarm?.id || null,
            hoveredId,
            isHubSelected,
            isTourRunning,
            normalizedQuery,
            matchedFarmIds,
            bouncingFarmId
          )
        );
      }

      const hubSource = map.getSource(
        'hub-symbol-source'
      ) as maplibregl.GeoJSONSource | undefined;
      if (hubSource) {
        hubSource.setData(
          buildHubPinGeoJSON(centralHub, isHubSelected, hoveredId)
        );
      }

      updateHubLabelScreenPosition();
    }, [
      visibleFarms,
      centralHub,
      selectedFarm,
      isHubSelected,
      hoveredId,
      isTourRunning,
      normalizedQuery,
      matchedFarmIds,
      bouncingFarmId,
      biosecurityRadius,
      timeOfDay,
      liteMode,
      buildFarmsPinGeoJSON,
      buildHubPinGeoJSON,
      getFarmsFor3DBuildings,
      updateHubLabelScreenPosition,
    ]);

    // Hiệu ứng gợn sóng lan toả chậm cho vòng bán kính an toàn sinh học và vòng sóng dưới chân ghim 3D
    useEffect(() => {
      if (liteMode) return;

      let ripplePhase = 0;
      const interval = setInterval(() => {
        const map = mapRef.current;
        if (!map || !isMapLoadedRef.current) return;

        ripplePhase = (ripplePhase + 0.04) % 1;
        const pulseWave = (Math.sin(ripplePhase * Math.PI * 2) + 1) / 2;

        if (map.getLayer('farms-sonar-ring')) {
          map.setPaintProperty(
            'farms-sonar-ring',
            'circle-opacity',
            ['*', ['get', 'opacity'], 0.12 + pulseWave * 0.22]
          );
        }

        if (map.getLayer('hub-sonar-ring')) {
          map.setPaintProperty(
            'hub-sonar-ring',
            'circle-opacity',
            0.15 + pulseWave * 0.28
          );
        }

        if (stage === 'map') {
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
      }, 95);

      return () => clearInterval(interval);
    }, [visibleFarms, biosecurityRadius, liteMode, stage]);

    /**
     * PHẦN B: ĐƯỜNG CUNG VỆT SÁNG TỪ NHÀ MÁY TRUNG TÂM CHỈ NỐI TRẠI GÀ VÀ TRẠI HEO
     * - Mặc định KHÔNG có đường cung nào.
     * - Chỉ xuất hiện khi:
     *   1. Người dùng chọn Nhà máy Trung tâm (isHubSelected === true) -> nối tới tất cả trại gà & trại heo thoả isConnectableFarm
     *   2. Hoặc người dùng bấm "Hiện đường từ nhà máy" trong card của 1 trại nối được (singleArcFarmId)
     * - Hiệu ứng:
     *   + Khi bật: các đường lần lượt "bắn ra" từ Nhà máy tới từng trại trong 1,2 giây (stagger), sau đó hạt sáng chạy dọc đường.
     *   + Màu: Vàng #facc15 -> Cam #fb923c cho trại gà; Vàng #facc15 -> Hồng san hô #fb7185 cho trại heo; đầu đường tại trại có chấm sáng nhấp nháy.
     *   + Khi tắt: đường mờ dần và co ngược về Nhà máy trong 0,6 giây rồi huỷ hoàn toàn ArcLayer.
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

        const arcData = farmsForArcs.map((farm, idx) => {
          // Stagger bắn ra trong 1,2 giây (1200ms)
          let reachProgress = 1;
          if (arcModeRef.current === 'growing') {
            const staggerDelay = total > 1 ? (idx / (total - 1)) * 480 : 0;
            const localElapsed = Math.max(0, elapsedMs - staggerDelay);
            const rawT = Math.min(1, localElapsed / 720);
            reachProgress = 1 - Math.pow(1 - rawT, 3);
          } else if (arcModeRef.current === 'shrinking') {
            // Co về nhà máy trong 0,6 giây (600ms)
            const shrinkT = Math.min(1, elapsedMs / 600);
            reachProgress = Math.max(0, 1 - shrinkT);
          }

          const currentTargetLng =
            centralHub.lng + (farm.lng - centralHub.lng) * reachProgress;
          const currentTargetLat =
            centralHub.lat + (farm.lat - centralHub.lat) * reachProgress;

          // Hạt sáng chạy dọc đường từ Nhà máy -> Trại
          const particleT = ((phase * 0.55 + idx * 0.21) % 1) * reachProgress;
          const particleLng =
            centralHub.lng + (farm.lng - centralHub.lng) * particleT;
          const particleLat =
            centralHub.lat + (farm.lat - centralHub.lat) * particleT;

          const pulse = (Math.sin(phase * 2.5 - idx * 0.7) + 1) / 2;

          // Màu đích theo loại: Trại gà = Cam #fb923c [251, 146, 60]; Trại heo = Hồng san hô #fb7185 [251, 113, 133]
          const targetRgb: [number, number, number] =
            farm.category === 'pig' ? [251, 113, 133] : [251, 146, 60];

          return {
            id: farm.id,
            source: [Number(centralHub.lng), Number(centralHub.lat)] as [
              number,
              number,
            ],
            target: [currentTargetLng, currentTargetLat] as [number, number],
            exactFarmPos: [Number(farm.lng), Number(farm.lat)] as [
              number,
              number,
            ],
            particlePos: [particleLng, particleLat] as [number, number],
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

        // Chấm sáng nhấp nháy ở đầu đường tại mỗi trại
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

        // Chế độ nhẹ: bỏ hạt chạy, chỉ vẽ đường đơn giản
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
    }, [activeTargetFarms, centralHub, liteMode]);

    const currentPreset = APP_CONFIG.timePresets[timeOfDay];

    // Nhãn "NHÀ MÁY TRUNG TÂM THÁI VIỆT": chỉ hiện khi rê chuột, khi đang chọn nhà máy hoặc khi camera đã ở gần (zoom >= 9.5)
    const shouldShowHubLabel =
      Boolean(hubScreenPos?.visible) &&
      (hoveredId === '__CENTRAL_HUB__' ||
        isHubSelected ||
        currentZoom >= 9.5);

    return (
      <div className="app-viewport relative bg-[#041829]">
        {/* Nền vũ trụ xanh đậm có sao mờ và quầng khí quyển xanh ngọc */}
        <SpaceOceanBackdrop visible={stage === 'globe'} liteMode={liteMode} />

        {/* Khung chứa MapLibre GL */}
        <div ref={mapContainerRef} className="relative z-10 h-full w-full" />

        {/* Nhãn "NHÀ MÁY TRUNG TÂM THÁI VIỆT" đặt phía trên-bên cạnh icon, chỉ hiện khi hover / chọn nhà máy / camera gần */}
        {shouldShowHubLabel && hubScreenPos && (
          <div
            className="pointer-events-none fixed z-20 whitespace-nowrap rounded-full border border-white/95 bg-white/92 px-3 py-1 text-[10px] font-extrabold tracking-wide text-[#0f2a24] shadow-md backdrop-blur-md transition-opacity duration-200"
            style={{
              left: `${Math.min(
                Math.max(hubScreenPos.x + 22, 12),
                typeof window !== 'undefined' ? window.innerWidth - 210 : 1000
              )}px`,
              top: `${Math.max(hubScreenPos.y - 44, 12)}px`,
            }}
          >
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#2b8fd0]" />
            {centralHub.name}
          </div>
        )}

        {/* Tooltip tên trang trại khi rê chuột vào icon trên địa cầu hoặc bản đồ */}
        {hoveredTooltip && (
          <div
            className="pointer-events-none fixed z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/95 bg-white/95 px-3 py-1 text-[11px] font-extrabold text-[#0f2a24] shadow-md backdrop-blur-md"
            style={{
              left: `${hoveredTooltip.x}px`,
              top: `${Math.max(hoveredTooltip.y - 54, 12)}px`,
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

        {/* Ghi nguồn chuẩn quy định khi dùng nền Ảnh Vệ Tinh Esri World Imagery (tự thu gọn trên điện thoại) */}
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
