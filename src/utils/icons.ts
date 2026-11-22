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
 * VẼ TRỰC TIẾP ICON LÊN HTML5 CANVAS 2D (ĐỒNG BỘ 100%, KHÔNG PHỤ THUỘC Image.onload BẤT ĐỒNG BỘ)
 * Khung logic 64x64 -> vẽ ở độ phân giải vật lý 128x128 (pixelRatio: 2, hệ số scale = 2).
 * Đỉnh dưới cùng của mũi ghim nằm ĐÚNG tại (32, 64) - sát mép dưới cùng chính giữa của khung 64x64
 * để khi MapLibre neo `icon-anchor: 'bottom'` và `icon-offset: [0, 0]`, mũi ghim trùng khít 100% với toạ độ (lat, lng).
 */
function drawInnerPictogram2D(
  ctx: CanvasRenderingContext2D,
  subType: FarmSubType | 'hub'
): void {
  ctx.save();
  // Tâm huy hiệu nằm tại (32, 24) trong hệ toạ độ 64x64
  if (subType === 'chicken') {
    // Mào đỏ phía trên đầu gà
    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#b91c1c';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(28.5, 13.8, 2.3, 0, Math.PI * 2);
    ctx.arc(31.8, 12.6, 2.7, 0, Math.PI * 2);
    ctx.arc(35.0, 14.0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Thân/đầu gà tròn cam #fb923c
    ctx.fillStyle = '#fb923c';
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(31.2, 24.5, 8.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Cánh nhỏ cam sáng
    ctx.fillStyle = '#fdba74';
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(27.8, 25.4, 3.2, 2.2, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Mỏ vàng nhọn bên phải
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(39.0, 22.4);
    ctx.lineTo(44.2, 24.3);
    ctx.lineTo(39.0, 26.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Yếm đỏ dưới mỏ
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(38.6, 27.6, 1.7, 0, Math.PI * 2);
    ctx.fill();

    // Má hồng nhẹ
    ctx.fillStyle = 'rgba(239, 68, 68, 0.42)';
    ctx.beginPath();
    ctx.arc(28.4, 26.0, 1.7, 0, Math.PI * 2);
    ctx.fill();

    // Mắt đen + chấm sáng trắng
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(34.2, 22.0, 1.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(34.7, 21.4, 0.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (subType === 'pig') {
    // Hai tai heo cụp hai bên
    ctx.fillStyle = '#f43f5e';
    ctx.strokeStyle = '#881337';
    ctx.lineWidth = 1.6;

    // Tai trái
    ctx.beginPath();
    ctx.moveTo(23.5, 19.5);
    ctx.lineTo(21.2, 13.0);
    ctx.lineTo(28.2, 15.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Tai phải
    ctx.beginPath();
    ctx.moveTo(40.5, 19.5);
    ctx.lineTo(42.8, 13.0);
    ctx.lineTo(35.8, 15.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Mặt heo tròn hồng san hô #fb7185
    ctx.fillStyle = '#fb7185';
    ctx.strokeStyle = '#881337';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(32, 24.5, 9.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Hai mắt đen + chấm sáng trắng
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(28.0, 21.6, 1.65, 0, Math.PI * 2);
    ctx.arc(36.0, 21.6, 1.65, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(28.4, 21.1, 0.55, 0, Math.PI * 2);
    ctx.arc(36.4, 21.1, 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Mũi heo bầu dục hồng phấn rõ nét
    ctx.fillStyle = '#ffe4e6';
    ctx.strokeStyle = '#881337';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(26.6, 24.2, 10.8, 6.4, 3.2);
    ctx.fill();
    ctx.stroke();

    // Hai lỗ mũi
    ctx.fillStyle = '#be123c';
    ctx.beginPath();
    ctx.ellipse(30.0, 27.4, 1.15, 1.55, 0, 0, Math.PI * 2);
    ctx.ellipse(34.0, 27.4, 1.15, 1.55, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (subType === 'hub') {
    // Hoa sen Nhà máy Trung tâm Thái Việt xanh dương #2b8fd0
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';

    // Cánh sen trái
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(31.2, 26.5);
    ctx.quadraticCurveTo(23.5, 24.2, 24.5, 16.5);
    ctx.quadraticCurveTo(29.0, 19.2, 31.2, 26.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cánh sen phải
    ctx.beginPath();
    ctx.moveTo(32.8, 26.5);
    ctx.quadraticCurveTo(40.5, 24.2, 39.5, 16.5);
    ctx.quadraticCurveTo(35.0, 19.2, 32.8, 26.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cánh sen chính giữa
    ctx.fillStyle = '#2b8fd0';
    ctx.beginPath();
    ctx.moveTo(32, 12.8);
    ctx.quadraticCurveTo(27.5, 19.5, 32, 26.8);
    ctx.quadraticCurveTo(36.5, 19.5, 32, 12.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Đế đài sen
    ctx.fillStyle = '#2b8fd0';
    ctx.beginPath();
    ctx.moveTo(22.5, 27.0);
    ctx.quadraticCurveTo(27.5, 26.2, 32, 28.8);
    ctx.quadraticCurveTo(36.5, 26.2, 41.5, 27.0);
    ctx.quadraticCurveTo(38.5, 32.5, 32, 32.5);
    ctx.quadraticCurveTo(25.5, 32.5, 22.5, 27.0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (subType === 'office') {
    // Toà nhà văn phòng xanh ngọc #14b8a6
    ctx.fillStyle = '#14b8a6';
    ctx.strokeStyle = '#115e59';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.roundRect(24.2, 14.0, 15.6, 18.8, 2);
    ctx.fill();
    ctx.stroke();

    // Ô cửa sổ trắng
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(27.0, 17.2, 3.0, 2.6);
    ctx.fillRect(34.0, 17.2, 3.0, 2.6);
    ctx.fillRect(27.0, 21.8, 3.0, 2.6);
    ctx.fillRect(34.0, 21.8, 3.0, 2.6);

    // Cửa chính
    ctx.fillStyle = '#ccfbf1';
    ctx.fillRect(29.8, 26.8, 4.4, 5.8);
  } else if (subType === 'warehouse') {
    // Nhà kho mái tam giác xanh ngọc #14b8a6
    ctx.fillStyle = '#14b8a6';
    ctx.strokeStyle = '#115e59';
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(22.2, 21.0);
    ctx.lineTo(32.0, 14.5);
    ctx.lineTo(41.8, 21.0);
    ctx.lineTo(41.8, 32.2);
    ctx.lineTo(22.2, 32.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cửa cuốn kho
    ctx.fillStyle = '#ccfbf1';
    ctx.strokeStyle = '#115e59';
    ctx.lineWidth = 1.3;
    ctx.fillRect(26.2, 23.2, 11.6, 8.8);
    ctx.strokeRect(26.2, 23.2, 11.6, 8.8);

    ctx.beginPath();
    ctx.moveTo(26.2, 26.2);
    ctx.lineTo(37.8, 26.2);
    ctx.moveTo(26.2, 29.2);
    ctx.lineTo(37.8, 29.2);
    ctx.stroke();
  } else if (subType === 'wash') {
    // Giọt nước trạm rửa xe / sát khuẩn
    ctx.fillStyle = '#0ea5e9';
    ctx.strokeStyle = '#0369a1';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(32, 13.8);
    ctx.bezierCurveTo(36.5, 19.2, 37.5, 22.5, 37.5, 25.0);
    ctx.arc(32, 25.0, 5.5, 0, Math.PI, false);
    ctx.bezierCurveTo(26.5, 22.5, 27.5, 19.2, 32, 13.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(30.2, 25.2, 1.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Ngôi nhà trang trại xanh ngọc #14b8a6
    ctx.fillStyle = '#14b8a6';
    ctx.strokeStyle = '#115e59';
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(21.8, 22.4);
    ctx.lineTo(32.0, 14.2);
    ctx.lineTo(42.2, 22.4);
    ctx.lineTo(39.4, 22.4);
    ctx.lineTo(39.4, 32.0);
    ctx.lineTo(24.6, 32.0);
    ctx.lineTo(24.6, 22.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ccfbf1';
    ctx.fillRect(28.4, 23.4, 7.2, 8.4);
    ctx.strokeRect(28.4, 23.4, 7.2, 8.4);
  }
  ctx.restore();
}

/**
 * Tạo trực tiếp HTMLCanvasElement (và trích xuất ImageData đồng bộ 100%)
 * cho icon ghim trang trại / nhà máy bằng các lệnh vẽ Canvas 2D thuần tuý.
 * Không dùng Image.onload nên có dữ liệu tức thì 100%, không bao giờ bị rỗng/trong suốt.
 */
export function createFarmPinCanvasSync(
  subType: FarmSubType | 'hub',
  isSelected = false,
  pixelScale = 2
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
  ctx.save();
  ctx.scale(pixelScale, pixelScale);

  const borderColor =
    subType === 'chicken'
      ? '#fb923c'
      : subType === 'pig'
      ? '#fb7185'
      : subType === 'hub'
      ? '#2b8fd0'
      : '#14b8a6';

  // Vòng hào quang vàng cho Nhà máy trung tâm hoặc điểm đang chọn
  if (isSelected || subType === 'hub') {
    ctx.save();
    ctx.strokeStyle = subType === 'hub' ? '#38bdf8' : '#facc15';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(32, 24, 22.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 1. Mũi ghim tam giác chạm đúng điểm đáy chính giữa (32, 63.6)
  ctx.save();
  ctx.fillStyle = borderColor;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(23.8, 40.5);
  ctx.lineTo(32.0, 63.6);
  ctx.lineTo(40.2, 40.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 2. Vòng tròn nền trắng viền màu nổi bật
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 4.4;
  ctx.beginPath();
  ctx.arc(32, 24, 19.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 3. Biểu tượng bên trong (Gà / Heo / Nhà máy / Văn phòng / Kho / Rửa xe / Khác)
  drawInnerPictogram2D(ctx, subType);

  // 4. Chấm tâm nhỏ ngay đúng đỉnh mũi ghim (32, 62.8)
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(32, 62.8, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  const imageData = ctx.getImageData(0, 0, physicalSize, physicalSize);
  return { canvas, imageData };
}

/**
 * Tạo texture chấm tròn phát sáng (glowing particle) đồng bộ bằng Canvas 2D
 * dùng cho luồng chấm sáng cung ứng chạy một chiều từ Nhà máy -> Trại Gà / Trại Heo
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

/**
 * Đăng ký ĐỒNG BỘ 100% một ảnh icon vào MapLibre GL (tức thì, không bất đồng bộ)
 * Hỗ trợ cả tên 'marker-chicken' / 'marker-pig' / 'marker-other' / 'marker-factory'
 * lẫn 'farm-icon-chicken' / 'farm-icon-pig' / 'farm-icon-other' / 'farm-icon-hub' / ...
 */
export function addSingleFarmIconToMap(
  map: maplibregl.Map,
  imageId: string
): void {
  try {
    if (map.hasImage(imageId)) return;

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
      const { imageData } = createFarmPinCanvasSync(st, st === 'hub', 2);
      map.addImage(imageId, imageData, { pixelRatio: 2 });
      return;
    }

    if (!imageId.startsWith('farm-icon-')) return;
    const rawType = imageId.replace('farm-icon-', '') as FarmSubType | 'hub';
    const st: FarmSubType | 'hub' = VALID_SUBTYPES.includes(rawType)
      ? rawType
      : 'other';

    const { imageData } = createFarmPinCanvasSync(st, st === 'hub', 2);
    map.addImage(imageId, imageData, { pixelRatio: 2 });
  } catch {
    // Bỏ qua an toàn nếu bản đồ đang chuyển style
  }
}

/**
 * Đăng ký ĐỒNG BỘ toàn bộ bộ ảnh icon + hạt phát sáng vào MapLibre GL ngay lập tức
 * khi `map.on('load')` và `map.on('style.load')`.
 */
export function registerMapLibreFarmIcons(map: maplibregl.Map): void {
  for (const st of VALID_SUBTYPES) {
    addSingleFarmIconToMap(map, `farm-icon-${st}`);
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
 * 1. Trụ sở chính Công ty Thái Việt Corporation (tên chứa "tru so" / "cong ty" / "thai viet corporation")
 * 2. Văn phòng miền Nam (tên chứa "van phong mien nam" / "vp mien nam", sau đó đến các văn phòng khác)
 * 3. Nhà máy trung tâm (Nhà máy trung tâm Thái Việt — luôn nằm ở nhóm đầu để dễ bấm kích hoạt luồng độ phủ)
 * 4. Kho heo trung tâm (tên chứa "kho heo trung tam", sau đó đến các kho khác)
 * 5. Các trại heo (toàn bộ trại thuộc nhóm heo)
 * 6. Các trại gà (toàn bộ trại thuộc nhóm gà)
 * 7. Các điểm còn lại & cuối cùng là các điểm rửa xe ("rua xe" / "diem rua" / "tram rua" / "sat khuan")
 */
function getDropdownPriorityRank(item: DropdownLocationItem): {
  group: number;
  subRank: number;
  groupLabel: string;
} {
  const normName = normalizeMatchText(item.name || '');
  const normAll = normalizeMatchText(`${item.type || ''} ${item.name || ''}`);
  const paddedAll = ` ${normAll} `;

  // 3. Nhà máy trung tâm Thái Việt (isHub === true)
  if (item.isHub || item.category === 'hub') {
    return {
      group: 3,
      subRank: 0,
      groupLabel: 'Nhà máy trung tâm',
    };
  }

  // Kiểm tra điểm rửa xe trước để không bị lọt nhầm vào nhóm trên
  const isWashPoint =
    item.subType === 'wash' ||
    normAll.includes('rua xe') ||
    normAll.includes('diem rua') ||
    normAll.includes('tram rua') ||
    normAll.includes('sat khuan') ||
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
    normName.includes('cong ty') ||
    normName.includes('thai viet corporation')
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

  // Nếu là điểm nhà máy khác trong dữ liệu KML
  if (normAll.includes('nha may trung tam') || normName.includes('nha may')) {
    return {
      group: 3,
      subRank: 1,
      groupLabel: 'Nhà máy trung tâm',
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


