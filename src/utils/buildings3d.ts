import { APP_CONFIG } from '../config';
import { Farm } from '../types';

/**
 * BỘ SINH KHỐI TRANG TRẠI 3D (FILL-EXTRUSION) BẰNG CODE
 * Mỗi điểm trang trại tự tạo:
 * - 3 đến 4 dãy chuồng dài song song (cao 6 - 10 m)
 * - 1 đến 2 bồn/silo cám hình trụ đa giác (cao 11 - 13.5 m)
 * - 1 nhà điều hành nhỏ ở đầu khu trại (cao 5.5 m)
 * - Hướng xoay cố định tính từ hàm băm (hash) của ID trang trại
 * - Tất cả gộp chung vào MỘT GeoJSON FeatureCollection duy nhất để tối ưu GPU
 */

function hashIdToNumber(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * Chuyển đổi toạ độ cục bộ (mét: dx Đông-Tây, dy Bắc-Nam) sau khi xoay góc `angleRad`
 * sang kinh độ / vĩ độ thực tế quanh tâm (centerLng, centerLat)
 */
function offsetMetersToLngLat(
  centerLng: number,
  centerLat: number,
  dxMeters: number,
  dyMeters: number,
  cosA: number,
  sinA: number
): [number, number] {
  const rx = dxMeters * cosA - dyMeters * sinA;
  const ry = dxMeters * sinA + dyMeters * cosA;

  const metersPerDegLat = 110574;
  const metersPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

  return [
    centerLng + rx / metersPerDegLng,
    centerLat + ry / metersPerDegLat,
  ];
}

/**
 * Tạo đa giác hình chữ nhật xoay theo hướng trang trại (đơn vị mét)
 */
function createRotatedRect(
  centerLng: number,
  centerLat: number,
  cx: number,
  cy: number,
  widthM: number,
  lengthM: number,
  cosA: number,
  sinA: number
): [number, number][] {
  const hw = widthM / 2;
  const hl = lengthM / 2;
  const corners: [number, number][] = [
    [cx - hw, cy - hl],
    [cx + hw, cy - hl],
    [cx + hw, cy + hl],
    [cx - hw, cy + hl],
  ];
  const ring = corners.map(([x, y]) =>
    offsetMetersToLngLat(centerLng, centerLat, x, y, cosA, sinA)
  );
  ring.push(ring[0]);
  return ring;
}

/**
 * Tạo đa giác hình trụ tròn (bồn/silo chứa cám)
 */
function createCylinderPolygon(
  centerLng: number,
  centerLat: number,
  cx: number,
  cy: number,
  radiusM: number,
  cosA: number,
  sinA: number,
  sides = 14
): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    const x = cx + radiusM * Math.cos(theta);
    const y = cy + radiusM * Math.sin(theta);
    ring.push(offsetMetersToLngLat(centerLng, centerLat, x, y, cosA, sinA));
  }
  ring.push(ring[0]);
  return ring;
}

export interface BuildingFeatureProperties {
  farmId: string;
  partType: 'shed-wall' | 'shed-roof' | 'silo' | 'office' | 'night-window';
  color: string;
  targetHeight: number;
  baseHeight: number;
}

/**
 * Xây dựng MỘT GeoJSON FeatureCollection chứa toàn bộ khối công trình 3D của các trang trại
 */
export function buildAllFarms3DGeoJSON(
  farms: Farm[],
  isNightMode: boolean
) {
  const features: Array<{
    type: 'Feature';
    properties: BuildingFeatureProperties;
    geometry: {
      type: 'Polygon';
      coordinates: [number, number][][];
    };
  }> = [];

  for (const farm of farms) {
    const h = hashIdToNumber(farm.id);
    // Góc xoay cố định theo ID điểm (0 -> 2*PI)
    const angleRad = ((h % 360) * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    // Màu mái theo loại trang trại: gà = cam #fb923c, heo = san hô #fb7185, khác = xanh ngọc #14b8a6
    const roofColor =
      APP_CONFIG.colors.categories[farm.category]?.hex || '#14b8a6';
    const wallColor = isNightMode ? '#fcd34d' : '#f1f5f9';
    const siloColor = isNightMode ? '#fde68a' : '#e2e8f0';
    const officeColor = isNightMode ? '#fbbf24' : '#38bdf8';

    // Số dãy chuồng: 3 hoặc 4 dãy song song
    const shedCount = 3 + (h % 2); // 3 hoặc 4
    const shedWidth = 14; // rộng 14m
    const shedLength = 64 + (h % 18); // dài 64 - 82m
    const shedSpacing = 22; // khoảng cách tâm giữa các dãy chuồng
    const shedTotalHeight = 6.5 + (h % 4); // cao 6.5 - 9.5m
    const wallHeight = shedTotalHeight * 0.72;

    const startX = -((shedCount - 1) * shedSpacing) / 2;

    for (let i = 0; i < shedCount; i++) {
      const cx = startX + i * shedSpacing;
      const cy = 0;

      // Phần thân tường chuồng (hoặc ánh đèn vàng ấm khi ở chế độ Đêm)
      const bodyPoly = createRotatedRect(
        farm.lng,
        farm.lat,
        cx,
        cy,
        shedWidth,
        shedLength,
        cosA,
        sinA
      );
      features.push({
        type: 'Feature',
        properties: {
          farmId: farm.id,
          partType: 'shed-wall',
          color: wallColor,
          baseHeight: 0,
          targetHeight: wallHeight,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [bodyPoly],
        },
      });

      // Phần mái chuồng màu đặc trưng theo loại trang trại
      const roofPoly = createRotatedRect(
        farm.lng,
        farm.lat,
        cx,
        cy,
        shedWidth + 1.8,
        shedLength + 1.8,
        cosA,
        sinA
      );
      features.push({
        type: 'Feature',
        properties: {
          farmId: farm.id,
          partType: 'shed-roof',
          color: roofColor,
          baseHeight: wallHeight,
          targetHeight: shedTotalHeight,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [roofPoly],
        },
      });
    }

    // 1 - 2 Bồn / Silo cám hình trụ ở đầu các dãy chuồng
    const siloCount = 1 + ((h >> 3) % 2); // 1 hoặc 2 silo
    for (let s = 0; s < siloCount; s++) {
      const siloX = startX - 16;
      const siloY = -16 + s * 18;
      const siloHeight = 11.5 + s * 1.5;
      const siloPoly = createCylinderPolygon(
        farm.lng,
        farm.lat,
        siloX,
        siloY,
        4.2,
        cosA,
        sinA
      );

      features.push({
        type: 'Feature',
        properties: {
          farmId: farm.id,
          partType: 'silo',
          color: siloColor,
          baseHeight: 0,
          targetHeight: siloHeight,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [siloPoly],
        },
      });
    }

    // 1 Nhà điều hành nhỏ ở phía trước cụm chuồng
    const officeX = 0;
    const officeY = shedLength / 2 + 16;
    const officePoly = createRotatedRect(
      farm.lng,
      farm.lat,
      officeX,
      officeY,
      20,
      12,
      cosA,
      sinA
    );
    features.push({
      type: 'Feature',
      properties: {
        farmId: farm.id,
        partType: 'office',
        color: officeColor,
        baseHeight: 0,
        targetHeight: 5.8,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [officePoly],
      },
    });
  }

  return {
    type: 'FeatureCollection' as const,
    features,
  };
}
