import { CentralHub, Farm } from '../types';

/**
 * Tính khoảng cách đường chim bay (Haversine) giữa 2 toạ độ (đơn vị: km)
 */
export function calculateDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Bán kính Trái Đất (km)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Tạo đa giác GeoJSON hình tròn chính xác theo đơn vị mét quanh toạ độ (lng, lat)
 */
export function createGeoJSONCircle(
  centerLng: number,
  centerLat: number,
  radiusMeters: number,
  points = 64
): [number, number][] {
  const coords: [number, number][] = [];
  const distanceX =
    radiusMeters / (111320 * Math.cos((centerLat * Math.PI) / 180));
  const distanceY = radiusMeters / 110574;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    coords.push([centerLng + x, centerLat + y]);
  }
  coords.push(coords[0]);
  return coords;
}

/**
 * Tạo FeatureCollection GeoJSON cho vòng bán kính an toàn sinh học:
 * - Vòng biên chuẩn (outer): viền xanh lá #10b981, nền trong suốt
 * - Vòng gợn sóng lan toả chậm (ripple): bán kính biến thiên theo `rippleProgress` (0 -> 1)
 */
export function buildBiosecurityGeoJSON(
  farms: Farm[],
  radiusMeters: number,
  rippleProgress = 0.5
) {
  const rippleScale = 0.2 + rippleProgress * 0.8;
  return {
    type: 'FeatureCollection' as const,
    features: farms.flatMap((farm) => {
      const outerRing = createGeoJSONCircle(farm.lng, farm.lat, radiusMeters, 60);
      const rippleRing = createGeoJSONCircle(
        farm.lng,
        farm.lat,
        radiusMeters * rippleScale,
        48
      );

      return [
        {
          type: 'Feature' as const,
          properties: {
            id: farm.id,
            name: farm.name,
            color: '#10b981',
            ringType: 'outer',
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [outerRing],
          },
        },
        {
          type: 'Feature' as const,
          properties: {
            id: `${farm.id}-ripple`,
            name: farm.name,
            color: '#10b981',
            ringType: 'ripple',
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [rippleRing],
          },
        },
      ];
    }),
  };
}

/**
 * Tính tâm và mức zoom phù hợp để bao quát toàn bộ hệ thống trang trại + Nhà Máy Cám
 */
export function getSystemCenterAndZoom(
  farms: Farm[],
  hub?: CentralHub | null
): { center: [number, number]; zoom: number } {
  if (!farms.length) {
    if (hub) {
      return { center: [hub.lng, hub.lat], zoom: 10 };
    }
    return { center: [106.8, 14.5], zoom: 6 };
  }

  let minLat = hub ? hub.lat : farms[0].lat;
  let maxLat = hub ? hub.lat : farms[0].lat;
  let minLng = hub ? hub.lng : farms[0].lng;
  let maxLng = hub ? hub.lng : farms[0].lng;

  for (const f of farms) {
    if (f.lat < minLat) minLat = f.lat;
    if (f.lat > maxLat) maxLat = f.lat;
    if (f.lng < minLng) minLng = f.lng;
    if (f.lng > maxLng) maxLng = f.lng;
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const maxSpan = Math.max(maxLat - minLat, maxLng - minLng);

  let zoom = 9.5;
  if (maxSpan > 10) zoom = 5.5;
  else if (maxSpan > 5) zoom = 6.5;
  else if (maxSpan > 2.5) zoom = 7.8;
  else if (maxSpan > 1.2) zoom = 8.9;
  else if (maxSpan > 0.5) zoom = 9.6;
  else zoom = 11.4;

  return {
    center: [centerLng, centerLat],
    zoom,
  };
}
