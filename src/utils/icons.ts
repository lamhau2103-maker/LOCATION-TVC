import * as maplibregl from 'maplibre-gl';
import { ARC_EXCLUDE_KEYWORDS, ARC_INCLUDE_KEYWORDS } from '../config';
import {
  FarmCategory,
  FarmCustomLabels,
  FarmSubType,
  IconChoice,
} from '../types';

/**
 * MODULE BỘ ICON TRANG TRẠI & PHÂN LOẠI ĐƯỜNG NỐI (src/utils/icons.ts)
 * - Vẽ icon Gà (cam #fb923c, mào đỏ #ef4444), Heo (san hô #fb7185, mũi và tai rõ),
 *   và nhóm Khác (Văn phòng: toà nhà; Kho: kho hàng; Điểm rửa xe: giọt nước/xe; Còn lại: ngôi nhà trại xanh ngọc #14b8a6),
 *   cùng icon Nhà máy Trung tâm (#2b8fd0) bằng SVG tự tạo nét dày.
 * - Tạo khoá ổn định farm_key = "lat.toFixed(5),lng.toFixed(5)" (CHỈ dùng để nhận diện, không dùng để vẽ).
 * - Quy tắc loại trừ trước bằng ARC_EXCLUDE_KEYWORDS cho cả tự động chọn icon và đường nối vệt sáng.
 */

export const FARM_ICON_LIST: Array<{
  id: 'chicken' | 'pig' | 'auto';
  label: string;
  color: string;
  description: string;
}> = [
  {
    id: 'chicken',
    label: 'Gà',
    color: '#fb923c',
    description: 'Trại gà (Mái cam #fb923c)',
  },
  {
    id: 'pig',
    label: 'Heo',
    color: '#fb7185',
    description: 'Trại heo (Mái san hô #fb7185)',
  },
  {
    id: 'auto',
    label: 'Tự động',
    color: '#14b8a6',
    description: 'Tự nhận diện theo tên & nhóm (ưu tiên loại trừ kho/văn phòng/rửa xe)',
  },
];

/**
 * Tạo khoá định danh ổn định cho từng trang trại:
 * vĩ độ và kinh độ làm tròn 5 chữ số thập phân, ghép dạng "lat,lng" (ví dụ "10.96540,107.01280").
 * Lưu ý: CHỈ dùng để nhận diện, tuyệt đối không dùng để vẽ vị trí trên bản đồ/địa cầu.
 */
