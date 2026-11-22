import * as maplibregl from 'maplibre-gl';
import { FarmCategory } from '../types';

/**
 * MODULE BỘ ICON TRANG TRẠI (src/utils/icons.ts)
 * - Vẽ icon Gà (cam #fb923c, mào đỏ #ef4444), Heo (san hô #fb7185, mũi và tai rõ),
 *   và Nhà trại mặc định (xanh ngọc #14b8a6) bằng SVG tự tạo nét dày, nhìn rõ ở cỡ 32px.
 * - Tạo khoá ổn định farm_key = "lat.toFixed(5),lng.toFixed(5)"
 * - Quy tắc xác định icon 3 tầng ưu tiên (Lựa chọn thủ công trên server -> Từ khoá -> Mặc định nhà trại)
 * - Vẽ SVG ra Canvas / ImageData để đăng ký ảnh cho MapLibre (map.addImage)
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
    description: 'Tự nhận diện theo tên & mô tả',
  },
];

/**
 * Tạo khoá định danh ổn định cho từng trang trại:
 * vĩ độ và kinh độ làm tròn 5 chữ số thập phân, ghép dạng "lat,lng" (ví dụ "10.96540,107.01280")
 */
export function getFarmKey(lat: number, lng: number): string {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

/**
 * Bỏ dấu tiếng Việt để so khớp từ khoá chính xác cả khi có dấu hoặc không dấu
 */
function stripAccents(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * QUY TẮC XÁC ĐỊNH ICON (ưu tiên từ trên xuống):
 * 1. Lựa chọn thủ công đã lưu trên server ("chicken" hoặc "pig")
 * 2. Nếu chưa có hoặc là "Tự động": tìm từ khoá trong tên layer/folder My Maps, tên điểm, mô tả:
 *    - có "gà", "chicken", "poultry" -> icon gà ('chicken')
 *    - có "heo", "lợn", "pig", "swine" -> icon heo ('pig')
 * 3. Không nhận ra -> icon mặc định hình ngôi nhà trại ('other', tông xanh ngọc #14b8a6)
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

  const rawText = `${farm.type || ''} ${farm.name || ''} ${
    farm.description || ''
  }`;
  const lower = rawText.toLowerCase().normalize('NFC');
  const ascii = stripAccents(rawText);

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
 * Trả về chuỗi SVG tự tạo (rõ nét ở cỡ 32px, nét dày dễ thương):
 * - chicken: Gà tông cam #fb923c, mào đỏ #ef4444, mỏ vàng, mắt đen rõ nét
 * - pig: Heo tông hồng san hô #fb7185, hai tai cụp và chiếc mũi hồng có 2 lỗ mũi rõ nét
 * - other: Ngôi nhà trang trại mái xanh ngọc #14b8a6
 */
export function getFarmIconSvg(
  category: FarmCategory,
  size = 32
): string {
  if (category === 'chicken') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${size}" height="${size}" fill="none">
      <!-- Mào gà đỏ rực phía trên -->
      <path d="M12.5 9.5C12.5 6.8 14.8 5.2 16.5 7.2C17.6 4.8 20.8 4.8 21.4 7.5C23.5 6.4 25.5 8.5 23.8 10.8Z" fill="#ef4444" stroke="#b91c1c" stroke-width="1.6" stroke-linejoin="round"/>
      <!-- Thân/Đầu gà tròn cam #fb923c -->
      <circle cx="17.5" cy="19.5" r="10.5" fill="#fb923c" stroke="#9a3412" stroke-width="2.2"/>
      <!-- Má hồng nhẹ -->
      <circle cx="13.5" cy="21.5" r="2.1" fill="#ef4444" fill-opacity="0.45"/>
      <!-- Cánh gà -->
      <path d="M10.5 19.5C10.5 17 13 17 14 19.5C15 22 12 24 10.5 22Z" fill="#fdba74" stroke="#9a3412" stroke-width="1.8" stroke-linejoin="round"/>
      <!-- Mắt gà to rõ -->
      <circle cx="20.8" cy="16.8" r="2.1" fill="#1e293b"/>
      <circle cx="21.4" cy="16.1" r="0.7" fill="#ffffff"/>
      <!-- Mỏ gà vàng tươi & Yếm đỏ dưới mỏ -->
      <path d="M27.2 17.2L32.2 19.2L27.2 21.4Z" fill="#facc15" stroke="#9a3412" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M25.8 21.4C27.2 21.4 27.6 24.4 25.5 24.6C23.8 24.8 24.2 21.4 25.8 21.4Z" fill="#ef4444"/>
    </svg>`;
  }

  if (category === 'pig') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${size}" height="${size}" fill="none">
      <!-- Hai tai heo hồng san hô rõ nét -->
      <path d="M7.5 14.5L5.2 6.5L13.5 9.2Z" fill="#f43f5e" stroke="#881337" stroke-width="2.1" stroke-linejoin="round"/>
      <path d="M28.5 14.5L30.8 6.5L22.5 9.2Z" fill="#f43f5e" stroke="#881337" stroke-width="2.1" stroke-linejoin="round"/>
      <!-- Khuôn mặt heo tròn hồng san hô #fb7185 -->
      <circle cx="18" cy="19.5" r="11" fill="#fb7185" stroke="#881337" stroke-width="2.2"/>
      <!-- Hai mắt heo -->
      <circle cx="13.2" cy="16.2" r="2" fill="#1e293b"/>
      <circle cx="13.7" cy="15.6" r="0.65" fill="#ffffff"/>
      <circle cx="22.8" cy="16.2" r="2" fill="#1e293b"/>
      <circle cx="23.3" cy="15.6" r="0.65" fill="#ffffff"/>
      <!-- Chiếc mũi heo bầu dục nổi bật với 2 lỗ mũi rõ -->
      <rect x="11.8" y="19.5" width="12.4" height="7.6" rx="3.8" fill="#ffe4e6" stroke="#881337" stroke-width="2"/>
      <ellipse cx="15.6" cy="23.3" rx="1.35" ry="1.8" fill="#be123c"/>
      <ellipse cx="20.4" cy="23.3" rx="1.35" ry="1.8" fill="#be123c"/>
    </svg>`;
  }

  // Mặc định: Ngôi nhà trang trại xanh ngọc #14b8a6
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${size}" height="${size}" fill="none">
    <!-- Mái nhà trại 2 tầng -->
    <path d="M5 17.5L18 7L31 17.5H27.5V28.5H8.5V17.5H5Z" fill="#14b8a6" stroke="#115e59" stroke-width="2.2" stroke-linejoin="round"/>
    <!-- Khung chữ X cửa chuồng trại màu trắng -->
    <rect x="13.2" y="18.2" width="9.6" height="10.3" rx="1.2" fill="#ccfbf1" stroke="#115e59" stroke-width="1.8"/>
    <path d="M13.5 18.5L22.5 28.2M22.5 18.5L13.5 28.2" stroke="#0f766e" stroke-width="1.6" stroke-linecap="round"/>
    <!-- Ô thông gió tròn trên mái -->
    <circle cx="18" cy="13.5" r="2.1" fill="#ffffff" stroke="#115e59" stroke-width="1.6"/>
  </svg>`;
}

/**
 * Tạo chuỗi SVG Huy hiệu Ghim Nổi hoàn chỉnh (có nền tròn trắng, viền màu theo loại và bóng đổ mềm dưới đất)
 * Dùng để vẽ ra Canvas / ImageData cho MapLibre symbol layer (map.addImage)
 */
function getMapLibrePinSvg(category: FarmCategory): string {
  const borderColor =
    category === 'chicken'
      ? '#fb923c'
      : category === 'pig'
      ? '#fb7185'
      : '#14b8a6';
  const innerSvg = getFarmIconSvg(category, 30)
    .replace(/<svg[^>]*>/, '<g transform="translate(17, 11)">')
    .replace(/<\/svg>/, '</g>');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 76" width="64" height="76" fill="none">
    <!-- Bóng mềm dưới mặt đất -->
    <ellipse cx="32" cy="70" rx="14" ry="4.2" fill="#0f2a24" fill-opacity="0.34"/>
    <!-- Mũi ghim tam giác -->
    <path d="M25 48L32 61L39 48Z" fill="${borderColor}"/>
    <!-- Vòng tròn trắng viền màu nổi bật -->
    <circle cx="32" cy="27" r="23" fill="#ffffff" stroke="${borderColor}" stroke-width="4.5"/>
    ${innerSvg}
  </svg>`;
}

/**
 * Chuyển chuỗi SVG thành đối tượng ImageData để gọi `map.addImage(id, imageData)`
 */
export function renderSvgToImageData(
  svgString: string,
  width = 64,
  height = 76
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
 * Đăng ký cả 3 ảnh icon ('farm-icon-chicken', 'farm-icon-pig', 'farm-icon-other')
 * vào thực thể bản đồ MapLibre GL bằng `map.addImage`
 */
export async function registerMapLibreFarmIcons(
  map: maplibregl.Map
): Promise<void> {
  const categories: FarmCategory[] = ['chicken', 'pig', 'other'];
  await Promise.all(
    categories.map(async (cat) => {
      const imageId = `farm-icon-${cat}`;
      if (map.hasImage(imageId)) return;
      try {
        const svg = getMapLibrePinSvg(cat);
        const imageData = await renderSvgToImageData(svg, 64, 76);
        if (!map.hasImage(imageId)) {
          map.addImage(imageId, imageData, { pixelRatio: 1.4 });
        }
      } catch {
        // Bỏ qua an toàn nếu bản đồ đã huỷ giữa chừng
      }
    })
  );
}
