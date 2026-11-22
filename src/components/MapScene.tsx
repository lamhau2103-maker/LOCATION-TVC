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
  TimeOfDay,
} from '../types';
import { buildAllFarms3DGeoJSON } from '../utils/buildings3d';
import { buildBiosecurityGeoJSON, getSystemCenterAndZoom } from '../utils/geo';
import { registerMapLibreFarmIcons } from '../utils/icons';
import {
  AtmosphericCloudsOverlay,
  getMarkerIconSvgHtml,
} from './CursorSpotlight';

export interface MapSceneHandle {
  flyToFarm: (farm: Farm, zoom?: number) => void;
  flyToOverview: (duration?: number, pitch?: number) => void;
  flyToHub: () => void;
  flyToGlobe: () => void;
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
  onSelectFarm: (farm: Farm) => void;
  onEnterMapOverview: () => void;
  activeCategories: Record<FarmCategory, boolean>;
  searchQuery: string;
  biosecurityRadius: number;
  isTourRunning: boolean;
  mapStyleMode: MapStyleMode;
  timeOfDay: TimeOfDay;
  liteMode: boolean;
}

const OPENFREEMAP_LIBERTY_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';
const ESRI_SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TERRARIUM_DEM_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const MAX_DOM_MARKERS = 200;
const MAX_GLOBE_ICON_MARKERS = 150;

function createSatelliteBaseStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: 'ThaiViet Satellite 3D',
    sources: {
      'esri-world-imagery': {
        type: 'raster',
        tiles: [ESRI_SATELLITE_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      },
    },
    layers: [
      {
        id: 'ocean-background',
        type: 'background',
        paint: {
          'background-color': '#0d9488',
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

    const stars = Array.from({ length: 160 }).map(() => ({
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
      logoUrl,
      farms,
      newlyAddedIds,
      removingFarms,
      bouncingFarmId,
      centralHub,
      selectedFarm,
      onSelectFarm,
      onEnterMapOverview,
      activeCategories,
      searchQuery,
      biosecurityRadius,
      isTourRunning,
      mapStyleMode,
      timeOfDay,
      liteMode,
    },
    ref
  ) => {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const deckOverlayRef = useRef<MapboxOverlay | null>(null);
    const isMapLoadedRef = useRef(false);

    // Tự động xoay địa cầu & tạm dừng 3 giây khi người dùng kéo/vuốt
    const isGlobeDraggingRef = useRef(false);
    const resumeRotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

    const [currentZoom, setCurrentZoom] = useState(2.35);
    const buildingGrowScaleRef = useRef(1);
    const buildingAnimTriggeredRef = useRef(false);

    const markersMapRef = useRef<
      Map<
        string,
        {
          marker: maplibregl.Marker;
          element: HTMLDivElement;
          category: FarmCategory;
        }
      >
    >(new Map());
    const hubMarkerRef = useRef<maplibregl.Marker | null>(null);

    const latestStateRef = useRef({
      visibleFarms: [] as Farm[],
      biosecurityRadius,
      timeOfDay,
      liteMode,
      onSelectFarm,
    });

    const visibleFarms = useMemo(
      () => farms.filter((f) => activeCategories[f.category]),
      [farms, activeCategories]
    );

    latestStateRef.current = {
      visibleFarms,
      biosecurityRadius,
      timeOfDay,
      liteMode,
      onSelectFarm,
    };

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

    // Điều khiển camera điện ảnh
    useImperativeHandle(ref, () => ({
      flyToFarm: (farm: Farm, zoom = 15.8) => {
        const map = mapRef.current;
        if (!map) return;
        isGlobeDraggingRef.current = true;
        map.flyTo({
          center: [farm.lng, farm.lat],
          zoom,
          pitch: 65,
          bearing: -22 + ((farm.lat * 100) % 44),
          duration: 3000,
          essential: true,
        });
      },
      flyToOverview: (duration = 5200, pitch = 65) => {
        const map = mapRef.current;
        if (!map) return;
        isGlobeDraggingRef.current = true;
        const { center, zoom } = getSystemCenterAndZoom(
          visibleFarms.length > 0 ? visibleFarms : farms,
          centralHub
        );
        map.flyTo({
          center,
          zoom,
          pitch,
          bearing: 22,
          duration,
          essential: true,
        });
      },
      flyToHub: () => {
        const map = mapRef.current;
        if (!map) return;
        isGlobeDraggingRef.current = true;
        map.flyTo({
          center: [centralHub.lng, centralHub.lat],
          zoom: 14.2,
          pitch: 64,
          bearing: 12,
          duration: 2800,
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
          center: [centralHub.lng, centralHub.lat],
          zoom: 2.35,
          pitch: 15,
          bearing: 0,
          duration: 3200,
          essential: true,
        });
        resumeRotateTimerRef.current = setTimeout(() => {
          isGlobeDraggingRef.current = false;
        }, 3300);
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

    const setupCustomLayers = useCallback(
      (map: maplibregl.Map) => {
        const {
          visibleFarms: curFarms,
          biosecurityRadius: curRadius,
          timeOfDay: curTime,
          liteMode: curLite,
        } = latestStateRef.current;

        try {
          map.setProjection({ type: 'globe' });
        } catch {
          // Fallback
        }

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

          map.setTerrain({
            source: 'terrarium-dem',
            exaggeration: curLite ? 0.55 : 1.4,
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

        // Đăng ký bộ ảnh icon Gà / Heo / Nhà trại cho MapLibre symbol layer (map.addImage)
        // Khi zoom gần (>= 14.3), symbol layer hiển thị icon nằm phía trên cụm chuồng 3D
        void registerMapLibreFarmIcons(map);

        if (!map.getSource('farms-symbol-source')) {
          map.addSource('farms-symbol-source', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: curFarms.map((f) => ({
                type: 'Feature',
                properties: {
                  id: f.id,
                  name: f.name,
                  category: f.category,
                  iconImage: `farm-icon-${f.category}`,
                },
                geometry: {
                  type: 'Point',
                  coordinates: [f.lng, f.lat],
                },
              })),
            },
          });
        }

        if (!map.getLayer('farms-symbol-layer')) {
          map.addLayer({
            id: 'farms-symbol-layer',
            type: 'symbol',
            source: 'farms-symbol-source',
            minzoom: 14.2,
            layout: {
              'icon-image': ['get', 'iconImage'],
              'icon-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                14.2,
                0.78,
                16.5,
                1.08,
              ],
              'icon-anchor': 'bottom',
              'icon-offset': [0, -18],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
            paint: {
              'icon-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                14.2,
                0,
                14.6,
                1,
              ],
            },
          });
        }

        if (!map.getSource('farms-gpu-points')) {
          map.addSource('farms-gpu-points', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [],
            },
          });
        }

        if (!map.getLayer('farms-gpu-circle')) {
          map.addLayer({
            id: 'farms-gpu-circle',
            type: 'circle',
            source: 'farms-gpu-points',
            paint: {
              'circle-radius': 6.5,
              'circle-color': ['get', 'color'],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            },
          });
        }
      },
      [applySkyAndLight, getFarmsFor3DBuildings]
    );

    // Khởi tạo MapLibre GL + Deck.gl MapboxOverlay
    useEffect(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      const initialStyle =
        mapStyleMode === 'satellite'
          ? createSatelliteBaseStyle()
          : OPENFREEMAP_LIBERTY_STYLE;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: initialStyle,
        center: [centralHub.lng - 10, centralHub.lat + 1.5],
        zoom: 2.35,
        pitch: 15,
        bearing: 0,
        maxPitch: 78,
        pixelRatio: liteMode
          ? 1
          : Math.min(window.devicePixelRatio || 1, 2),
        attributionControl: false,
      });

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

      // Khi người dùng kéo chuột hoặc vuốt địa cầu: tạm dừng tự xoay, khi buông ra 3 giây thì tiếp tục tự xoay
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

      map.on('click', 'farms-3d-extrusion', (e) => {
        const feat = e.features?.[0];
        const farmId = feat?.properties?.farmId;
        if (farmId) {
          const matched = latestStateRef.current.visibleFarms.find(
            (f) => f.id === farmId
          );
          if (matched) {
            latestStateRef.current.onSelectFarm(matched);
          }
        }
      });

      map.on('click', 'farms-symbol-layer', (e) => {
        const feat = e.features?.[0];
        const farmId = feat?.properties?.id;
        if (farmId) {
          const matched = latestStateRef.current.visibleFarms.find(
            (f) => f.id === farmId
          );
          if (matched) {
            latestStateRef.current.onSelectFarm(matched);
          }
        }
      });

      map.on('click', 'farms-gpu-circle', (e) => {
        const feat = e.features?.[0];
        const farmId = feat?.properties?.id;
        if (farmId) {
          const matched = latestStateRef.current.visibleFarms.find(
            (f) => f.id === farmId
          );
          if (matched) {
            latestStateRef.current.onSelectFarm(matched);
          }
        }
      });

      map.on('mouseenter', 'farms-3d-extrusion', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'farms-3d-extrusion', () => {
        map.getCanvas().style.cursor = '';
      });
      map.on('mouseenter', 'farms-symbol-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'farms-symbol-layer', () => {
        map.getCanvas().style.cursor = '';
      });

      map.on('zoom', () => {
        const z = map.getZoom();
        setCurrentZoom(z);

        const shouldFadeMarkers = z >= 14.3;
        markersMapRef.current.forEach(({ element }) => {
          if (shouldFadeMarkers) {
            element.classList.add('is-3d-fade');
          } else {
            element.classList.remove('is-3d-fade');
          }
        });

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

      return () => {
        if (resumeRotateTimerRef.current) {
          clearTimeout(resumeRotateTimerRef.current);
        }
        markersMapRef.current.forEach(({ marker }) => marker.remove());
        markersMapRef.current.clear();
        hubMarkerRef.current?.remove();
        map.remove();
        mapRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Xoay tự động Quả Địa Cầu 3D liên tục (tốc độ ~0.6), tự động tiếp tục sau 3 giây khi người dùng buông chuột
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
          !isGlobeDraggingRef.current
        ) {
          const center = map.getCenter();
          map.setCenter([center.lng + 0.085, center.lat]);
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

      const savedCenter = map.getCenter();
      const savedZoom = map.getZoom();
      const savedPitch = map.getPitch();
      const savedBearing = map.getBearing();

      const nextStyle =
        mapStyleMode === 'satellite'
          ? createSatelliteBaseStyle()
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
          map.setPixelRatio(
            liteMode ? 1 : Math.min(window.devicePixelRatio || 1, 2)
          );
        }
        if (map.getSource('terrarium-dem')) {
          map.setTerrain({
            source: 'terrarium-dem',
            exaggeration: liteMode ? 0.55 : 1.4,
          });
        }
      } catch {
        // ignore
      }
    }, [liteMode]);

    // Cập nhật khối chuồng 3D (mái lấy màu theo icon: gà cam #fb923c, heo san hô #fb7185),
    // symbol layer icon-image và điểm sáng đơn giản trên địa cầu khi > 150 điểm
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
        symbolSource.setData({
          type: 'FeatureCollection',
          features: visibleFarms.map((f) => ({
            type: 'Feature',
            properties: {
              id: f.id,
              name: f.name,
              category: f.category,
              iconImage: `farm-icon-${f.category}`,
            },
            geometry: {
              type: 'Point',
              coordinates: [f.lng, f.lat],
            },
          })),
        });
      }

      const gpuSource = map.getSource(
        'farms-gpu-points'
      ) as maplibregl.GeoJSONSource | undefined;
      if (gpuSource) {
        // Trên địa cầu: khi có hơn 150 điểm thì quay về điểm sáng đơn giản để đảm bảo mượt
        const isGlobeSimpleDots =
          stage === 'globe' && visibleFarms.length > MAX_GLOBE_ICON_MARKERS;
        const overflowFarms = isGlobeSimpleDots
          ? visibleFarms
          : visibleFarms.length > MAX_DOM_MARKERS
          ? visibleFarms.slice(MAX_DOM_MARKERS)
          : [];
        gpuSource.setData({
          type: 'FeatureCollection',
          features: overflowFarms.map((f) => ({
            type: 'Feature',
            properties: {
              id: f.id,
              name: f.name,
              color: getCategoryConfig(f.category).hex,
            },
            geometry: {
              type: 'Point',
              coordinates: [f.lng, f.lat],
            },
          })),
        });
      }
    }, [
      visibleFarms,
      biosecurityRadius,
      timeOfDay,
      liteMode,
      stage,
      getFarmsFor3DBuildings,
    ]);

    // Hiệu ứng gợn sóng lan toả chậm cho vòng bán kính an toàn sinh học
    useEffect(() => {
      if (liteMode || stage !== 'map') return;

      let ripplePhase = 0;
      const interval = setInterval(() => {
        const map = mapRef.current;
        if (!map || !isMapLoadedRef.current) return;

        ripplePhase = (ripplePhase + 0.04) % 1;
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
      }, 95);

      return () => clearInterval(interval);
    }, [visibleFarms, biosecurityRadius, liteMode, stage]);

    // Marker Nhà Máy Trung Tâm Thái Việt (Biểu tượng Hoa Sen nhỏ + Vòng sóng lan toả)
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      hubMarkerRef.current?.remove();

      const el = document.createElement('div');
      el.className = 'hub-pin-marker group';
      el.title = `${centralHub.name} (Nhà máy trung tâm)`;
      el.innerHTML = `
        <div class="hub-sonar-ring"></div>
        <div class="hub-sonar-ring hub-sonar-ring-delay"></div>
        <div class="farm-pin-shadow" style="width: 26px; height: 7px;"></div>
        <div class="farm-pin-body" style="--pulse-duration: 2.8s;">
          <div class="farm-pin-head" style="--marker-color: #2b8fd0; width: 44px; height: 44px; padding: 4px; overflow: hidden;">
            <div style="width: 100%; height: 100%; overflow: hidden; border-radius: 9999px;">
              <img src="${logoUrl}" alt="Lotus" style="width: 100%; height: 132%; object-fit: cover; object-position: top; display: block;" />
            </div>
          </div>
          <div class="farm-pin-tip" style="--marker-color: #2b8fd0;"></div>
        </div>
        <div class="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/95 bg-white/92 px-3 py-0.5 text-[10px] font-extrabold tracking-wide text-[#0f2a24] shadow-md backdrop-blur-md">
          ${centralHub.name}
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onEnterMapOverview();
        map.flyTo({
          center: [centralHub.lng, centralHub.lat],
          zoom: 14.2,
          pitch: 64,
          bearing: 12,
          duration: 2600,
          essential: true,
        });
      });

      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'bottom',
      })
        .setLngLat([centralHub.lng, centralHub.lat])
        .addTo(map);

      hubMarkerRef.current = marker;
    }, [centralHub, logoUrl, onEnterMapOverview]);

    // Tạo và đồng bộ các Marker Icon (Gà / Heo / Nhà trại) có vòng sóng sonar theo màu icon
    // Khi trên địa cầu (stage === 'globe') và có > 150 điểm thì ẩn DOM marker để quay về điểm sáng đơn giản
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      const isGlobeSimpleDots =
        stage === 'globe' && visibleFarms.length > MAX_GLOBE_ICON_MARKERS;
      const domFarms = isGlobeSimpleDots
        ? []
        : visibleFarms.slice(0, MAX_DOM_MARKERS);
      const activeIds = new Set(domFarms.map((f) => f.id));

      markersMapRef.current.forEach((entry, id) => {
        if (!activeIds.has(id)) {
          entry.marker.remove();
          markersMapRef.current.delete(id);
        }
      });

      const shouldFadeMarkers = map.getZoom() >= 14.3;

      domFarms.forEach((farm) => {
        const catCfg = getCategoryConfig(farm.category);
        const statusCfg =
          APP_CONFIG.colors.statuses[farm.status] ||
          APP_CONFIG.colors.statuses.active;

        const existing = markersMapRef.current.get(farm.id);
        if (existing) {
          existing.marker.setLngLat([farm.lng, farm.lat]);
          if (existing.category !== farm.category) {
            existing.category = farm.category;
            existing.element.style.setProperty('--marker-color', catCfg.hex);
            const headEl = existing.element.querySelector('.farm-pin-head');
            if (headEl) {
              headEl.innerHTML = getMarkerIconSvgHtml(farm.category, 22);
            }
          }
          if (newlyAddedIds.has(farm.id)) {
            existing.element.classList.add('is-newly-synced');
          }
          return;
        }

        const el = document.createElement('div');
        el.className = `farm-pin-marker group ${
          shouldFadeMarkers ? 'is-3d-fade' : ''
        } ${newlyAddedIds.has(farm.id) ? 'is-newly-synced' : ''}`;
        el.style.setProperty('--marker-color', catCfg.hex);
        el.style.setProperty('--pulse-duration', statusCfg.pulseDuration);
        el.style.setProperty('--sonar-duration', statusCfg.sonarDuration);

        el.innerHTML = `
          <div class="farm-sonar-ring"></div>
          <div class="farm-pin-shadow"></div>
          <div class="farm-pin-body">
            <div class="farm-pin-head">
              ${getMarkerIconSvgHtml(farm.category, 22)}
            </div>
            <div class="farm-pin-tip"></div>
          </div>
          <div class="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/90 bg-white/92 px-2.5 py-0.5 text-[10px] font-bold text-[#0f2a24] opacity-0 transition-opacity duration-150 group-hover:opacity-100 shadow-md">
            ${farm.name}
          </div>
        `;

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          latestStateRef.current.onSelectFarm(farm);
        });

        const marker = new maplibregl.Marker({
          element: el,
          anchor: 'bottom',
        })
          .setLngLat([farm.lng, farm.lat])
          .addTo(map);

        markersMapRef.current.set(farm.id, {
          marker,
          element: el,
          category: farm.category,
        });
      });
    }, [visibleFarms, newlyAddedIds, stage]);

    // Hiệu ứng nảy nhẹ (bounce) khi Quản trị viên vừa đổi icon trang trại
    useEffect(() => {
      if (!bouncingFarmId) return;
      const entry = markersMapRef.current.get(bouncingFarmId);
      if (!entry) return;
      entry.element.classList.remove('is-icon-bouncing');
      void entry.element.offsetWidth;
      entry.element.classList.add('is-icon-bouncing');
      const timer = setTimeout(() => {
        entry.element.classList.remove('is-icon-bouncing');
      }, 900);
      return () => clearTimeout(timer);
    }, [bouncingFarmId]);

    // Hiển thị hiệu ứng mờ dần cho các điểm vừa bị xoá khi đồng bộ
    useEffect(() => {
      const map = mapRef.current;
      if (!map || removingFarms.length === 0) return;

      const tempMarkers: maplibregl.Marker[] = [];
      removingFarms.forEach((farm) => {
        const catCfg = getCategoryConfig(farm.category);
        const el = document.createElement('div');
        el.className = 'farm-pin-marker';
        el.style.setProperty('--marker-color', catCfg.hex);
        el.innerHTML = `
          <div class="farm-pin-shadow"></div>
          <div class="farm-pin-body">
            <div class="farm-pin-head">${getMarkerIconSvgHtml(farm.category)}</div>
            <div class="farm-pin-tip"></div>
          </div>
        `;
        const m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([farm.lng, farm.lat])
          .addTo(map);
        tempMarkers.push(m);

        requestAnimationFrame(() => {
          el.classList.add('is-removing');
        });
      });

      const timer = setTimeout(() => {
        tempMarkers.forEach((m) => m.remove());
      }, 650);

      return () => {
        clearTimeout(timer);
        tempMarkers.forEach((m) => m.remove());
      };
    }, [removingFarms]);

    // Cập nhật trạng thái tìm kiếm / Tour tự động cho DOM markers
    useEffect(() => {
      const hasSearch = normalizedQuery.length > 0;

      markersMapRef.current.forEach(({ element }, id) => {
        element.classList.remove('is-dimmed', 'is-matched', 'is-selected');

        const isSelected = selectedFarm?.id === id;
        if (isSelected) {
          element.classList.add('is-selected');
        }

        if (isTourRunning) {
          if (!isSelected) {
            element.classList.add('is-dimmed');
          }
          return;
        }

        if (hasSearch) {
          if (matchedFarmIds.has(id)) {
            element.classList.add('is-matched');
          } else {
            element.classList.add('is-dimmed');
          }
        }
      });
    }, [normalizedQuery, matchedFarmIds, selectedFarm, isTourRunning]);

    // Đường cung ArcLayer của deck.gl: gradient Vàng #facc15 -> Xanh lá #10b981 + hạt sáng chạy dọc
    useEffect(() => {
      let animId: number;
      let phase = 0;

      const animateDeckLayers = () => {
        phase += liteMode ? 0.015 : 0.025;
        const overlay = deckOverlayRef.current;

        if (overlay) {
          const arcData = visibleFarms.map((farm, idx) => {
            const isHighlighted =
              selectedFarm?.id === farm.id ||
              (normalizedQuery.length > 0 && matchedFarmIds.has(farm.id));
            const isDimmed =
              (isTourRunning && selectedFarm?.id !== farm.id) ||
              (normalizedQuery.length > 0 && !matchedFarmIds.has(farm.id));

            const t = (phase * 0.45 + idx * 0.19) % 1;
            const particleLng =
              centralHub.lng + (farm.lng - centralHub.lng) * t;
            const particleLat =
              centralHub.lat + (farm.lat - centralHub.lat) * t;

            const pulse = (Math.sin(phase * 2.2 - idx * 0.6) + 1) / 2;

            return {
              id: farm.id,
              source: [centralHub.lng, centralHub.lat] as [number, number],
              target: [farm.lng, farm.lat] as [number, number],
              particlePos: [particleLng, particleLat] as [number, number],
              pulse,
              isHighlighted,
              isDimmed,
            };
          });

          const mainArcLayer = new ArcLayer({
            id: 'thaiviet-main-arcs',
            data: arcData,
            getSourcePosition: (d) => d.source,
            getTargetPosition: (d) => d.target,
            getSourceColor: (d): [number, number, number, number] => [
              250,
              204,
              21,
              d.isDimmed ? 35 : d.isHighlighted ? 245 : 190,
            ],
            getTargetColor: (d): [number, number, number, number] => [
              16,
              185,
              129,
              d.isDimmed ? 35 : d.isHighlighted ? 245 : 205,
            ],
            getWidth: (d) => (d.isHighlighted ? 4.2 : 2.5),
            getHeight: 0.46,
            greatCircle: true,
            updateTriggers: {
              getSourceColor: [
                selectedFarm?.id,
                isTourRunning,
                normalizedQuery,
              ],
              getTargetColor: [
                selectedFarm?.id,
                isTourRunning,
                normalizedQuery,
              ],
              getWidth: [selectedFarm?.id, normalizedQuery],
            },
          });

          const pulseArcLayer = new ArcLayer({
            id: 'thaiviet-pulse-arcs',
            data: arcData,
            getSourcePosition: (d) => d.source,
            getTargetPosition: (d) => d.target,
            getSourceColor: (d): [number, number, number, number] => {
              if (d.isDimmed) return [250, 204, 21, 0];
              return [254, 240, 138, Math.round((1 - d.pulse) * 235)];
            },
            getTargetColor: (d): [number, number, number, number] => {
              if (d.isDimmed) return [16, 185, 129, 0];
              return [52, 211, 153, Math.round(d.pulse * 250)];
            },
            getWidth: (d) =>
              d.isDimmed
                ? 0
                : d.isHighlighted
                ? 5.5 + d.pulse * 2
                : 3.2 + d.pulse * 1.6,
            getHeight: 0.46,
            greatCircle: true,
            updateTriggers: {
              getSourceColor: [phase],
              getTargetColor: [phase],
              getWidth: [phase],
            },
          });

          const particleLayer = new ScatterplotLayer({
            id: 'thaiviet-arc-particles',
            data: liteMode ? [] : arcData.filter((d) => !d.isDimmed),
            getPosition: (d) => d.particlePos,
            getFillColor: [250, 204, 21, 235],
            getLineColor: [255, 255, 255, 255],
            getRadius: 550,
            radiusMinPixels: 3,
            radiusMaxPixels: 6,
            stroked: true,
            lineWidthMinPixels: 1.5,
            updateTriggers: {
              getPosition: [phase],
            },
          });

          overlay.setProps({
            layers: [mainArcLayer, pulseArcLayer, particleLayer],
          });
        }

        animId = requestAnimationFrame(animateDeckLayers);
      };

      animId = requestAnimationFrame(animateDeckLayers);
      return () => cancelAnimationFrame(animId);
    }, [
      visibleFarms,
      centralHub,
      selectedFarm,
      isTourRunning,
      normalizedQuery,
      matchedFarmIds,
      liteMode,
    ]);

    const currentPreset = APP_CONFIG.timePresets[timeOfDay];

    return (
      <div className="relative h-screen w-screen overflow-hidden bg-[#041829]">
        {/* Nền vũ trụ xanh đậm có sao mờ và quầng khí quyển xanh ngọc */}
        <SpaceOceanBackdrop visible={stage === 'globe'} liteMode={liteMode} />

        {/* Khung chứa MapLibre GL */}
        <div ref={mapContainerRef} className="relative z-10 h-full w-full" />

        {/* Lớp phủ sắc thái ánh sáng môi trường theo 4 mốc giờ */}
        <div
          className="pointer-events-none fixed inset-0 z-10 transition-colors duration-1000"
          style={{ backgroundColor: currentPreset.ambientTint }}
          aria-hidden="true"
        />

        {/* Lớp Mây trắng mờ SVG trôi chậm phía trên bản đồ, ẩn dần khi zoom sát */}
        <AtmosphericCloudsOverlay zoom={currentZoom} liteMode={liteMode} />

        {/* Nút tròn nhỏ ở góc dưới khi đang ở Địa cầu 3D: "Xem bản đồ chi tiết" */}
        {stage === 'globe' && (
          <div className="pointer-events-auto fixed bottom-6 left-1/2 z-20 -translate-x-1/2">
            <motion.button
              type="button"
              whileHover={{ y: -3, scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={onEnterMapOverview}
              title="Xem bản đồ chi tiết"
              className="glass-panel group flex items-center gap-2.5 rounded-full border-white/95 px-5 py-2.5 text-xs font-extrabold text-[#0f2a24] shadow-[0_14px_32px_rgba(15,42,36,0.22)] transition-colors hover:border-[#2b8fd0] hover:bg-white cursor-pointer"
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
          <div className="pointer-events-none fixed bottom-2 left-3 z-20 max-w-md rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[10px] font-semibold text-[#0f2a24] shadow-sm backdrop-blur-md">
            Nguồn ảnh vệ tinh: Tiles &copy; Esri &mdash; Source: Esri, i-cubed,
            USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP,
            and the GIS User Community
          </div>
        )}
      </div>
    );
  }
);