export function getFarmKey(lat: number, lng: number): string {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

/**
 * Chuẩn hoá chuỗi trước khi so khớp:
 * - Chữ thường
 * - Bỏ dấu tiếng Việt (đ -> d)
 * - Gom khoảng trắng thừa thành 1 khoảng trắng
 */
export function normalizeMatchText(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kiểm tra chuỗi văn bản (tên layer/folder + tên điểm) có dính từ khoá loại trừ trong ARC_EXCLUDE_KEYWORDS không.
 */
export function matchesExcludeKeywords(rawLayerAndName: string): boolean {
  const norm = normalizeMatchText(rawLayerAndName);
  if (!norm) return false;
  const padded = ` ${norm} `;

  return ARC_EXCLUDE_KEYWORDS.some((kw) => {
    const normKw = kw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase();
    if (!normKw.trim()) return false;
    // Nếu từ khoá gốc có khoảng trắng ở cuối (ví dụ "vp "), kiểm tra theo từ/cụm có khoảng trắng
    if (kw.endsWith(' ')) {
      return (
        padded.includes(` ${normKw.trim()} `) ||
        norm.startsWith(`${normKw.trim()} `)
      );
    }
    return norm.includes(normKw.trim());
  });
}

/**
 * Kiểm tra chuỗi văn bản (tên layer/folder + tên điểm) có chứa từ khoá trong ARC_INCLUDE_KEYWORDS không.
 */
export function matchesIncludeKeywords(rawLayerAndName: string): boolean {
  const norm = normalizeMatchText(rawLayerAndName);
  if (!norm) return false;

  return ARC_INCLUDE_KEYWORDS.some((kw) => {
    const normKw = normalizeMatchText(kw);
    return normKw.length > 0 && norm.includes(normKw);
  });
}

export const FACTORY_CONFIG = {
  nameKeywords: [
    'feed factory',
    'feedfactory',
    'feed mill',
    'feedmill',
    'nhà máy cám',
    'nha may cam',
    'nhà máy thức ăn',
    'nha may thuc an',
    'nhà máy',
    'nha may',
  ],
  displayNameVi: 'Nhà Máy Cám',
  displayNameEn: 'FEED FACTORY',
  coordsOverride: null as [number, number] | null,
};

/**
 * Tìm điểm "Nhà Máy Cám" thực tế trong dữ liệu Google My Maps đã nạp.
 * Chuẩn hoá chuỗi, bỏ dấu, không phân biệt hoa thường, so khớp trên tên, loại/thư mục và mô tả.
 */
export function findFeedMill<
  T extends { id?: string; name?: string; type?: string; description?: string; lat: number; lng: number }
>(locations: T[]): T | null {
  if (!locations || locations.length === 0) return null;

  if (FACTORY_CONFIG.coordsOverride) {
    const [targetLat, targetLng] = FACTORY_CONFIG.coordsOverride;
    const found = locations.find(
      (loc) =>
        Math.abs(Number(loc.lat) - targetLat) < 0.0001 &&
        Math.abs(Number(loc.lng) - targetLng) < 0.0001
    );
    if (found) return found;
  }

  for (const kw of FACTORY_CONFIG.nameKeywords) {
    const normKw = normalizeMatchText(kw);
    if (!normKw) continue;

    const matched = locations.find((loc) => {
      const combined = normalizeMatchText(
        `${loc.name || ''} ${loc.type || ''} ${loc.description || ''}`
      );
      return combined.includes(normKw);
    });
    if (matched) return matched;
  }

  const fallback = locations.find((loc) => {
    const norm = normalizeMatchText(`${loc.name || ''} ${loc.type || ''}`);
    return norm.includes('may') || norm.includes('feed') || norm.includes('cam');
  });
  return fallback || null;
}

export function isFeedMillText(rawType = '', rawName = ''): boolean {
  const norm = normalizeMatchText(`${rawType} ${rawName}`);
  return (
    norm.includes('nha may cam') ||
    norm.includes('nha may') ||
    norm.includes('feed mill') ||
    norm.includes('feedmill')
  );
}

export function isDisinfectionPointText(rawType = '', rawName = ''): boolean {
  const norm = normalizeMatchText(`${rawType} ${rawName}`);
  if (!norm) return false;
  return (
    norm.includes('diem rua') ||
    norm.includes('rua xe') ||
    norm.includes('tram rua') ||
    norm.includes('sat khuan') ||
    norm.includes('sat trung') ||
    norm.includes('khu trung')
  );
}

/**
 * Phân loại chi tiết cho nhóm "Khác" (nhà máy cám / văn phòng / kho / điểm rửa xe / nhà trại khác)
 */
export function detectOtherSubType(
  rawType = '',
  rawName = ''
): Exclude<FarmSubType, 'chicken' | 'pig'> {
  const normName = normalizeMatchText(rawName);
  const norm = normalizeMatchText(`${rawType} ${rawName}`);
  const padded = ` ${norm} `;

  // Ưu tiên nhận diện Điểm Rửa / Điểm rửa xe theo tên địa điểm trước
  if (isDisinfectionPointText('', normName) || isDisinfectionPointText(rawType, rawName)) {
    return 'wash';
  }

  // Nhận diện Nhà Máy Cám để không bị nhầm thành Văn phòng
  if (
    norm.includes('nha may cam') ||
    norm.includes('nha may') ||
    norm.includes('feed mill') ||
    norm.includes('feedmill') ||
    norm.includes('factory')
  ) {
    return 'hub';
  }

  if (norm.includes('kho') || norm.includes('warehouse')) {
    return 'warehouse';
  }

  if (
    norm.includes('tru so') ||
    norm.includes('van phong') ||
    padded.includes(' vp ') ||
    norm.startsWith('vp ') ||
    norm.includes('office') ||
    norm.includes('bao ve') ||
    norm.includes('cong ty') ||
    norm.includes('chi nhanh')
  ) {
    return 'office';
  }

  return 'other';
}

/**
 * Tự động tạo nhãn mô tả chuẩn xác cho từng điểm (khi Admin chưa đặt nhãn tùy chỉnh):
 * - "Nhà Máy Cám" -> "Nhà máy cám"
 * - "Trụ sở..." / "Thái Việt Corporation" -> "Trụ sở chính"
 * - "Kho..." -> "Kho trung tâm"
 * - "Điểm rửa xe..." -> "Điểm rửa xe"
 * - Trại heo -> "Trại heo", Trại gà -> "Trại gà", Văn phòng -> "Văn phòng"
 */
export function getDefaultLocationLabel(farm: {
  name?: string;
  type?: string;
  category?: FarmCategory;
  subType?: FarmSubType;
  isFeedMill?: boolean;
}): string {
  const normName = normalizeMatchText(farm.name || '');
  const normAll = normalizeMatchText(`${farm.type || ''} ${farm.name || ''}`);

  if (
    farm.subType === 'wash' ||
    isDisinfectionPointText(farm.type || '', farm.name || '')
  ) {
    return 'Điểm rửa xe';
  }

  if (farm.isFeedMill || farm.subType === 'hub' || isFeedMillText(farm.type, farm.name)) {
    return 'Nhà máy cám';
  }

  if (
    farm.subType === 'warehouse' ||
    normAll.includes('kho ') ||
    normName.startsWith('kho') ||
    normAll.includes('warehouse')
  ) {
    return 'Kho trung tâm';
  }

  if (
    normAll.includes('tru so') ||
    normName.includes('thai viet corporation') ||
    (normName.includes('cong ty') && !normName.includes('van phong'))
  ) {
    return 'Trụ sở chính';
  }

  if (farm.category === 'pig') {
    return 'Trại heo';
  }

  if (farm.category === 'chicken') {
    return 'Trại gà';
  }

  if (
    farm.subType === 'office' ||
    normAll.includes('van phong') ||
    ` ${normAll} `.includes(' vp ') ||
    normName.startsWith('vp ') ||
    normAll.includes('office')
  ) {
    return 'Văn phòng';
  }

  return 'Khác';
}

/**
 * Lấy nhãn mô tả hiển thị của địa điểm:
 * Ưu tiên nhãn tùy chỉnh của Admin (lưu trong Upstash Redis) nếu có;
 * nếu chưa sửa thì trả về nhãn tự động thông minh.
 */
export function getLocationDisplayLabel(
  farm: {
    lat: number;
    lng: number;
    farmKey?: string;
    name?: string;
    type?: string;
    category?: FarmCategory;
    subType?: FarmSubType;
    isFeedMill?: boolean;
    customLabel?: string;
  },
  customLabels?: FarmCustomLabels
): string {
  const key = farm.farmKey || getFarmKey(farm.lat, farm.lng);
  const override = customLabels?.[key]?.trim() || farm.customLabel?.trim();
  if (override) return override;
  return getDefaultLocationLabel(farm);
}

/**
 * Kiểm tra một điểm có được nối đường cung vệt sáng từ NHÀ MÁY CÁM hay không:
 * 1. Không bao giờ tự nối tới chính Nhà Máy Cám.
 * 2. Chuẩn hoá chuỗi: chữ thường, bỏ dấu tiếng Việt (đ -> d), gom khoảng trắng.
 * 3. Văn bản xét = tên layer/folder (farm.type) + tên điểm (farm.name).
 * 4. LOẠI TRỪ TRƯỚC: chứa bất kỳ từ khoá nào trong ARC_EXCLUDE_KEYWORDS thì KHÔNG nối
 *    (kể cả "Kho heo", "Văn phòng", "Điểm rửa xe", "Nhà máy"...).
 * 5. Nếu quản trị viên đã chọn thủ công icon gà/heo thì coi là nối được (trừ khi đã dính từ khoá loại trừ).
 * 6. Nếu không bị loại: chỉ nối khi layer/folder hoặc tên điểm chứa từ khoá trong ARC_INCLUDE_KEYWORDS.
 */
export function isConnectableFarm(
  farm: {
    lat: number;
    lng: number;
    type?: string;
    name?: string;
    manualIcon?: IconChoice;
    subType?: FarmSubType;
    isFeedMill?: boolean;
  },
  manualOverrides?: Record<string, 'chicken' | 'pig'>
): boolean {
  if (farm.isFeedMill || farm.subType === 'hub') {
    return false;
  }

  const layerAndName = `${farm.type || ''} ${farm.name || ''}`;

  // Loại trừ trước (kể cả Nhà Máy Cám, Kho heo, Văn phòng, Điểm rửa xe)
  if (matchesExcludeKeywords(layerAndName)) {
    return false;
  }

  // Quản trị viên chọn thủ công Gà / Heo (và không dính từ khoá loại trừ)
  const key = getFarmKey(farm.lat, farm.lng);
  const manual =
    farm.manualIcon && farm.manualIcon !== 'auto'
      ? farm.manualIcon
      : manualOverrides?.[key];
  if (manual === 'chicken' || manual === 'pig') {
    return true;
  }

  // Khớp từ khoá trong ARC_INCLUDE_KEYWORDS
  return matchesIncludeKeywords(layerAndName);
}

/**
 * QUY TẮC XÁC ĐỊNH ICON (ưu tiên từ trên xuống):
 * 1. Lựa chọn thủ công đã lưu trên server ("chicken" hoặc "pig")
 * 2. Nếu chưa có hoặc là "Tự động":
 *    - Kiểm tra danh sách loại trừ ARC_EXCLUDE_KEYWORDS trước trên (tên layer/folder + tên điểm):
 *      Nếu dính từ khoá loại trừ (ví dụ "Kho heo", "Văn phòng", "Điểm rửa xe") -> trả về 'other'
 *      (KHÔNG gán icon heo/gà).
 *    - Nếu không bị loại trừ: tìm từ khoá Gà / Heo trong tên layer/folder, tên điểm, mô tả.
 * 3. Không nhận ra -> icon nhóm 'other' (tông xanh ngọc #14b8a6).
 */
export function resolveFarmIconType(
  farm: {
    lat: number;
    lng: number;
    type?: string;
    name?: string;
    description?: string;
  },
  manualOverrides?: Record<string, 'chicken' | 'pig'>
): FarmCategory {
  const key = getFarmKey(farm.lat, farm.lng);
  const manual = manualOverrides?.[key];
  if (manual === 'chicken' || manual === 'pig') {
    return manual;
  }

  const layerAndName = `${farm.type || ''} ${farm.name || ''}`;
  // Kiểm tra từ khoá loại trừ trước (ví dụ "Kho heo" -> thuộc nhóm 'other', không gán icon heo)
  if (matchesExcludeKeywords(layerAndName)) {
    return 'other';
  }

  const rawText = `${layerAndName} ${farm.description || ''}`;
  const lower = rawText.toLowerCase().normalize('NFC');
  const ascii = normalizeMatchText(rawText);

  if (matchesIncludeKeywords(layerAndName)) {
    const normLN = normalizeMatchText(layerAndName);
    if (
      normLN.includes('heo') ||
      normLN.includes('lon') ||
      normLN.includes('pig') ||
      normLN.includes('swine')
    ) {
      return 'pig';
    }
    return 'chicken';
  }

  // Kiểm tra từ khoá Gà
  if (
    lower.includes('gà') ||
    /\bga\b/.test(ascii) ||
    ascii.includes('chicken') ||
    ascii.includes('poultry') ||
    ascii.includes('gia cam')
  ) {
    return 'chicken';
  }

  // Kiểm tra từ khoá Heo / Lợn
  if (
    lower.includes('heo') ||
    lower.includes('lợn') ||
    /\b(heo|lon)\b/.test(ascii) ||
    ascii.includes('pig') ||
    ascii.includes('swine')
  ) {
    return 'pig';
  }

  return 'other';
}

/**
 * Xác định subType biểu tượng chi tiết cho một điểm trang trại
 */
export function resolveFarmSubType(
  farm: {
    lat: number;
    lng: number;
    type?: string;
    name?: string;
    description?: string;
  },
  manualOverrides?: Record<string, 'chicken' | 'pig'>
): FarmSubType {
  const category = resolveFarmIconType(farm, manualOverrides);
  if (category === 'chicken') return 'chicken';
  if (category === 'pig') return 'pig';
  return detectOtherSubType(farm.type, farm.name);
}

/**
 * Trả về chuỗi SVG tự tạo (rõ nét ở cỡ 32px, nét dày dễ thương):
 * - chicken: Gà tông cam #fb923c, mào đỏ #ef4444
 * - pig: Heo tông hồng san hô #fb7185, hai tai cụp và mũi rõ
 * - office: Toà nhà văn phòng xanh ngọc #14b8a6
 * - warehouse: Nhà kho hàng hoá xanh ngọc #14b8a6
 * - wash: Trạm rửa xe / sát khuẩn (giọt nước & xe) xanh ngọc #14b8a6
 * - other: Ngôi nhà trang trại mái xanh ngọc #14b8a6
 * - hub: Nhà máy trung tâm Thái Việt xanh dương #2b8fd0
 */
export function getFarmIconSvg(
  typeOrCategory: FarmCategory | FarmSubType | 'hub',
  size = 32
): string {
  if (typeOrCategory === 'chicken') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${size}" height="${size}" fill="none">
      <path d="M12.5 9.5C12.5 6.8 14.8 5.2 16.5 7.2C17.6 4.8 20.8 4.8 21.4 7.5C23.5 6.4 25.5 8.5 23.8 10.8Z" fill="#ef4444" stroke="#b91c1c" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="17.5" cy="19.5" r="10.5" fill="#fb923c" stroke="#9a3412" stroke-width="2.2"/>
      <circle cx="13.5" cy="21.5" r="2.1" fill="#ef4444" fill-opacity="0.45"/>
      <path d="M10.5 19.5C10.5 17 13 17 14 19.5C15 22 12 24 10.5 22Z" fill="#fdba74" stroke="#9a3412" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="20.8" cy="16.8" r="2.1" fill="#1e293b"/>
      <circle cx="21.4" cy="16.1" r="0.7" fill="#ffffff"/>
      <path d="M27.2 17.2L32.2 19.2L27.2 21.4Z" fill="#facc15" stroke="#9a3412" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M25.8 21.4C27.2 21.4 27.6 24.4 25.5 24.6C23.8 24.8 24.2 21.4 25.8 21.4Z" fill="#ef4444"/>
    </svg>`;
  }

  if (typeOrCategory === 'pig') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${size}" height="${size}" fill="none">
      <path d="M7.5 14.5L5.2 6.5L13.5 9.2Z" fill="#f43f5e" stroke="#881337" stroke-width="2.1" stroke-linejoin="round"/>
      <path d="M28.5 14.5L30.8 6.5L22.5 9.2Z" fill="#f43f5e" stroke="#881337" stroke-width="2.1" stroke-linejoin="round"/>
      <circle cx="18" cy="19.5" r="11" fill="#fb7185" stroke="#881337" stroke-width="2.2"/>
      <circle cx="13.2" cy="16.2" r="2" fill="#1e293b"/>
      <circle cx="13.7" cy="15.6" r="0.65" fill="#ffffff"/>
      <circle cx="22.8" cy="16.2" r="2" fill="#1e293b"/>
      <circle cx="23.3" cy="15.6" r="0.65" fill="#ffffff"/>
      <rect x="11.8" y="19.5" width="12.4" height="7.6" rx="3.8" fill="#ffe4e6" stroke="#881337" stroke-width="2"/>
      <ellipse cx="15.6" cy="23.3" rx="1.35" ry="1.8" fill="#be123c"/>
      <ellipse cx="20.4" cy="23.3" rx="1.35" ry="1.8" fill="#be123c"/>
    </svg>`;
  }

  if (typeOrCategory === 'office') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${size}" height="${size}" fill="none">
      <rect x="8" y="6.5" width="20" height="23" rx="2.5" fill="#14b8a6" stroke="#115e59" stroke-width="2.2"/>
      <rect x="12" y="10.5" width="3.5" height="3.2" rx="0.7" fill="#ffffff"/>
      <rect x="20.5" y="10.5" width="3.5" height="3.2" rx="0.7" fill="#ffffff"/>
      <rect x="12" y="16" width="3.5" height="3.2" rx="0.7" fill="#ffffff"/>
      <rect x="20.5" y="16" width="3.5" height="3.2" rx="0.7" fill="#ffffff"/>
      <rect x="15" y="22.5" width="6" height="7" rx="1" fill="#ccfbf1" stroke="#115e59" stroke-width="1.8"/>
    </svg>`;
  }

  if (typeOrCategory === 'warehouse') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${size}" height="${size}" fill="none">
      <path d="M5.5 15L18 7.5L30.5 15V28.5H5.5V15Z" fill="#14b8a6" stroke="#115e59" stroke-width="2.2" stroke-linejoin="round"/>
      <rect x="10.5" y="18" width="15" height="10.5" rx="1.2" fill="#ccfbf1" stroke="#115e59" stroke-width="1.8"/>
      <path d="M10.5 21.5H25.5M10.5 25H25.5" stroke="#0f766e" stroke-width="1.6"/>
      <rect x="15.5" y="12" width="5" height="3" rx="0.8" fill="#ffffff" stroke="#115e59" stroke-width="1.4"/>
    </svg>`;
  }

  if (typeOrCategory === 'wash') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${size}" height="${size}" fill="none">
      <path d="M18 6C18 6 24.5 13.2 24.5 17.5C24.5 21.1 21.6 24 18 24C14.4 24 11.5 21.1 11.5 17.5C11.5 13.2 18 6 18 6Z" fill="#0ea5e9" stroke="#0369a1" stroke-width="2.1" stroke-linejoin="round"/>
      <circle cx="15.8" cy="18.2" r="1.6" fill="#ffffff" fill-opacity="0.85"/>
      <path d="M7.5 27.5C10.5 25.5 14 25.5 18 27.5C22 29.5 25.5 29.5 28.5 27.5" stroke="#14b8a6" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`;
  }

  if (typeOrCategory === 'hub') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${size}" height="${size}" fill="none">
      <!-- Hoa sen Thái Việt & Nhà máy trung tâm xanh dương #2b8fd0 -->
      <path d="M18 6.5C15 11.5 14.5 16.5 18 21.5C21.5 16.5 21 11.5 18 6.5Z" fill="#2b8fd0" stroke="#1e3a8a" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M17.2 21.5C12.5 19.5 9.5 15.2 10.5 10.8C13.8 13.2 15.8 16.8 17.2 21.5Z" fill="#38bdf8" stroke="#1e3a8a" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M18.8 21.5C23.5 19.5 26.5 15.2 25.5 10.8C22.2 13.2 20.2 16.8 18.8 21.5Z" fill="#38bdf8" stroke="#1e3a8a" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M7 22.5C10.5 21.5 14.2 22.2 18 24.5C21.8 22.2 25.5 21.5 29 22.5C26.5 26.8 22.5 28.5 18 28.5C13.5 28.5 9.5 26.8 7 22.5Z" fill="#2b8fd0" stroke="#1e3a8a" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`;
  }

  // Mặc định: Ngôi nhà trang trại xanh ngọc #14b8a6
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${size}" height="${size}" fill="none">
    <path d="M5 17.5L18 7L31 17.5H27.5V28.5H8.5V17.5H5Z" fill="#14b8a6" stroke="#115e59" stroke-width="2.2" stroke-linejoin="round"/>
    <rect x="13.2" y="18.2" width="9.6" height="10.3" rx="1.2" fill="#ccfbf1" stroke="#115e59" stroke-width="1.8"/>
    <path d="M13.5 18.5L22.5 28.2M22.5 18.5L13.5 28.2" stroke="#0f766e" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="18" cy="13.5" r="2.1" fill="#ffffff" stroke="#115e59" stroke-width="1.6"/>
  </svg>`;
}

// Bộ nhớ đệm ảnh Logo hoa sen công ty (cho ghim Nhà Máy Cám 256x256 siêu nét)
let cachedHubLogoImage: HTMLImageElement | null = null;
let cachedHubLogoUrl = '';
const hubLogoReadyListeners = new Set<() => void>();

/**
 * Tải trước ảnh Logo hoa sen (public/logo.png hoặc logo tuỳ chỉnh) để vẽ trực tiếp vào ghim Nhà Máy Cám 256x256px.
 * Khi ảnh tải xong sẽ tự động gọi lại toàn bộ listener để cập nhật lại texture MapLibre & Three.js tức thì.
 */
export function preloadHubLogo(url: string, onReady?: () => void): () => void {
  if (onReady) {
    hubLogoReadyListeners.add(onReady);
  }

  if (typeof window !== 'undefined' && url) {
    if (cachedHubLogoUrl === url && cachedHubLogoImage?.complete && cachedHubLogoImage.naturalWidth > 0) {
      onReady?.();
    } else if (cachedHubLogoUrl !== url) {
      cachedHubLogoUrl = url;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        cachedHubLogoImage = img;
        hubLogoReadyListeners.forEach((cb) => {
          try {
            cb();
          } catch {
            // ignore
          }
        });
      };
      img.src = url;
    }
  }

  return () => {
    if (onReady) {
      hubLogoReadyListeners.delete(onReady);
    }
  };
}

/**
 * VẼ BIỂU TƯỢNG 3D CHÂN THỰC SIÊU NÉT BÊN TRONG GHIM (HỆ TOẠ ĐỘ LOGIC 64x64 -> RENDER 256x256 RETINA)
 * Tâm huy hiệu nằm tại (32, 23.8) với bán kính khoang chứa ~15.4.
 */
function drawInnerPictogram2D(
  ctx: CanvasRenderingContext2D,
  subType: FarmSubType | 'hub'
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (subType === 'chicken') {
    // 1. Mào gà đỏ 3D có đổ bóng nổi bật
    const combGrad = ctx.createLinearGradient(28, 9, 36, 17);
    combGrad.addColorStop(0, '#ff6b6b');
    combGrad.addColorStop(0.5, '#ef4444');
    combGrad.addColorStop(1, '#b91c1c');
    ctx.fillStyle = combGrad;
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(28.3, 14.3, 2.5, 0, Math.PI * 2);
    ctx.arc(31.8, 12.6, 3.0, 0, Math.PI * 2);
    ctx.arc(35.2, 14.2, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Vệt sáng bóng trên đỉnh mào
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(31.2, 11.4, 1.3, 0.7, -0.25, 0, Math.PI * 2);
    ctx.fill();

    // 2. Thân / đầu gà 3D tạo khối cầu vàng cam ấm áp
    const bodyGrad = ctx.createRadialGradient(28.5, 19.8, 1.5, 31.2, 24.4, 10.5);
    bodyGrad.addColorStop(0, '#fef08a');
    bodyGrad.addColorStop(0.32, '#fdba74');
    bodyGrad.addColorStop(0.75, '#f97316');
    bodyGrad.addColorStop(1, '#c2410c');
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    ctx.arc(31.0, 24.4, 9.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 3. Cánh gà lông vũ nổi 3D bên trái
    const wingGrad = ctx.createLinearGradient(23, 22, 31, 29);
    wingGrad.addColorStop(0, '#ffedd5');
    wingGrad.addColorStop(0.6, '#fb923c');
    wingGrad.addColorStop(1, '#ea580c');
    ctx.fillStyle = wingGrad;
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.ellipse(27.0, 26.0, 3.8, 2.5, -0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4. Mỏ vàng cam 3D sắc nét (mỏ trên sáng, mỏ dưới đậm)
    const beakTopGrad = ctx.createLinearGradient(39, 21.8, 45, 24.4);
    beakTopGrad.addColorStop(0, '#fef08a');
    beakTopGrad.addColorStop(0.55, '#facc15');
    beakTopGrad.addColorStop(1, '#ea580c');
    ctx.fillStyle = beakTopGrad;
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 1.15;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(39.0, 22.0);
    ctx.lineTo(44.8, 24.2);
    ctx.lineTo(39.0, 24.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#eab308';
    ctx.beginPath();
    ctx.moveTo(39.0, 24.6);
    ctx.lineTo(43.6, 24.5);
    ctx.lineTo(39.0, 26.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 5. Yếm đỏ 3D dưới mỏ
    const wattleGrad = ctx.createRadialGradient(38.2, 27.3, 0.3, 38.6, 27.9, 2.1);
    wattleGrad.addColorStop(0, '#fca5a5');
    wattleGrad.addColorStop(0.5, '#ef4444');
    wattleGrad.addColorStop(1, '#991b1b');
    ctx.fillStyle = wattleGrad;
    ctx.beginPath();
    ctx.ellipse(38.6, 28.0, 1.8, 2.2, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 6. Má ửng hồng nhẹ
    const cheekGrad = ctx.createRadialGradient(33.2, 25.8, 0.2, 33.2, 25.8, 2.2);
    cheekGrad.addColorStop(0, 'rgba(244, 63, 94, 0.45)');
    cheekGrad.addColorStop(1, 'rgba(244, 63, 94, 0)');
    ctx.fillStyle = cheekGrad;
    ctx.beginPath();
    ctx.arc(33.2, 25.8, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // 7. Mắt đen long lanh 2 chấm sáng
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(34.4, 21.8, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(35.0, 21.1, 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(33.9, 22.5, 0.32, 0, Math.PI * 2);
    ctx.fill();
  } else if (subType === 'pig') {
    // 1. Hai tai heo 3D có viền ngoài & lòng tai hồng đậm
    const drawPigEar = (isRight: boolean) => {
      ctx.save();
      if (isRight) {
        ctx.translate(64, 0);
        ctx.scale(-1, 1);
      }
      const earGrad = ctx.createLinearGradient(20, 12, 28, 20);
      earGrad.addColorStop(0, '#fda4af');
      earGrad.addColorStop(0.55, '#fb7185');
      earGrad.addColorStop(1, '#e11d48');
      ctx.fillStyle = earGrad;
      ctx.strokeStyle = '#881337';
      ctx.lineWidth = 1.3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(23.0, 20.0);
      ctx.quadraticCurveTo(19.5, 13.5, 22.0, 12.2);
      ctx.quadraticCurveTo(26.2, 12.8, 28.8, 15.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Lòng tai hồng sẫm
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.moveTo(23.5, 18.2);
      ctx.quadraticCurveTo(21.7, 14.5, 23.0, 13.8);
      ctx.quadraticCurveTo(25.2, 14.3, 27.0, 16.0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    drawPigEar(false);
    drawPigEar(true);

    // 2. Khuôn mặt heo 3D tạo khối hồng san hô bóng mịn
    const faceGrad = ctx.createRadialGradient(29.5, 19.5, 1.8, 32, 24.4, 11);
    faceGrad.addColorStop(0, '#ffe4e6');
    faceGrad.addColorStop(0.32, '#fda4af');
    faceGrad.addColorStop(0.72, '#fb7185');
    faceGrad.addColorStop(1, '#e11d48');
    ctx.fillStyle = faceGrad;
    ctx.strokeStyle = '#881337';
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    ctx.arc(32, 24.4, 9.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 3. Đôi má hồng 3D mềm mại
    for (const cx of [25.6, 38.4]) {
      const blush = ctx.createRadialGradient(cx, 25.0, 0.2, cx, 25.0, 2.4);
      blush.addColorStop(0, 'rgba(225, 29, 72, 0.42)');
      blush.addColorStop(1, 'rgba(225, 29, 72, 0)');
      ctx.fillStyle = blush;
      ctx.beginPath();
      ctx.arc(cx, 25.0, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Đôi mắt đen long lanh 2 điểm sáng
    for (const ex of [27.9, 36.1]) {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(ex, 21.2, 1.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex + 0.55, 20.55, 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex - 0.45, 21.85, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Mũi heo 3D bầu dục bóng mịn nổi khối
    const snoutGrad = ctx.createLinearGradient(32, 23.6, 32, 30.8);
    snoutGrad.addColorStop(0, '#fff1f2');
    snoutGrad.addColorStop(0.55, '#fecdd3');
    snoutGrad.addColorStop(1, '#fda4af');
    ctx.fillStyle = snoutGrad;
    ctx.strokeStyle = '#881337';
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.roundRect(26.2, 23.9, 11.6, 6.8, 3.4);
    ctx.fill();
    ctx.stroke();

    // Vệt bóng đỉnh mũi
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(32, 25.0, 3.6, 0.75, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hai lỗ mũi 3D có chiều sâu
    for (const nx of [29.8, 34.2]) {
      ctx.fillStyle = '#9f1239';
      ctx.beginPath();
      ctx.ellipse(nx, 27.4, 1.25, 1.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.ellipse(nx + 0.2, 27.9, 0.55, 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (subType === 'hub') {
    // NHÀ MÁY CÁM THÁI VIỆT: Ưu tiên vẽ Logo Hoa sen thực tế (/logo.png) siêu sắc nét 256x256
    if (
      cachedHubLogoImage &&
      cachedHubLogoImage.complete &&
      cachedHubLogoImage.naturalWidth > 0
    ) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(32, 23.8, 15.2, 0, Math.PI * 2);
      ctx.clip();
      // Cắt 78% phần trên của logo để tập trung rõ vào biểu tượng Hoa sen Thái Việt
      const srcW = cachedHubLogoImage.naturalWidth;
      const srcH = cachedHubLogoImage.naturalHeight * 0.78;
      const drawSize = 27.5;
      ctx.drawImage(
        cachedHubLogoImage,
        0,
        0,
        srcW,
        srcH,
        32 - drawSize / 2,
        23.8 - drawSize / 2 + 0.5,
        drawSize,
        drawSize
      );
      ctx.restore();
    } else {
      // Dự phòng đồng bộ tức thì (trước khi /logo.png tải xong): Hoa sen 3D Thái Việt xanh dương ánh kim
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 1.25;
      ctx.lineJoin = 'round';

      const sidePetalGrad = ctx.createLinearGradient(23, 15, 41, 28);
      sidePetalGrad.addColorStop(0, '#7dd3fc');
      sidePetalGrad.addColorStop(0.5, '#38bdf8');
      sidePetalGrad.addColorStop(1, '#0284c7');

      ctx.fillStyle = sidePetalGrad;
      ctx.beginPath();
      ctx.moveTo(31.2, 26.8);
      ctx.quadraticCurveTo(22.6, 24.2, 23.8, 15.8);
      ctx.quadraticCurveTo(28.8, 18.8, 31.2, 26.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(32.8, 26.8);
      ctx.quadraticCurveTo(41.4, 24.2, 40.2, 15.8);
      ctx.quadraticCurveTo(35.2, 18.8, 32.8, 26.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const centerPetalGrad = ctx.createLinearGradient(32, 11.5, 32, 27.5);
      centerPetalGrad.addColorStop(0, '#bae6fd');
      centerPetalGrad.addColorStop(0.4, '#2b8fd0');
      centerPetalGrad.addColorStop(1, '#1d4ed8');
      ctx.fillStyle = centerPetalGrad;
      ctx.beginPath();
      ctx.moveTo(32, 11.8);
      ctx.quadraticCurveTo(26.8, 19.2, 32, 27.0);
      ctx.quadraticCurveTo(37.2, 19.2, 32, 11.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const baseGrad = ctx.createLinearGradient(22, 26, 42, 33);
      baseGrad.addColorStop(0, '#38bdf8');
      baseGrad.addColorStop(0.5, '#2563eb');
      baseGrad.addColorStop(1, '#1e3a8a');
      ctx.fillStyle = baseGrad;
      ctx.beginPath();
      ctx.moveTo(21.8, 27.0);
      ctx.quadraticCurveTo(27.2, 26.0, 32, 29.0);
      ctx.quadraticCurveTo(36.8, 26.0, 42.2, 27.0);
      ctx.quadraticCurveTo(39.0, 33.2, 32, 33.2);
      ctx.quadraticCurveTo(25.0, 33.2, 21.8, 27.0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (subType === 'office') {
    // Toà nhà văn phòng 3D hai khối sáng tối
    const bldgGrad = ctx.createLinearGradient(23, 13, 41, 33);
    bldgGrad.addColorStop(0, '#2dd4bf');
    bldgGrad.addColorStop(0.55, '#14b8a6');
    bldgGrad.addColorStop(1, '#0f766e');
    ctx.fillStyle = bldgGrad;
    ctx.strokeStyle = '#115e59';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(23.8, 13.4, 16.4, 19.8, 2.2);
    ctx.fill();
    ctx.stroke();

    // Mảng kính phản sáng bên phải (chiều sâu 3D)
    ctx.fillStyle = 'rgba(15, 118, 110, 0.28)';
    ctx.fillRect(32, 14.1, 7.5, 18.4);

    // Các ô cửa kính xanh sáng bóng
    const windows = [
      [26.4, 16.4],
      [34.2, 16.4],
      [26.4, 21.0],
      [34.2, 21.0],
    ];
    for (const [wx, wy] of windows) {
      ctx.fillStyle = '#f0fdfa';
      ctx.beginPath();
      ctx.roundRect(wx, wy, 3.4, 2.9, 0.6);
      ctx.fill();
    }

    // Sảnh cửa chính
    ctx.fillStyle = '#ccfbf1';
    ctx.strokeStyle = '#115e59';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.roundRect(29.6, 26.4, 4.8, 6.6, 0.8);
    ctx.fill();
    ctx.stroke();
  } else if (subType === 'warehouse') {
    // Nhà kho 3D mái dốc có đổ bóng & cửa cuốn kim loại
    const roofGrad = ctx.createLinearGradient(21, 13, 43, 33);
    roofGrad.addColorStop(0, '#2dd4bf');
    roofGrad.addColorStop(0.5, '#14b8a6');
    roofGrad.addColorStop(1, '#0f766e');
    ctx.fillStyle = roofGrad;
    ctx.strokeStyle = '#115e59';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(21.6, 20.8);
    ctx.lineTo(32.0, 13.8);
    ctx.lineTo(42.4, 20.8);
    ctx.lineTo(42.4, 32.6);
    ctx.lineTo(21.6, 32.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Ô biển hiệu nhỏ dưới đỉnh mái
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(29.3, 18.4, 5.4, 2.5, 0.7);
    ctx.fill();

    // Cửa cuốn kho có rãnh ngang 3D
    const doorGrad = ctx.createLinearGradient(26, 22.8, 26, 32.4);
    doorGrad.addColorStop(0, '#f0fdfa');
    doorGrad.addColorStop(1, '#99f6e4');
    ctx.fillStyle = doorGrad;
    ctx.strokeStyle = '#115e59';
    ctx.lineWidth = 1.15;
    ctx.fillRect(25.8, 22.8, 12.4, 9.6);
    ctx.strokeRect(25.8, 22.8, 12.4, 9.6);

    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(25.8, 25.8);
    ctx.lineTo(38.2, 25.8);
    ctx.moveTo(25.8, 29.0);
    ctx.lineTo(38.2, 29.0);
    ctx.stroke();
  } else if (subType === 'wash') {
    // Giọt nước 3D trạm rửa xe / sát khuẩn
    const dropGrad = ctx.createRadialGradient(29.8, 21.5, 1.0, 32, 23.5, 8.5);
    dropGrad.addColorStop(0, '#e0f2fe');
    dropGrad.addColorStop(0.35, '#38bdf8');
    dropGrad.addColorStop(0.8, '#0284c7');
    dropGrad.addColorStop(1, '#0369a1');
    ctx.fillStyle = dropGrad;
    ctx.strokeStyle = '#075985';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(32, 13.0);
    ctx.bezierCurveTo(37.2, 18.8, 38.2, 22.2, 38.2, 25.0);
    ctx.arc(32, 25.0, 6.2, 0, Math.PI, false);
    ctx.bezierCurveTo(25.8, 22.2, 26.8, 18.8, 32, 13.0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Vệt bóng sáng hình lưỡi liềm trên giọt nước
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.beginPath();
    ctx.ellipse(29.5, 24.6, 1.35, 2.3, -0.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Ngôi nhà trang trại 3D xanh ngọc
    const houseGrad = ctx.createLinearGradient(22, 14, 42, 33);
    houseGrad.addColorStop(0, '#2dd4bf');
    houseGrad.addColorStop(0.55, '#14b8a6');
    houseGrad.addColorStop(1, '#0f766e');
    ctx.fillStyle = houseGrad;
    ctx.strokeStyle = '#115e59';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(21.2, 22.2);
    ctx.lineTo(32.0, 13.6);
    ctx.lineTo(42.8, 22.2);
    ctx.lineTo(39.8, 22.2);
    ctx.lineTo(39.8, 32.4);
    ctx.lineTo(24.2, 32.4);
    ctx.lineTo(24.2, 22.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ccfbf1';
    ctx.strokeStyle = '#115e59';
    ctx.lineWidth = 1.1;
    ctx.fillRect(28.2, 23.4, 7.6, 8.8);
    ctx.strokeRect(28.2, 23.4, 7.6, 8.8);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(32, 18.6, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * TẠO GHIM ICON 3D CHÂN THỰC SIÊU NÉT 256x256px (HIGH-DPI RETINA, ĐỒNG BỘ 100%)
 * - Khung logic 64x64 -> render mặc định ở pixelScale = 4 (256x256px vật lý) để sắc nét tuyệt đối trên cả
 *   Quả địa cầu 3D (Three.js Sprite + Anisotropy) và Bản đồ 2D (MapLibre GL pixelRatio: 4).
 * - Đỉnh dưới cùng của mũi ghim giọt nước chạm chính xác tại (32, 63.2) để neo toạ độ chuẩn 100%.
 */
export function createFarmPinCanvasSync(
  subType: FarmSubType | 'hub',
  isSelected = false,
  pixelScale = 4
): { canvas: HTMLCanvasElement; imageData: ImageData } {
  const logicalSize = 64;
  const physicalSize = logicalSize * pixelScale;
  const canvas = document.createElement('canvas');
  canvas.width = physicalSize;
  canvas.height = physicalSize;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Không tạo được 2D context cho icon');
  }

  ctx.clearRect(0, 0, physicalSize, physicalSize);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.scale(pixelScale, pixelScale);

  const palette =
    subType === 'chicken'
      ? {
          top: '#ffedd5',
          upper: '#fb923c',
          mid: '#f97316',
          bot: '#9a3412',
          rim: '#ffffff',
          outerStroke: 'rgba(154, 52, 18, 0.35)',
          dot: '#ea580c',
        }
      : subType === 'pig'
      ? {
          top: '#ffe4e6',
          upper: '#fb7185',
          mid: '#f43f5e',
          bot: '#9f1239',
          rim: '#ffffff',
          outerStroke: 'rgba(136, 19, 55, 0.35)',
          dot: '#e11d48',
        }
      : subType === 'hub'
      ? {
          top: '#7dd3fc',
          upper: '#38bdf8',
          mid: '#2563eb',
          bot: '#1e3a8a',
          rim: '#facc15',
          outerStroke: 'rgba(180, 83, 9, 0.55)',
          dot: '#f59e0b',
        }
      : {
          top: '#ccfbf1',
          upper: '#2dd4bf',
          mid: '#14b8a6',
          bot: '#115e59',
          rim: '#ffffff',
          outerStroke: 'rgba(17, 94, 89, 0.35)',
          dot: '#0d9488',
        };

  // 1. Bóng đổ mềm elip dưới chân ghim tạo hiệu ứng nổi khối 3D rõ nét trên mọi nền bản đồ
  ctx.save();
  const groundShadow = ctx.createRadialGradient(32, 60.4, 0.8, 32, 60.4, 11.5);
  groundShadow.addColorStop(0, 'rgba(15, 23, 42, 0.42)');
  groundShadow.addColorStop(0.5, 'rgba(15, 23, 42, 0.18)');
  groundShadow.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = groundShadow;
  ctx.beginPath();
  ctx.ellipse(32, 60.4, 11.5, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 2. Vòng hào quang phát sáng cho Nhà Máy Cám hoặc điểm đang được chọn
  if (isSelected || subType === 'hub') {
    ctx.save();
    const haloGrad = ctx.createRadialGradient(32, 23.4, 17.5, 32, 23.4, 26.8);
    if (subType === 'hub') {
      haloGrad.addColorStop(0, 'rgba(250, 204, 21, 0.65)');
      haloGrad.addColorStop(0.55, 'rgba(250, 204, 21, 0.28)');
      haloGrad.addColorStop(1, 'rgba(250, 204, 21, 0)');
    } else {
      haloGrad.addColorStop(0, 'rgba(250, 204, 21, 0.68)');
      haloGrad.addColorStop(0.6, 'rgba(250, 204, 21, 0.25)');
      haloGrad.addColorStop(1, 'rgba(250, 204, 21, 0)');
    }
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(32, 23.4, 26.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 3. Đường bao thân ghim giọt nước 3D chuẩn (đỉnh nhọn tại x=32, y=60.4)
  const tracePinBody = () => {
    ctx.beginPath();
    ctx.moveTo(32, 60.4);
    ctx.bezierCurveTo(28.0, 50.8, 11.2, 37.8, 11.2, 23.4);
    ctx.arc(32, 23.4, 20.8, Math.PI, 0, false);
    ctx.bezierCurveTo(52.8, 37.8, 36.0, 50.8, 32, 60.4);
    ctx.closePath();
  };

  // Thân ghim giọt nước đổ khối gradient sáng trên → đậm dưới + bóng nổi 3D
  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.36)';
  ctx.shadowBlur = 4.2;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2.2;

  const pinGrad = ctx.createLinearGradient(22, 3, 42, 58);
  pinGrad.addColorStop(0, palette.top);
  pinGrad.addColorStop(0.22, palette.upper);
  pinGrad.addColorStop(0.62, palette.mid);
  pinGrad.addColorStop(1, palette.bot);
  ctx.fillStyle = pinGrad;
  tracePinBody();
  ctx.fill();
  ctx.restore();

  // Viền ngoài trắng dày 3.6px (hoặc viền vàng kim 4.0px nổi bật cho Nhà Máy Cám)
  ctx.save();
  ctx.lineJoin = 'round';
  // Đường viền mảnh tương phản bên ngoài cùng giúp tách nền cực sắc trên bản đồ sáng
  ctx.strokeStyle = palette.outerStroke;
  ctx.lineWidth = subType === 'hub' ? 5.2 : 4.6;
  tracePinBody();
  ctx.stroke();

  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = subType === 'hub' ? 3.8 : 3.4;
  tracePinBody();
  ctx.stroke();
  ctx.restore();

  // 4. Khối bóng 3D & điểm highlight sáng góc trên trái bên trong thân ghim
  ctx.save();
  tracePinBody();
  ctx.clip();

  // Bóng tối nhẹ ở viền dưới tạo độ dày khối cầu 3D
  const lowerShade = ctx.createLinearGradient(32, 36, 32, 61);
  lowerShade.addColorStop(0, 'rgba(15, 23, 42, 0)');
  lowerShade.addColorStop(1, 'rgba(15, 23, 42, 0.28)');
  ctx.fillStyle = lowerShade;
  ctx.fillRect(10, 36, 44, 26);

  // Vệt bóng phản chiếu lớn góc trên trái
  const shineGrad = ctx.createLinearGradient(13, 4, 34, 22);
  shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0.62)');
  shineGrad.addColorStop(0.55, 'rgba(255, 255, 255, 0.14)');
  shineGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = shineGrad;
  ctx.beginPath();
  ctx.ellipse(23.2, 10.6, 13.5, 6.8, -0.48, 0, Math.PI * 2);
  ctx.fill();

  // Điểm highlight nhỏ sắc nét ở góc trên trái (hiệu ứng men bóng 3D)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.beginPath();
  ctx.ellipse(19.2, 10.2, 3.2, 1.5, -0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(15.6, 14.2, 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 5. Khoang tròn trắng tinh khiết ở giữa (viền lõm 3D để tôn biểu tượng Heo / Gà / Văn phòng / Nhà Máy Cám)
  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
  ctx.shadowBlur = 2.0;
  ctx.shadowOffsetY = 0.8;
  const innerBgGrad = ctx.createRadialGradient(29, 19.2, 1.5, 32, 23.4, 15.6);
  innerBgGrad.addColorStop(0, '#ffffff');
  innerBgGrad.addColorStop(0.84, '#ffffff');
  innerBgGrad.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = innerBgGrad;
  ctx.beginPath();
  ctx.arc(32, 23.4, 15.0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle =
    subType === 'hub' ? 'rgba(250, 204, 21, 0.95)' : 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(32, 23.4, 15.0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 6. Vẽ biểu tượng 3D siêu nét bên trong khoang tròn trắng
  ctx.save();
  ctx.translate(0, -0.4);
  drawInnerPictogram2D(ctx, subType);
  ctx.restore();

  // 7. Chấm neo nhỏ gọn ngay đúng đầu nhọn (32, 61.3) chỉ chính xác 100% tọa độ địa lý
  ctx.save();
  ctx.fillStyle = palette.dot;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(32, 61.3, 2.0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  const imageData = ctx.getImageData(0, 0, physicalSize, physicalSize);
  return { canvas, imageData };
}

/**
 * Tạo texture chấm tròn phát sáng (glowing particle) đồng bộ bằng Canvas 2D
 * dùng cho luồng chấm sáng cung ứng chạy một chiều từ Nhà Máy Cám -> Trại Gà / Trại Heo
 */
export function createGlowParticleImageDataSync(
  coreColor = '#fef08a',
  glowColor = '#facc15',
  size = 64
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Không tạo được 2D context cho particle');
  }

  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, r * 0.08, r, r, r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.28, coreColor);
  grad.addColorStop(0.62, glowColor);
  grad.addColorStop(1, 'rgba(250, 204, 21, 0)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

const VALID_SUBTYPES: ReadonlyArray<FarmSubType | 'hub'> = [
  'chicken',
  'pig',
  'other',
  'office',
  'warehouse',
  'wash',
  'hub',
];

const MARKER_ALIAS_MAP: Record<string, FarmSubType | 'hub'> = {
  'marker-chicken': 'chicken',
  'marker-pig': 'pig',
  'marker-other': 'other',
  'marker-factory': 'hub',
};

const MAPLIBRE_ICON_PIXEL_SCALE = 4; // 64x64 logic * 4 = 256x256px Retina siêu nét

/**
 * Đăng ký ĐỒNG BỘ 100% một ảnh icon 256x256px (pixelRatio: 4) vào MapLibre GL
 */
export function addSingleFarmIconToMap(
  map: maplibregl.Map,
  imageId: string,
  forceReplace = false
): void {
  try {
    if (map.hasImage(imageId)) {
      if (!forceReplace) return;
      map.removeImage(imageId);
    }

    if (imageId === 'supply-particle-chicken') {
      const imgData = createGlowParticleImageDataSync('#fef08a', '#fb923c', 64);
      map.addImage(imageId, imgData, { pixelRatio: 2 });
      return;
    }

    if (imageId === 'supply-particle-pig') {
      const imgData = createGlowParticleImageDataSync('#fef08a', '#fb7185', 64);
      map.addImage(imageId, imgData, { pixelRatio: 2 });
      return;
    }

    if (imageId in MARKER_ALIAS_MAP) {
      const st = MARKER_ALIAS_MAP[imageId];
      const { imageData } = createFarmPinCanvasSync(
        st,
        st === 'hub',
        MAPLIBRE_ICON_PIXEL_SCALE
      );
      map.addImage(imageId, imageData, {
        pixelRatio: MAPLIBRE_ICON_PIXEL_SCALE,
      });
      return;
    }

    if (!imageId.startsWith('farm-icon-')) return;
    const isSelectedVariant = imageId.endsWith('-selected');
    const cleaned = imageId
      .replace('farm-icon-', '')
      .replace(/-selected$/, '') as FarmSubType | 'hub';
    const st: FarmSubType | 'hub' = VALID_SUBTYPES.includes(cleaned)
      ? cleaned
      : 'other';

    const { imageData } = createFarmPinCanvasSync(
      st,
      isSelectedVariant || st === 'hub',
      MAPLIBRE_ICON_PIXEL_SCALE
    );
    map.addImage(imageId, imageData, {
      pixelRatio: MAPLIBRE_ICON_PIXEL_SCALE,
    });
  } catch {
    // Bỏ qua an toàn nếu bản đồ đang chuyển style
  }
}

/**
 * Cập nhật nóng lại icon Nhà Máy Cám (farm-icon-hub & farm-icon-hub-selected) trên MapLibre GL ngay khi ảnh /logo.png tải xong
 */
export function refreshHubIconOnMap(map: maplibregl.Map): void {
  addSingleFarmIconToMap(map, 'farm-icon-hub', true);
  addSingleFarmIconToMap(map, 'farm-icon-hub-selected', true);
  addSingleFarmIconToMap(map, 'marker-factory', true);
}

/**
 * Đăng ký ĐỒNG BỘ toàn bộ bộ ảnh icon 256x256px (cả trạng thái thường và đang chọn) + hạt phát sáng vào MapLibre GL ngay lập tức
 */
export function registerMapLibreFarmIcons(map: maplibregl.Map): void {
  for (const st of VALID_SUBTYPES) {
    addSingleFarmIconToMap(map, `farm-icon-${st}`);
    addSingleFarmIconToMap(map, `farm-icon-${st}-selected`);
  }
  for (const aliasId of Object.keys(MARKER_ALIAS_MAP)) {
    addSingleFarmIconToMap(map, aliasId);
  }
  addSingleFarmIconToMap(map, 'supply-particle-chicken');
  addSingleFarmIconToMap(map, 'supply-particle-pig');
}

export interface DropdownLocationItem {
  id: string;
  name: string;
  type?: string;
  category: FarmCategory | 'hub';
  subType?: FarmSubType | 'hub';
  lat: number;
  lng: number;
  isHub?: boolean;
  farm?: any;
}

/**
 * Xác định nhóm ưu tiên (1 -> 7) cho danh sách xổ xuống "Tất cả địa điểm":
 * 1. Trụ sở chính Công ty Thái Việt Corporation
 * 2. Văn phòng miền Nam -> các văn phòng khác
 * 3. Nhà Máy Cám (điểm thật từ Google My Maps — tâm phát đốm sáng cung ứng)
 * 4. Kho heo trung tâm -> các kho khác
 * 5. Các trại heo
 * 6. Các trại gà
 * 7. Các điểm khác & cuối cùng là các điểm rửa xe
 */
function getDropdownPriorityRank(item: DropdownLocationItem): {
  group: number;
  subRank: number;
  groupLabel: string;
} {
  const normName = normalizeMatchText(item.name || '');
  const normAll = normalizeMatchText(`${item.type || ''} ${item.name || ''}`);
  const paddedAll = ` ${normAll} `;

  // 3. Nhà Máy Cám (điểm thật từ My Maps)
  if (
    item.isHub ||
    item.category === 'hub' ||
    item.subType === 'hub' ||
    normAll.includes('nha may cam') ||
    normName.includes('nha may')
  ) {
    return {
      group: 3,
      subRank: normAll.includes('nha may cam') ? 0 : 1,
      groupLabel: 'Nhà máy cám',
    };
  }

  // Kiểm tra điểm rửa xe trước để không bị lọt nhầm vào nhóm trên
  const isWashPoint =
    item.subType === 'wash' ||
    normAll.includes('rua xe') ||
    normAll.includes('diem rua') ||
    normAll.includes('tram rua') ||
    normAll.includes('sat khuan') ||
    normAll.includes('sat trung') ||
    normAll.includes('khu trung');

  if (isWashPoint) {
    return {
      group: 7,
      subRank: 2,
      groupLabel: 'Trạm rửa xe & Sát khuẩn',
    };
  }

  // 1. Trụ sở chính Công ty Thái Việt Corporation
  if (
    normAll.includes('tru so') ||
    normName.includes('thai viet corporation') ||
    (normName.includes('cong ty') && !normName.includes('van phong'))
  ) {
    return {
      group: 1,
      subRank: normAll.includes('tru so') ? 0 : 1,
      groupLabel: 'Trụ sở chính & Văn phòng',
    };
  }

  // 2. Văn phòng miền Nam -> các văn phòng khác
  const isSouthOffice =
    normAll.includes('van phong mien nam') ||
    normAll.includes('vp mien nam');
  const isOtherOffice =
    item.subType === 'office' ||
    normAll.includes('van phong') ||
    paddedAll.includes(' vp ') ||
    normName.startsWith('vp ') ||
    normAll.includes('office') ||
    normAll.includes('chi nhanh');

  if (isSouthOffice || isOtherOffice) {
    return {
      group: 2,
      subRank: isSouthOffice ? 0 : 1,
      groupLabel: 'Trụ sở chính & Văn phòng',
    };
  }

  // 4. Kho heo trung tâm -> các kho khác
  const isCentralPigWarehouse = normAll.includes('kho heo trung tam');
  const isOtherWarehouse =
    item.subType === 'warehouse' ||
    normAll.includes('kho ') ||
    normName.startsWith('kho') ||
    normAll.includes('warehouse');

  if (isCentralPigWarehouse || isOtherWarehouse) {
    return {
      group: 4,
      subRank: isCentralPigWarehouse ? 0 : 1,
      groupLabel: 'Hệ thống Kho trung tâm',
    };
  }

  // 5. Các trại heo
  if (item.category === 'pig') {
    return {
      group: 5,
      subRank: 0,
      groupLabel: 'Hệ thống Trại heo',
    };
  }

  // 6. Các trại gà
  if (item.category === 'chicken') {
    return {
      group: 6,
      subRank: 0,
      groupLabel: 'Hệ thống Trại gà',
    };
  }

  // 7. Các điểm còn lại (xếp trước các điểm rửa xe subRank = 2)
  return {
    group: 7,
    subRank: 1,
    groupLabel: 'Các điểm khác',
  };
}

/**
 * Sắp xếp danh sách tất cả địa điểm cho Searchable Dropdown theo đúng 7 thứ tự ưu tiên bắt buộc,
 * trong cùng một nhóm và subRank thì xếp theo bảng chữ cái A-Z (tiếng Việt).
 */
export function sortLocationsForDropdown<T extends DropdownLocationItem>(
  items: T[]
): Array<T & { group: number; subRank: number; groupLabel: string }> {
  return items
    .map((item) => {
      const rank = getDropdownPriorityRank(item);
      return {
        ...item,
        group: rank.group,
        subRank: rank.subRank,
        groupLabel: rank.groupLabel,
      };
    })
    .sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      if (a.subRank !== b.subRank) return a.subRank - b.subRank;
      return a.name.localeCompare(b.name, 'vi', {
        sensitivity: 'base',
        numeric: true,
      });
    });
}
