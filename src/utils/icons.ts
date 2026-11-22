import * as maplibregl from 'maplibre-gl';
import { ARC_EXCLUDE_KEYWORDS, ARC_INCLUDE_KEYWORDS } from '../config';
import { FarmCategory, FarmSubType, IconChoice } from '../types';

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

/**
 * Phân loại chi tiết cho nhóm "Khác" (văn phòng / kho / điểm rửa xe / nhà trại khác)
 */
export function detectOtherSubType(
  rawType = '',
  rawName = ''
): Exclude<FarmSubType, 'chicken' | 'pig'> {
  const norm = normalizeMatchText(`${rawType} ${rawName}`);
  const padded = ` ${norm} `;

  if (
    norm.includes('rua xe') ||
    norm.includes('diem rua') ||
    norm.includes('tram rua') ||
    norm.includes('sat khuan') ||
    norm.includes('khu trung')
  ) {
    return 'wash';
  }

  if (norm.includes('kho') || norm.includes('warehouse')) {
    return 'warehouse';
  }

  if (
    norm.includes('van phong') ||
    padded.includes(' vp ') ||
    norm.startsWith('vp ') ||
    norm.includes('office') ||
    norm.includes('bao ve') ||
    norm.includes('cong ty') ||
    norm.includes('nha may') ||
    norm.includes('factory')
  ) {
    return 'office';
  }

  return 'other';
}

/**
 * Kiểm tra một điểm có được nối đường cung vệt sáng từ NHÀ MÁY TRUNG TÂM hay không:
 * 1. Chuẩn hoá chuỗi: chữ thường, bỏ dấu tiếng Việt (đ -> d), gom khoảng trắng.
 * 2. Văn bản xét = tên layer/folder (farm.type) + tên điểm (farm.name).
 * 3. LOẠI TRỪ TRƯỚC: chứa bất kỳ từ khoá nào trong ARC_EXCLUDE_KEYWORDS thì KHÔNG nối
 *    (kể cả "Kho heo", "Văn phòng", "Điểm rửa xe"...).
 * 4. Nếu quản trị viên đã chọn thủ công icon gà/heo thì coi là nối được (trừ khi đã dính từ khoá loại trừ ở bước 3).
 * 5. Nếu không bị loại: chỉ nối khi layer/folder hoặc tên điểm chứa từ khoá trong ARC_INCLUDE_KEYWORDS.
 */
export function isConnectableFarm(
  farm: {
    lat: number;
    lng: number;
    type?: string;
    name?: string;
    manualIcon?: IconChoice;
  },
  manualOverrides?: Record<string, 'chicken' | 'pig'>
): boolean {
  const layerAndName = `${farm.type || ''} ${farm.name || ''}`;

  // Bước 3: Loại trừ trước
  if (matchesExcludeKeywords(layerAndName)) {
    return false;
  }

  // Bước 5: Quản trị viên chọn thủ công Gà / Heo ( và không dính từ khoá loại trừ )
  const key = getFarmKey(farm.lat, farm.lng);
  const manual =
    farm.manualIcon && farm.manualIcon !== 'auto'
      ? farm.manualIcon
      : manualOverrides?.[key];
  if (manual === 'chicken' || manual === 'pig') {
    return true;
  }

  // Bước 4: Khớp từ khoá trong ARC_INCLUDE_KEYWORDS
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

/**
 * Tạo chuỗi SVG Huy hiệu Ghim 3D chuẩn xác:
 * Đỉnh dưới cùng của mũi ghim nằm ĐÚNG tại (32, 76) - sát mép dưới cùng của viewBox (0 0 64 76)
 * để khi MapLibre neo `icon-anchor: 'bottom'` và `icon-offset: [0, 0]`, mũi ghim trùng khít 100% với toạ độ (lat, lng).
 */
function getMapLibrePinSvg(
  subType: FarmSubType | 'hub',
  isSelected = false
): string {
  const borderColor =
    subType === 'chicken'
      ? '#fb923c'
      : subType === 'pig'
      ? '#fb7185'
      : subType === 'hub'
      ? '#2b8fd0'
      : '#14b8a6';

  const outerRing = isSelected
    ? `<circle cx="32" cy="28" r="27" fill="none" stroke="#facc15" stroke-width="3.5" stroke-opacity="0.95"/>`
    : '';

  const innerSvg = getFarmIconSvg(subType, 32)
    .replace(/<svg[^>]*>/, '<g transform="translate(16, 12)">')
    .replace(/<\/svg>/, '</g>');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 76" width="128" height="152" fill="none">
    ${outerRing}
    <!-- Mũi ghim tam giác chạm đúng điểm đáy (32, 75.5) -->
    <path d="M23.5 48L32 75.5L40.5 48Z" fill="${borderColor}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
    <!-- Vòng tròn trắng viền màu nổi bật -->
    <circle cx="32" cy="28" r="23.5" fill="#ffffff" stroke="${borderColor}" stroke-width="5"/>
    ${innerSvg}
    <!-- Chấm tâm nhỏ ngay đúng đỉnh mũi ghim (32, 75) -->
    <circle cx="32" cy="74.5" r="2.2" fill="#ffffff" stroke="${borderColor}" stroke-width="1.5"/>
  </svg>`;
}

/**
 * Chuyển chuỗi SVG thành đối tượng ImageData để gọi `map.addImage(id, imageData)`
 */
export function renderSvgToImageData(
  svgString: string,
  width = 128,
  height = 152
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgString], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(url);
      if (!ctx) {
        reject(new Error('Không tạo được 2D context cho icon'));
        return;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(ctx.getImageData(0, 0, width, height));
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}

/**
 * Đăng ký đầy đủ bộ ảnh icon vào MapLibre GL bằng `map.addImage`:
 * - 'farm-icon-chicken', 'farm-icon-pig', 'farm-icon-other',
 * - 'farm-icon-office', 'farm-icon-warehouse', 'farm-icon-wash',
 * - 'farm-icon-hub' (Nhà máy trung tâm)
 */
export async function registerMapLibreFarmIcons(
  map: maplibregl.Map
): Promise<void> {
  const subTypes: Array<FarmSubType | 'hub'> = [
    'chicken',
    'pig',
    'other',
    'office',
    'warehouse',
    'wash',
    'hub',
  ];

  await Promise.all(
    subTypes.map(async (st) => {
      const imageId = `farm-icon-${st}`;
      if (map.hasImage(imageId)) return;
      try {
        const svg = getMapLibrePinSvg(st, st === 'hub');
        const imageData = await renderSvgToImageData(svg, 128, 152);
        if (!map.hasImage(imageId)) {
          map.addImage(imageId, imageData, { pixelRatio: 2 });
        }
      } catch {
        // Bỏ qua an toàn nếu bản đồ đã huỷ giữa chừng
      }
    })
  );
}
