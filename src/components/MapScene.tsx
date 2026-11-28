import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
  FACTORY_FLY_DURATION_MS,
  FACTORY_FOCUS_ZOOM,
  getCategoryConfig,
  getGlobeEntryZoom,
  GLOBE_ENTRY_FLY_DURATION_MS,
  MAP_TILE_PRELOAD_CONFIG,
  MAP_ZOOM_CONFIG,
  RESPONSIVE_BREAKPOINTS,
} from '../config';
import {
  AppStage,
  ArcColorConfig,
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
  flyToGlobeEntry: () => void;
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
  arcColors: ArcColorConfig;
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
const CONTROL_TOWER_SPEED_KM_PER_SEC = 16;
const ARRIVAL_RIPPLE_DURATION_MS = 760;

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

function parseHexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.trim().replace('#', '');
  const fullHex =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  if (fullHex.length !== 6) {
    return [255, 255, 255];
  }
  const r = parseInt(fullHex.slice(0, 2), 16);
  const g = parseInt(fullHex.slice(2, 4), 16);
  const b = parseInt(fullHex.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return [255, 255, 255];
  }
  return [r, g, b];
}

function hexToSoftRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

interface RipplePointItem {
  farm: Farm;
  lng: number;
  lat: number;
  color: string;
  isHub: boolean;
  isOther: boolean;
  sizePx: number;
}

interface ResolvedRouteColorPair {
  from: string;
  to: string;
  fromRgb: [number, number, number];
  toRgb: [number, number, number];
}

interface ResolvedRouteColorsState {
  chicken: ResolvedRouteColorPair;
  pig: ResolvedRouteColorPair;
  other: ResolvedRouteColorPair;
}

interface ArcGeometryItem {
  farm: Farm;
  hubLng: number;
  hubLat: number;
  farmLng: number;
  farmLat: number;
  ctrlPt: [number, number];
  fullCoords: Array<[number, number]>;
  transitMs: number;
  cycleMs: number;
  startDelayMs: number;
}

const FarmRipplesOverlay = React.memo(function FarmRipplesOverlay({
  ripplePoints,
  normalizedQuery,
  matchedFarmIds,
  isHubSelected,
  centralHubId,
  farmRippleRefs,
  rippleLayerRef,
  onSyncAfterRender,
}: {
  ripplePoints: RipplePointItem[];
  normalizedQuery: string;
  matchedFarmIds: Set<string>;
  isHubSelected: boolean;
  centralHubId?: string;
  farmRippleRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  rippleLayerRef: React.MutableRefObject<HTMLDivElement | null>;
  onSyncAfterRender: () => void;
}) {
  useLayoutEffect(() => {
    onSyncAfterRender();
  });

  if (ripplePoints.length === 0) return null;

  const hasSearch = normalizedQuery.length > 0;

  return (
    <div
      ref={rippleLayerRef}
      className="farm-ripple-layer pointer-events-none fixed inset-0 z-10 overflow-hidden"
      aria-hidden="true"
    >
      {ripplePoints.map((item) => {
        const isHubItem = Boolean(
          item.farm.isFeedMill ||
            item.farm.subType === 'hub' ||
            (centralHubId && item.farm.id === centralHubId)
        );
        const isDimmedBySearch = hasSearch && !matchedFarmIds.has(item.farm.id);
        const isDimmedByHub =
          isHubSelected &&
          !isHubItem &&
          !(
            item.farm.isConnectable &&
            (item.farm.category === 'chicken' || item.farm.category === 'pig')
          );
        const dimmedMode = isDimmedBySearch
          ? 'search'
          : isDimmedByHub
          ? 'hub'
          : undefined;

        return (
          <div
            key={`farm-ripple-${item.farm.id}`}
            ref={(el) => {
              if (el) {
                farmRippleRefs.current.set(item.farm.id, el);
              } else {
                farmRippleRefs.current.delete(item.farm.id);
              }
            }}
            data-dimmed={dimmedMode}
            className="farm-ripple-anchor"
            style={
              {
                '--ripple-color': item.color,
                '--ripple-fill': hexToSoftRgba(item.color, 0.16),
                '--ripple-size': `${item.sizePx}px`,
              } as React.CSSProperties
            }
          >
            <div
              className={`farm-ripple-ring ${
                item.isHub
                  ? 'farm-ripple-ring--hub'
                  : item.isOther
                  ? 'farm-ripple-ring--other'
                  : ''
              }`}
            />
            <div
              className={`farm-ripple-ring farm-ripple-ring-delayed ${
                item.isHub
                  ? 'farm-ripple-ring--hub'
                  : item.isOther
                  ? 'farm-ripple-ring--other'
                  : ''
              }`}
            />
          </div>
        );
      })}
    </div>
  );
});


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
      arcColors,
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

    const particlesCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const particlesRafRef = useRef<number | null>(null);
    const particlesTimeRef = useRef<number>(
      typeof performance !== 'undefined' ? performance.now() : 0
    );
    const highlightedArcFarmIdRef = useRef<string | null>(null);
    const drawParticlesFrameRef = useRef<(nowMs?: number) => void>(() => {});
    const colorsRef = useRef<ResolvedRouteColorsState>({
      chicken: {
        from: arcColors.chicken.from,
        to: arcColors.chicken.to,
        fromRgb: parseHexToRgb(arcColors.chicken.from),
        toRgb: parseHexToRgb(arcColors.chicken.to),
      },
      pig: {
        from: arcColors.pig.from,
        to: arcColors.pig.to,
        fromRgb: parseHexToRgb(arcColors.pig.from),
        toRgb: parseHexToRgb(arcColors.pig.to),
      },
      other: {
        from: APP_CONFIG.colors.categories.other.hex,
        to: APP_CONFIG.colors.categories.other.hex,
        fromRgb: parseHexToRgb(APP_CONFIG.colors.categories.other.hex),
        toRgb: parseHexToRgb(APP_CONFIG.colors.categories.other.hex),
      },
    });

    useEffect(() => {
      colorsRef.current = {
        chicken: {
          from: arcColors.chicken.from,
          to: arcColors.chicken.to,
          fromRgb: parseHexToRgb(arcColors.chicken.from),
          toRgb: parseHexToRgb(arcColors.chicken.to),
        },
        pig: {
          from: arcColors.pig.from,
          to: arcColors.pig.to,
          fromRgb: parseHexToRgb(arcColors.pig.from),
          toRgb: parseHexToRgb(arcColors.pig.to),
        },
        other: {
          from: APP_CONFIG.colors.categories.other.hex,
          to: APP_CONFIG.colors.categories.other.hex,
          fromRgb: parseHexToRgb(APP_CONFIG.colors.categories.other.hex),
          toRgb: parseHexToRgb(APP_CONFIG.colors.categories.other.hex),
        },
      };
      drawParticlesFrameRef.current();
    }, [arcColors]);

    const rippleLayerRef = useRef<HTMLDivElement | null>(null);
    const farmRippleRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const arcGeometriesRef = useRef<ArcGeometryItem[]>([]);
    const ripplePointsRef = useRef<RipplePointItem[]>([]);
    const showFactoryArcsRef = useRef<boolean>(true);
    const isZoomingRef = useRef<boolean>(false);
    const zoomEndRippleTimerRef = useRef<number | null>(null);
    const syncPositionsRef = useRef<() => void>(() => {});

    const [hoveredArcId, setHoveredArcId] = useState<string | null>(null);
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
      onEnterMapOverview,
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
      onEnterMapOverview,
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
        const colors = isPig ? arcColors.pig : arcColors.chicken;

        return {
          id: `globe-arc-${farm.id}`,
          startLat: hubLat,
          startLng: hubLng,
          endLat: farmLat,
          endLng: farmLng,
          color: [colors.from, colors.to],
        };
      });
    }, [activeTargetFarms, centralHub, showFactoryArcs, arcColors]);

    const executeFlyToGlobeEntry = useCallback(() => {
      const map = mapRef.current;
      const hub = latestStateRef.current.centralHub;
      if (!map) return;

      const fallback = getSystemCenterAndZoom(
        latestStateRef.current.farms,
        hub
      );
      let targetCenter: [number, number] = fallback.center;
      if (hub) {
        let coords: [number, number] = [Number(hub.lng), Number(hub.lat)];
        if (Math.abs(coords[0]) < 30 && Math.abs(coords[1]) >= 30) {
          coords = [coords[1], coords[0]];
        }
        targetCenter = coords;
      }

      const rawTargetZoom = getGlobeEntryZoom();
      const minZoom =
        typeof map.getMinZoom === 'function' ? map.getMinZoom() : 2;
      const maxZoom =
        typeof map.getMaxZoom === 'function' ? map.getMaxZoom() : 19;
      const targetZoom = Math.max(minZoom, Math.min(maxZoom, rawTargetZoom));

      map.resize();
      map.flyTo({
        center: targetCenter,
        zoom: targetZoom,
        pitch: 0,
        bearing: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        duration: GLOBE_ENTRY_FLY_DURATION_MS,
        easing: (t) => 1 - Math.pow(1 - t, 3),
        essential: true,
      });
    }, []);

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
      flyToGlobeEntry: executeFlyToGlobeEntry,
      flyToHub: () => {
        if (!centralHub) return;
        const map = mapRef.current;
        if (map && latestStateRef.current.stage === 'map') {
          const hubLng = Number(centralHub.lng);
          const hubLat = Number(centralHub.lat);
          const hasCard = Boolean(latestStateRef.current.isHubSelected);
          const padding = computeCameraPadding(
            hasCard,
            latestStateRef.current.mobileSheetSnap
          );
          map.resize();
          map.flyTo({
            center: [hubLng, hubLat],
            zoom: FACTORY_FOCUS_ZOOM,
            pitch: 0,
            bearing: 0,
            padding,
            duration: FACTORY_FLY_DURATION_MS,
            essential: true,
          });
        }
        if (globeRef.current && latestStateRef.current.stage === 'globe') {
          globeRef.current.pointOfView(
            {
              lat: Number(centralHub.lat),
              lng: Number(centralHub.lng),
              altitude: Math.min(1.15, getResponsiveGlobeAltitude() * 0.48),
            },
            FACTORY_FLY_DURATION_MS
          );
        }
      },
      flyToConnectedOverview: () => {
        if (!centralHub) return;
        const map = mapRef.current;
        if (map && latestStateRef.current.stage === 'map') {
          const hubLng = Number(centralHub.lng);
          const hubLat = Number(centralHub.lat);
          const hasCard = Boolean(latestStateRef.current.isHubSelected);
          const padding = computeCameraPadding(
            hasCard,
            latestStateRef.current.mobileSheetSnap
          );
          map.resize();
          map.flyTo({
            center: [hubLng, hubLat],
            zoom: FACTORY_FOCUS_ZOOM,
            pitch: 0,
            bearing: 0,
            padding,
            duration: FACTORY_FLY_DURATION_MS,
            essential: true,
          });
        }
        if (globeRef.current) {
          globeRef.current.pointOfView(
            {
              lat: Number(centralHub.lat),
              lng: Number(centralHub.lng),
              altitude: Math.min(1.15, getResponsiveGlobeAltitude() * 0.48),
            },
            FACTORY_FLY_DURATION_MS
          );
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
      if (!container) return;

      let startX = 0;
      let startY = 0;

      const handlePointerDown = (e: PointerEvent) => {
        startX = e.clientX;
        startY = e.clientY;
        (container as any).__isGlobeDragging = false;
      };

      const handlePointerMove = (e: PointerEvent) => {
        const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (dist > 8) {
          (container as any).__isGlobeDragging = true;
        }
      };

      container.addEventListener('pointerdown', handlePointerDown);
      container.addEventListener('pointermove', handlePointerMove);

      if (globeRef.current) return;

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
          if ((container as any).__isGlobeDragging) {
            return;
          }

          if (latestStateRef.current.stage === 'globe') {
            latestStateRef.current.onEnterMapOverview();
          } else {
            if (item.isHub) {
              latestStateRef.current.onSelectHub();
            } else if (item.farm) {
              latestStateRef.current.onSelectFarm(item.farm);
            }
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

        const baseFilter: maplibregl.FilterSpecification = [
          'all',
          ['!=', ['get', 'id'], activeSelectedId],
          ['!=', ['get', 'id'], activeHoveredId],
        ];

        const hoveredFilter: maplibregl.FilterSpecification = [
          '==',
          ['get', 'id'],
          activeHoveredId,
        ];

        try {
          if (map.getLayer('farm-icons')) {
            map.setFilter('farm-icons', baseFilter);
          }
          if (map.getLayer('farm-hovered')) {
            map.setFilter('farm-hovered', hoveredFilter);
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
              2,
              0.34 * deviceFactor * hubScaleMult,
              6,
              0.4 * deviceFactor * hubScaleMult,
              8,
              0.45 * deviceFactor * hubScaleMult,
              10,
              0.56 * deviceFactor * hubScaleMult,
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

        // Nguồn GeoJSON ẩn cho vùng chạm/hover đường cung Bezier từ FEED FACTORY -> trang trại
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

        // Lớp vùng chạm/rê chuột ẩn rộng 14px giúp dễ hover/chạm vào từng đường cung nét đứt
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

        // 1. Nguồn GeoJSON "farms" KHÔNG gom cụm (hiển thị icon riêng lẻ ở mọi mức zoom)
        //    (KHÔNG bao gồm Nhà Máy Cám vì Nhà Máy Cám dùng nguồn hub-source riêng nổi bật)
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

        const deviceFactor = getDeviceSizeFactor();

        // Kích thước chuẩn từ ảnh gốc 256x256px (64px logic):
        // Thu nhỏ gọn gàng ở zoom rất xa để bản đồ thoáng rõ khi hiển thị toàn bộ icon riêng lẻ
        const buildPinSizeExpr = (
          mult: number
        ): maplibregl.ExpressionSpecification => [
          'interpolate',
          ['linear'],
          ['zoom'],
          2,
          0.34 * deviceFactor * mult,
          6,
          0.4 * deviceFactor * mult,
          8,
          0.45 * deviceFactor * mult,
          10,
          0.56 * deviceFactor * mult,
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
              'text-opacity-transition': { duration: 0, delay: 0 },
            },
          });
        }

        // Layer ghim 3D chuẩn cho tất cả địa điểm riêng lẻ ở mọi mức zoom
        if (!map.getLayer('farm-icons')) {
          map.addLayer({
            id: 'farm-icons',
            type: 'symbol',
            source: 'farms',
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
              'icon-opacity-transition': { duration: 0, delay: 0 },
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

      const { center } = getSystemCenterAndZoom(farms, centralHub);
      const initialCenter: [number, number] = centralHub
        ? [Number(centralHub.lng), Number(centralHub.lat)]
        : center;
      const initialZoom = Math.max(2, getGlobeEntryZoom() - 2);

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: initialStyle,
        center: initialCenter,
        zoom: initialZoom,
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
        fadeDuration: 0,
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

      const queryArcFarmIdAtPoint = (point: maplibregl.Point): string => {
        if (!showFactoryArcsRef.current) return '';
        if (map.getLayer('supply-bezier-hit')) {
          const arcBox: [maplibregl.PointLike, maplibregl.PointLike] = [
            [point.x - 10, point.y - 10],
            [point.x + 10, point.y + 10],
          ];
          const feats = map.queryRenderedFeatures(arcBox, {
            layers: ['supply-bezier-hit'],
          });
          const hitId = String(feats[0]?.properties?.farmId || '');
          if (hitId) return hitId;
        }

        // Bổ sung nhận diện chạm/rê chuột trực tiếp lên chấm tròn đang chuyển động
        const arcs = arcGeometriesRef.current;
        if (arcs.length === 0) return '';
        const nowMs = particlesTimeRef.current;
        let closestFarmId = '';
        let closestDistSq = 14 * 14;

        for (const arc of arcs) {
          const phaseMs =
            (((nowMs + arc.startDelayMs) % arc.cycleMs) + arc.cycleMs) %
            arc.cycleMs;
          if (phaseMs > arc.transitMs) continue;

          const t = phaseMs / arc.transitMs;
          const inv = 1 - t;
          const p0 = map.project([arc.hubLng, arc.hubLat]);
          const p1 = map.project(arc.ctrlPt);
          const p2 = map.project([arc.farmLng, arc.farmLat]);
          const px = inv * inv * p0.x + 2 * inv * t * p1.x + t * t * p2.x;
          const py = inv * inv * p0.y + 2 * inv * t * p1.y + t * t * p2.y;
          const dx = px - point.x;
          const dy = py - point.y;
          const dSq = dx * dx + dy * dy;
          if (dSq < closestDistSq) {
            closestDistSq = dSq;
            closestFarmId = arc.farm.id;
          }
        }
        return closestFarmId;
      };

      map.on('click', (e) => {
        const feat = queryInteractiveFeatureAtPoint(e.point);
        if (!feat) {
          // Hỗ trợ chạm/click trực tiếp vào quỹ đạo cung hoặc đốm sáng để nổi bật & xem thông tin trại đích
          const arcFarmId = queryArcFarmIdAtPoint(e.point);
          if (arcFarmId) {
            setHoveredArcId(arcFarmId);
            const matchedArcFarm = latestStateRef.current.farms.find(
              (f) => f.id === arcFarmId
            );
            if (matchedArcFarm) {
              latestStateRef.current.onSelectFarm(matchedArcFarm);
              return;
            }
          }
          setHoveredArcId((prev) => (prev !== null ? null : prev));
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
        if (isMapInteractingRef.current) return;

        const feat = queryInteractiveFeatureAtPoint(e.point);
        if (!feat) {
          const arcFarmId = queryArcFarmIdAtPoint(e.point);
          if (arcFarmId) {
            map.getCanvas().style.cursor = 'pointer';
            setHoveredArcId((prev) => (prev === arcFarmId ? prev : arcFarmId));
            const matchedArcFarm = latestStateRef.current.farms.find(
              (f) => f.id === arcFarmId
            );
            if (matchedArcFarm) {
              setHoveredTooltip({
                name: `Tuyến tới ${matchedArcFarm.name}`,
                badge: getLocationDisplayLabel(
                  matchedArcFarm,
                  latestStateRef.current.customLabels
                ),
                x: e.point.x,
                y: e.point.y,
              });
            }
            setHoveredId((prev) => (prev !== null ? null : prev));
            return;
          }

          setHoveredArcId((prev) => (prev !== null ? null : prev));
          map.getCanvas().style.cursor = '';
          setHoveredId((prev) => (prev !== null ? null : prev));
          setHoveredTooltip((prev) => (prev !== null ? null : prev));
          return;
        }

        map.getCanvas().style.cursor = 'pointer';
        const props = feat.properties || {};

        const farmId = String(props.id || props.farmId || '');
        if (props.isHub) {
          setHoveredArcId((prev) => (prev !== null ? null : prev));
          setHoveredId(farmId);
          setHoveredTooltip(null);
          return;
        }

        const matched = latestStateRef.current.farms.find(
          (f) => f.id === farmId
        );
        if (matched) {
          const hasSupplyRoute =
            showFactoryArcsRef.current &&
            arcGeometriesRef.current.some((a) => a.farm.id === matched.id);
          setHoveredArcId((prev) => {
            const next = hasSupplyRoute ? matched.id : null;
            return prev === next ? prev : next;
          });
          setHoveredId(matched.id);

          if (hasSupplyRoute) {
            const projected = map.project([matched.lng, matched.lat]);
            const badge = getLocationDisplayLabel(
              matched,
              latestStateRef.current.customLabels
            );
            setHoveredTooltip({
              name: `Tuyến tới ${matched.name}`,
              badge,
              x: projected.x,
              y: projected.y,
            });
          } else if (map.getZoom() < 11) {
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

      // Tạm dừng backdrop-filter và tooltip khi đang zoom/kéo để giữ mượt 60fps
      const markInteractionStart = () => {
        if (interactionResumeTimerRef.current !== null) {
          window.clearTimeout(interactionResumeTimerRef.current);
          interactionResumeTimerRef.current = null;
        }
        isMapInteractingRef.current = true;
        setHoveredTooltip((prev) => (prev !== null ? null : prev));
      };

      const markZoomStart = () => {
        markInteractionStart();
        if (zoomEndRippleTimerRef.current !== null) {
          window.clearTimeout(zoomEndRippleTimerRef.current);
          zoomEndRippleTimerRef.current = null;
        }
        isZoomingRef.current = true;
        rippleLayerRef.current?.classList.add('is-zooming');
        document.body.classList.add('map-is-zooming');
      };

      const schedulePreloadAfterIdle = () => {
        if (interactionResumeTimerRef.current !== null) {
          window.clearTimeout(interactionResumeTimerRef.current);
        }
        interactionResumeTimerRef.current = window.setTimeout(() => {
          isMapInteractingRef.current = false;

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

      const markZoomEnd = () => {
        drawParticlesFrameRef.current();

        if (zoomEndRippleTimerRef.current !== null) {
          window.clearTimeout(zoomEndRippleTimerRef.current);
        }
        zoomEndRippleTimerRef.current = window.setTimeout(() => {
          zoomEndRippleTimerRef.current = null;
          isZoomingRef.current = false;
          document.body.classList.remove('map-is-zooming');
          rippleLayerRef.current?.classList.remove('is-zooming');
          syncPositionsRef.current();
        }, 100);

        schedulePreloadAfterIdle();
      };

      const markMoveEnd = () => {
        if (!isZoomingRef.current) {
          syncPositionsRef.current();
        }
        drawParticlesFrameRef.current();
        schedulePreloadAfterIdle();
      };

      map.on('movestart', markInteractionStart);
      map.on('zoomstart', markZoomStart);
      map.on('moveend', markMoveEnd);
      map.on('zoomend', markZoomEnd);

      // Đồng bộ vẽ chấm sáng ngay trên từng frame render/zoom/move của MapLibre -> ZERO lệch tọa độ
      map.on('render', () => {
        if (
          latestStateRef.current.stage === 'map' &&
          showFactoryArcsRef.current
        ) {
          drawParticlesFrameRef.current();
        }
      });
      map.on('zoom', () => {
        drawParticlesFrameRef.current();
      });
      map.on('move', () => {
        if (!isZoomingRef.current) {
          syncPositionsRef.current();
        }
        drawParticlesFrameRef.current();
      });
      map.on('resize', () => {
        if (!isZoomingRef.current) {
          syncPositionsRef.current();
        }
        drawParticlesFrameRef.current();
      });
      map.on('idle', () => {
        if (!isZoomingRef.current) {
          syncPositionsRef.current();
        }
      });

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
        if (
          latestStateRef.current.stage === 'map' &&
          showFactoryArcsRef.current &&
          arcGeometriesRef.current.length > 0
        ) {
          (
            map.getSource('supply-bezier-arcs') as
              | maplibregl.GeoJSONSource
              | undefined
          )?.setData({
            type: 'FeatureCollection',
            features: arcGeometriesRef.current.map((arc) => ({
              type: 'Feature',
              properties: {
                id: `bezier-${arc.farm.id}`,
                farmId: arc.farm.id,
              },
              geometry: {
                type: 'LineString',
                coordinates: arc.fullCoords,
              },
            })),
          });
        }
        requestAnimationFrame(() => {
          syncPositionsRef.current();
          drawParticlesFrameRef.current(performance.now());
        });
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
            if (m.isMoving()) {
              m.resize();
            } else {
              const preservedCenter = m.getCenter();
              const preservedZoom = m.getZoom();
              m.resize();
              m.jumpTo({
                center: preservedCenter,
                zoom: preservedZoom,
                pitch: 0,
                bearing: 0,
              });
            }
            if (!isZoomingRef.current) {
              syncPositionsRef.current();
            }
            drawParticlesFrameRef.current();
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
        if (zoomEndRippleTimerRef.current !== null) {
          window.clearTimeout(zoomEndRippleTimerRef.current);
        }
        if (particlesRafRef.current !== null) {
          cancelAnimationFrame(particlesRafRef.current);
          particlesRafRef.current = null;
        }
        document.body.classList.remove('map-is-zooming');
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
        syncPositionsRef.current();
        drawParticlesFrameRef.current(performance.now());
        const t = window.setTimeout(() => {
          mapRef.current?.resize();
          mapRef.current?.triggerRepaint();
          syncPositionsRef.current();
          drawParticlesFrameRef.current(performance.now());
        }, 60);
        return () => window.clearTimeout(t);
      }

      isZoomingRef.current = false;
      document.body.classList.remove('map-is-zooming');
      rippleLayerRef.current?.classList.remove('is-zooming');
      if (zoomEndRippleTimerRef.current !== null) {
        window.clearTimeout(zoomEndRippleTimerRef.current);
        zoomEndRippleTimerRef.current = null;
      }
      return undefined;
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

    // Cập nhật dữ liệu source "farms" & "hub-source" (KHÔNG gom cụm) trên Bản đồ 2D
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

    // (Hiệu ứng tỏa tại điểm đang chọn dùng vòng tỏa CSS thuần, không chạy vòng lặp requestAnimationFrame)

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
    // 3. CHẤM SÁNG CHUYỂN ĐỘNG MỘT CHIỀU TỪ FEED FACTORY ➔ TRẠI GÀ/HEO TRÊN CANVAS
    //    - Không vẽ nét đường liền hay nét đứt trên bản đồ
    //    - Đồng bộ vẽ với requestAnimationFrame & MapLibre render/move/zoom -> ZERO lệch tọa độ
    // =========================================================================
    showFactoryArcsRef.current = showFactoryArcs;

    const highlightedArcFarmId =
      hoveredArcId || (selectedFarm && !isHubSelected ? selectedFarm.id : null);
    highlightedArcFarmIdRef.current = highlightedArcFarmId;

    const cachedArcGeometries = useMemo<ArcGeometryItem[]>(() => {
      if (!centralHub || activeTargetFarms.length === 0) return [];

      let hubCoords: [number, number] = [
        Number(centralHub.lng),
        Number(centralHub.lat),
      ];
      if (Math.abs(hubCoords[0]) < 30 && Math.abs(hubCoords[1]) >= 30) {
        hubCoords = [hubCoords[1], hubCoords[0]];
      }
      const [hubLng, hubLat] = hubCoords;

      return activeTargetFarms.map((farm, idx) => {
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
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const inv = 1 - t;
          fullCoords.push([
            inv * inv * hubLng + 2 * inv * t * ctrlPt[0] + t * t * farmLng,
            inv * inv * hubLat + 2 * inv * t * ctrlPt[1] + t * t * farmLat,
          ]);
        }

        let arcLengthKm = 0;
        for (let s = 1; s < fullCoords.length; s++) {
          arcLengthKm += calculateDistanceKm(
            fullCoords[s - 1][1],
            fullCoords[s - 1][0],
            fullCoords[s][1],
            fullCoords[s][0]
          );
        }

        const transitMs = Math.max(
          900,
          Math.round((arcLengthKm / CONTROL_TOWER_SPEED_KM_PER_SEC) * 1000)
        );
        const cycleMs = Math.max(
          3200,
          transitMs + ARRIVAL_RIPPLE_DURATION_MS + 350
        );
        // Phân bổ lệch pha theo tỷ lệ vàng để các tuyến xuất phát tự nhiên, không phóng đồng loạt 40 chấm cùng lúc
        const startDelayMs = Math.round(
          ((idx * 0.38196601125) % 1) * cycleMs
        );

        return {
          farm,
          hubLng,
          hubLat,
          farmLng,
          farmLat,
          ctrlPt,
          fullCoords,
          transitMs,
          cycleMs,
          startDelayMs,
        };
      });
    }, [activeTargetFarms, centralHub]);

    arcGeometriesRef.current = cachedArcGeometries;

    const ripplePoints = useMemo<RipplePointItem[]>(() => {
      const items: RipplePointItem[] = [];
      let hasHubPoint = false;

      for (const farm of visibleFarms) {
        const isHub = Boolean(
          farm.isFeedMill ||
            farm.subType === 'hub' ||
            (centralHub?.id && farm.id === centralHub.id)
        );
        if (isHub) hasHubPoint = true;

        // Trại Gà & Trại Heo sẽ tạo vòng gợn sóng riêng đúng thời điểm chấm hàng tới đích;
        // vòng CSS chỉ giữ cho radar của FEED FACTORY và các điểm nhóm Khác.
        if (!isHub && (farm.category === 'chicken' || farm.category === 'pig')) {
          continue;
        }

        let coords: [number, number] = [Number(farm.lng), Number(farm.lat)];
        if (Math.abs(coords[0]) < 30 && Math.abs(coords[1]) >= 30) {
          coords = [coords[1], coords[0]];
        }
        const [lng, lat] = coords;
        const color = isHub
          ? APP_CONFIG.colors.hubColor
          : getCategoryConfig(farm.category).hex;

        items.push({
          farm,
          lng,
          lat,
          color,
          isHub,
          isOther: !isHub,
          sizePx: isHub ? 52 : 34,
        });
      }

      if (!hasHubPoint && centralHub) {
        let hubCoords: [number, number] = [
          Number(centralHub.lng),
          Number(centralHub.lat),
        ];
        if (Math.abs(hubCoords[0]) < 30 && Math.abs(hubCoords[1]) >= 30) {
          hubCoords = [hubCoords[1], hubCoords[0]];
        }
        items.push({
          farm: {
            id: centralHub.id || 'central-hub',
            name: centralHub.name,
            type: 'Nhà máy cám',
            category: 'other',
            subType: 'hub',
            isFeedMill: true,
            status: 'active',
            lat: hubCoords[1],
            lng: hubCoords[0],
            description: centralHub.subtitle,
          },
          lng: hubCoords[0],
          lat: hubCoords[1],
          color: APP_CONFIG.colors.hubColor,
          isHub: true,
          isOther: false,
          sizePx: 52,
        });
      }

      return items;
    }, [visibleFarms, centralHub]);

    ripplePointsRef.current = ripplePoints;

    const drawParticlesFrame = useCallback((explicitNowMs?: number) => {
      if (explicitNowMs !== undefined) {
        particlesTimeRef.current = explicitNowMs;
      }
      const nowMs = particlesTimeRef.current;
      const canvas = particlesCanvasRef.current;
      const map = mapRef.current;
      if (!canvas) return;

      const container = map?.getContainer();
      const vw = container?.clientWidth || window.innerWidth;
      const vh = container?.clientHeight || window.innerHeight;
      const dpr = latestStateRef.current.liteMode
        ? 1
        : Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.max(1, Math.round(vw * dpr));
      const targetH = Math.max(1, Math.round(vh * dpr));

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${vw}px`;
        canvas.style.height = `${vh}px`;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const arcs = arcGeometriesRef.current;
      if (
        !map ||
        latestStateRef.current.stage !== 'map' ||
        !showFactoryArcsRef.current ||
        arcs.length === 0
      ) {
        return;
      }

      const highlightedId = highlightedArcFarmIdRef.current;
      const hasMultiHighlight =
        arcs.length > 1 &&
        highlightedId !== null &&
        arcs.some((g) => g.farm.id === highlightedId);

      const projectedArcs: Array<{
        arc: ArcGeometryItem;
        p0: maplibregl.Point;
        p1: maplibregl.Point;
        p2: maplibregl.Point;
        isHighlighted: boolean;
        isDimmed: boolean;
      }> = [];

      let highlightedItem: (typeof projectedArcs)[number] | null = null;

      for (const arc of arcs) {
        const p0 = map.project([arc.hubLng, arc.hubLat]);
        const p1 = map.project(arc.ctrlPt);
        const p2 = map.project([arc.farmLng, arc.farmLat]);

        const minX = Math.min(p0.x, p1.x, p2.x);
        const maxX = Math.max(p0.x, p1.x, p2.x);
        const minY = Math.min(p0.y, p1.y, p2.y);
        const maxY = Math.max(p0.y, p1.y, p2.y);
        if (
          maxX < -120 ||
          minX > vw + 120 ||
          maxY < -120 ||
          minY > vh + 120
        ) {
          continue;
        }

        const isHighlighted =
          hasMultiHighlight && arc.farm.id === highlightedId;
        const isDimmed = hasMultiHighlight && !isHighlighted;
        const entry = { arc, p0, p1, p2, isHighlighted, isDimmed };
        if (isHighlighted) {
          highlightedItem = entry;
        } else {
          projectedArcs.push(entry);
        }
      }

      if (highlightedItem) {
        projectedArcs.push(highlightedItem);
      }

      ctx.save();
      const activeColors = colorsRef.current;

      const getRouteColorPair = (farm: Farm): ResolvedRouteColorPair =>
        farm.category === 'pig'
          ? activeColors.pig
          : farm.category === 'chicken'
          ? activeColors.chicken
          : activeColors.other;

      // 1. Vẽ đường dẫn Bezier mảnh bằng gradient từ Màu đầu (Nhà máy) ➔ Màu cuối (Trại) (opacity 0.25)
      //    Khi hover: làm nổi bật tuyến đang chọn bằng màu cuối tùy chỉnh (2px, opacity 0.9) và làm mờ các tuyến khác (0.05)
      for (const item of projectedArcs) {
        const { arc, p0, p1, p2, isHighlighted, isDimmed } = item;
        const { fromRgb, toRgb } = getRouteColorPair(arc.farm);
        const lineOpacity = isHighlighted ? 0.9 : isDimmed ? 0.05 : 0.25;

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
        ctx.lineWidth = isHighlighted ? 2 : 1;

        if (isHighlighted) {
          ctx.strokeStyle = `rgba(${toRgb[0]}, ${toRgb[1]}, ${toRgb[2]}, ${lineOpacity})`;
        } else if (Math.abs(p2.x - p0.x) < 0.5 && Math.abs(p2.y - p0.y) < 0.5) {
          ctx.strokeStyle = `rgba(${toRgb[0]}, ${toRgb[1]}, ${toRgb[2]}, ${lineOpacity})`;
        } else {
          const lineGrad = ctx.createLinearGradient(p0.x, p0.y, p2.x, p2.y);
          lineGrad.addColorStop(
            0,
            `rgba(${fromRgb[0]}, ${fromRgb[1]}, ${fromRgb[2]}, ${lineOpacity})`
          );
          lineGrad.addColorStop(
            1,
            `rgba(${toRgb[0]}, ${toRgb[1]}, ${toRgb[2]}, ${lineOpacity})`
          );
          ctx.strokeStyle = lineGrad;
        }
        ctx.stroke();
      }

      // 2. Vẽ vòng gợn sóng tại chân icon trang trại đúng khoảnh khắc chấm hàng cập bến theo màu cuối đang chọn
      for (const item of projectedArcs) {
        const { arc, p2, isHighlighted, isDimmed } = item;
        const phaseMs =
          (((nowMs + arc.startDelayMs) % arc.cycleMs) + arc.cycleMs) %
          arc.cycleMs;
        if (phaseMs < arc.transitMs) continue;

        const rippleElapsed = phaseMs - arc.transitMs;
        if (rippleElapsed >= ARRIVAL_RIPPLE_DURATION_MS) continue;

        const rp = rippleElapsed / ARRIVAL_RIPPLE_DURATION_MS;
        const easeOut = 1 - Math.pow(1 - rp, 2.2);
        const ringRadius = 4 + easeOut * (isHighlighted ? 20 : 16);
        const ringAlpha =
          (isDimmed ? 0.16 : isHighlighted ? 0.85 : 0.68) *
          Math.pow(1 - rp, 1.5);
        if (ringAlpha <= 0.02) continue;

        const [r, g, b] = getRouteColorPair(arc.farm).toRgb;
        ctx.beginPath();
        ctx.arc(p2.x, p2.y, ringRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(ringAlpha * 0.14).toFixed(
          3
        )})`;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${ringAlpha.toFixed(3)})`;
        ctx.stroke();
      }

      // 3. Vẽ chấm tròn sắc nét (radius 3.5px, viền trắng 1.5px) nội suy màu mượt từ Màu đầu ➔ Màu cuối dọc hành trình t (0 ➔ 1)
      ctx.lineWidth = 1.5;
      for (const item of projectedArcs) {
        const { arc, p0, p1, p2, isHighlighted, isDimmed } = item;
        const phaseMs =
          (((nowMs + arc.startDelayMs) % arc.cycleMs) + arc.cycleMs) %
          arc.cycleMs;
        if (phaseMs > arc.transitMs) continue;

        const rawT = phaseMs / arc.transitMs;
        const inv = 1 - rawT;
        const x = inv * inv * p0.x + 2 * inv * rawT * p1.x + rawT * rawT * p2.x;
        const y = inv * inv * p0.y + 2 * inv * rawT * p1.y + rawT * rawT * p2.y;

        const dotRadius = isHighlighted ? 4 : 3.5;
        const { fromRgb, toRgb } = getRouteColorPair(arc.farm);
        const r = Math.round(fromRgb[0] + (toRgb[0] - fromRgb[0]) * rawT);
        const g = Math.round(fromRgb[1] + (toRgb[1] - fromRgb[1]) * rawT);
        const b = Math.round(fromRgb[2] + (toRgb[2] - fromRgb[2]) * rawT);
        const dotAlpha = isDimmed ? 0.18 : 1;

        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${dotAlpha})`;
        ctx.fill();
        ctx.strokeStyle =
          dotAlpha >= 1 ? '#FFFFFF' : `rgba(255, 255, 255, ${dotAlpha})`;
        ctx.stroke();
      }

      ctx.restore();
    }, []);

    drawParticlesFrameRef.current = drawParticlesFrame;

    // Vòng lặp requestAnimationFrame mượt 60fps cho các chấm sáng chuyển động một chiều từ FEED FACTORY ➔ Trại
    useEffect(() => {
      if (
        stage !== 'map' ||
        !showFactoryArcs ||
        cachedArcGeometries.length === 0
      ) {
        if (particlesRafRef.current !== null) {
          cancelAnimationFrame(particlesRafRef.current);
          particlesRafRef.current = null;
        }
        drawParticlesFrame(performance.now());
        return undefined;
      }

      let active = true;
      const tick = (nowMs: number) => {
        if (!active) return;
        drawParticlesFrame(nowMs);
        particlesRafRef.current = requestAnimationFrame(tick);
      };
      particlesRafRef.current = requestAnimationFrame(tick);

      return () => {
        active = false;
        if (particlesRafRef.current !== null) {
          cancelAnimationFrame(particlesRafRef.current);
          particlesRafRef.current = null;
        }
      };
    }, [stage, showFactoryArcs, cachedArcGeometries, drawParticlesFrame]);

    const syncProjectedPositions = useCallback(() => {
      const map = mapRef.current;
      const ripples = ripplePointsRef.current;

      if (!map || latestStateRef.current.stage !== 'map') {
        farmRippleRefs.current.forEach((rippleEl) => {
          rippleEl.classList.remove('is-ripple-visible');
        });
        return;
      }

      const container = map.getContainer();
      const vw = container?.clientWidth || window.innerWidth;
      const vh = container?.clientHeight || window.innerHeight;

      for (const item of ripples) {
        const rippleEl = farmRippleRefs.current.get(item.farm.id);
        if (!rippleEl) continue;

        const pt = map.project([item.lng, item.lat]);
        const inViewport =
          pt.x >= -44 && pt.x <= vw + 44 && pt.y >= -44 && pt.y <= vh + 44;

        if (inViewport) {
          rippleEl.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0)`;
          rippleEl.classList.add('is-ripple-visible');
        } else {
          rippleEl.classList.remove('is-ripple-visible');
        }
      }
    }, []);

    syncPositionsRef.current = syncProjectedPositions;

    const handleRippleOverlayAfterRender = useCallback(() => {
      if (!isZoomingRef.current) {
        syncProjectedPositions();
      }
    }, [syncProjectedPositions]);

    // Cập nhật nguồn GeoJSON ẩn phục vụ hover/click tuyến & đồng bộ vòng tỏa CSS khi dữ liệu/filter đổi
    useEffect(() => {
      const map = mapRef.current;
      if (map && isMapLoadedRef.current) {
        const hitSource = map.getSource('supply-bezier-arcs') as
          | maplibregl.GeoJSONSource
          | undefined;
        if (hitSource) {
          if (
            stage === 'map' &&
            showFactoryArcs &&
            cachedArcGeometries.length > 0
          ) {
            hitSource.setData({
              type: 'FeatureCollection',
              features: cachedArcGeometries.map((arc) => ({
                type: 'Feature',
                properties: {
                  id: `bezier-${arc.farm.id}`,
                  farmId: arc.farm.id,
                },
                geometry: {
                  type: 'LineString',
                  coordinates: arc.fullCoords,
                },
              })),
            });
          } else {
            hitSource.setData({
              type: 'FeatureCollection',
              features: [],
            });
          }
        }
      }

      syncProjectedPositions();
      drawParticlesFrame();
      const rafId = requestAnimationFrame(() => {
        syncProjectedPositions();
        drawParticlesFrame();
      });
      return () => cancelAnimationFrame(rafId);
    }, [
      cachedArcGeometries,
      ripplePoints,
      showFactoryArcs,
      stage,
      selectedFarm,
      isHubSelected,
      activeCategories,
      syncProjectedPositions,
      drawParticlesFrame,
    ]);

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

        {/* Lớp vòng tỏa CSS (ripple/pulse) cho TẤT CẢ điểm trên bản đồ: Trại gà/heo & nhóm Khác */}
        {stage === 'map' && (
          <FarmRipplesOverlay
            ripplePoints={ripplePoints}
            normalizedQuery={normalizedQuery}
            matchedFarmIds={matchedFarmIds}
            isHubSelected={isHubSelected}
            centralHubId={centralHub?.id}
            farmRippleRefs={farmRippleRefs}
            rippleLayerRef={rippleLayerRef}
            onSyncAfterRender={handleRippleOverlayAfterRender}
          />
        )}

        {/* Lớp Canvas các chấm sáng chuyển động một chiều từ FEED FACTORY ➔ Trại (không vẽ đường nét tĩnh) */}
        {stage === 'map' && showFactoryArcs && (
          <canvas
            ref={particlesCanvasRef}
            className="pointer-events-none fixed inset-0 z-10"
            aria-hidden="true"
          />
        )}

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
