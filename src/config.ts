import { FarmCategory, FarmStatus, TimeOfDay } from './types';

/**
 * ============================================================================
 * CÁC HẰNG SỐ CẤU HÌNH DỄ TINH CHỈNH (BẢN ĐỒ, ĐƯỜNG CUNG & RESPONSIVE)
 * ============================================================================
 */
// Độ dày cơ bản (px) của đường cung kết nối Nhà Máy Cám -> Trại Gà / Trại Heo (mảnh hơn 50-60% so với bản cũ)
export const ARC_LINE_WEIGHT = 2;

// Hằng số cấu hình: có tự động mở bảng Nhà Máy Cám khi bay vào từ quả cầu 3D hay không
export const OPEN_FACTORY_CARD_ON_ENTER = false;

// Hằng số cấu hình camera khi chọn / bay về FEED FACTORY (Nhà Máy Cám)
export const FACTORY_FOCUS_ZOOM = 8.5;
export const FACTORY_FLY_DURATION_MS = 1400;

// Cấu hình tốc độ & độ mượt zoom trên Bản đồ 2D (tương đương zoomSnap / wheelPxPerZoomLevel trên MapLibre GL)
export const MAP_ZOOM_CONFIG = {
  wheelZoomRate: 1 / 650, // Giảm tốc độ cuộn chuột (mặc định MapLibre 1/450 -> mượt & ít giật hơn)
  trackpadZoomRate: 1 / 140, // Mượt khi pinch trackpad / touch
  flyToDurationMs: 1550, // Thời lượng bay mượt tới trại
  overviewDurationMs: 1650, // Thời lượng bay về toàn cảnh
  zoomButtonStep: 1.0, // Bước zoom cho nút +/-
  zoomButtonDurationMs: 320,
} as const;

// Cấu hình cache & preload tile nền chống chớp trắng / xám khi zoom nhỏ
export const MAP_TILE_PRELOAD_CONFIG = {
  maxTileCacheSize: 1024, // Giữ tối đa 1024 tile trong bộ nhớ đệm GPU/RAM
  maxTileCacheZoomLevels: 12, // Giữ tile ở nhiều mức zoom cha/con để không bị trống khi zoom nhanh
  preloadTileCount: 8, // Số lượng tile mức zoom lân cận (z-1, z+1) preload nhẹ trong nền
  rasterFadeDurationMs: 220, // Thời gian cross-fade khi tile mới xuất hiện (ms)
  basemapCrossfadeMs: 320, // Thời gian chuyển mượt giữa 3 nền Đường / Địa hình / Vệ tinh (ms)
  moveThrottleMs: 120, // Chu kỳ throttle khi pan/zoom để giảm tải CPU
  groundColorStreet: '#f2efe9', // Nền đất trung tính đồng màu bản đồ đường (không trắng gắt / không xám đen)
  groundColorTerrain: '#e8efe2', // Nền xanh lá nhạt đồng màu bản đồ địa hình
  groundColorSatellite: '#1e293b', // Nền trầm đồng màu ảnh vệ tinh
} as const;

// Breakpoint responsive chuẩn cho mọi thiết bị (320px -> 4K)
export const RESPONSIVE_BREAKPOINTS = {
  mobileMax: 639, // < 640px: Điện thoại dọc
  tabletMax: 1023, // 640px – 1023px: Tablet & điện thoại ngang rộng
  desktopLargeMin: 1536, // >= 1536px: Màn hình lớn / 2K / 4K
  landscapeShortMaxHeight: 500, // Điện thoại xoay ngang (chiều cao thấp)
  hudMaxWidthPx: 1680, // Chiều rộng tối đa khung HUD trên màn hình siêu rộng 2K/4K
} as const;

/**
 * FILE CẤU HÌNH HỆ THỐNG TRANG TRẠI (src/config.ts)
 * Thương hiệu: Công Ty Cổ Phần Thái Việt Corporation
 * Màu nhấn thương hiệu: Xanh dương hoa sen #2b8fd0, Đỏ #d9261c
 * Bảng màu giao diện sáng: kính trắng mờ rgba(255,255,255,0.75), chữ #0f2a24,
 * xanh lá #10b981, xanh trời #0ea5e9, vàng nắng #facc15, san hô #fb7185, cam #fb923c.
 */
export const PRESET_LOCATION_LABELS: string[] = [
  'Trụ sở chính',
  'Văn phòng',
  'Nhà máy cám',
  'Kho trung tâm',
  'Trại heo',
  'Trại gà',
  'Điểm rửa xe',
  'Khác',
];

export const APP_CONFIG = {
  companyName: 'Công Ty Cổ Phần Thái Việt Corporation',
  documentTitle: 'LOCATION THAI VIET CORPORATION',
  companyTagline: 'HỆ THỐNG TRANG TRẠI CHĂN NUÔI SINH THÁI & AN TOÀN SINH HỌC 3D',
  companyVersion: 'NỀN TẢNG BẢN ĐỒ ĐỊA HÌNH 3D & ĐỒNG BỘ GOOGLE MY MAPS',

  // Đường dẫn logo chính thức trong thư mục public/logo.png
  logoUrl: '/logo.png',

  // Bán kính an toàn sinh học mặc định (đơn vị: mét)
  defaultBiosecurityRadiusMeters: 500,
  minBiosecurityRadiusMeters: 100,
  maxBiosecurityRadiusMeters: 3000,

  // Bảng màu thương hiệu & giao diện sáng tươi
  colors: {
    brandBlue: '#2b8fd0',
    brandRed: '#d9261c',
    textPrimary: '#0f2a24',
    emerald: '#10b981',
    sky: '#0ea5e9',
    sunYellow: '#facc15',
    sunYellowRgb: [250, 204, 21] as [number, number, number],
    emeraldRgb: [16, 185, 129] as [number, number, number],
    hubColor: '#2b8fd0',
    hubRgb: [43, 143, 208] as [number, number, number],
    categories: {
      chicken: {
        label: 'Trại gà',
        hex: '#fb923c', // Cam tươi
        rgb: [251, 146, 60] as [number, number, number],
        glow: 'rgba(251, 146, 60, 0.35)',
        softBg: 'rgba(251, 146, 60, 0.14)',
      },
      pig: {
        label: 'Trại heo',
        hex: '#fb7185', // San hô
        rgb: [251, 113, 133] as [number, number, number],
        glow: 'rgba(251, 113, 133, 0.35)',
        softBg: 'rgba(251, 113, 133, 0.14)',
      },
      other: {
        label: 'Trang trại khác',
        hex: '#14b8a6', // Xanh ngọc
        rgb: [20, 184, 166] as [number, number, number],
        glow: 'rgba(20, 184, 166, 0.35)',
        softBg: 'rgba(20, 184, 166, 0.14)',
      },
    },
    statuses: {
      active: {
        label: 'Hoạt động tốt',
        color: '#10b981',
        sonarDuration: '2.6s',
        pulseDuration: '2.4s',
      },
      warning: {
        label: 'Cảnh báo sinh học',
        color: '#f59e0b',
        sonarDuration: '1.3s',
        pulseDuration: '1.1s',
      },
      isolated: {
        label: 'Đang cách ly',
        color: '#d9261c',
        sonarDuration: '0.8s',
        pulseDuration: '0.7s',
      },
    },
  },

  // Cấu hình 4 mốc ánh sáng & bầu trời trong ngày (nội suy mượt trong 2 giây)
  timePresets: {
    dawn: {
      label: 'Bình minh',
      skyColor: '#fda4af',
      horizonColor: '#fef3c7',
      fogColor: '#fde68a',
      lightColor: '#fdba74',
      lightIntensity: 0.62,
      lightPosition: [1.5, 82, 74] as [number, number, number],
      ambientTint: 'rgba(251, 146, 60, 0.08)',
    },
    day: {
      label: 'Ban ngày',
      skyColor: '#38bdf8',
      horizonColor: '#f0f9ff',
      fogColor: '#e0f2fe',
      lightColor: '#ffffff',
      lightIntensity: 0.55,
      lightPosition: [1.3, 145, 58] as [number, number, number],
      ambientTint: 'rgba(14, 165, 233, 0.02)',
    },
    dusk: {
      label: 'Hoàng hôn',
      skyColor: '#a855f7',
      horizonColor: '#fb923c',
      fogColor: '#fed7aa',
      lightColor: '#fb923c',
      lightIntensity: 0.65,
      lightPosition: [1.6, 265, 76] as [number, number, number],
      ambientTint: 'rgba(249, 115, 22, 0.12)',
    },
    night: {
      label: 'Đêm',
      skyColor: '#0f172a',
      horizonColor: '#1e293b',
      fogColor: '#0f172a',
      lightColor: '#93c5fd',
      lightIntensity: 0.35,
      lightPosition: [1.4, 210, 62] as [number, number, number],
      ambientTint: 'rgba(15, 23, 42, 0.38)',
    },
  } satisfies Record<
    TimeOfDay,
    {
      label: string;
      skyColor: string;
      horizonColor: string;
      fogColor: string;
      lightColor: string;
      lightIntensity: number;
      lightPosition: [number, number, number];
      ambientTint: string;
    }
  >,

  // Khoá lưu trữ dữ liệu trong localStorage & sessionStorage
  storageKey: 'thaiviet_corp_farms_v1',
  lastSyncStorageKey: 'thaiviet_corp_last_sync_v1',
  myMapsIdStorageKey: 'thaiviet_corp_mymaps_id_v1',
  myMapsLinkStorageKey: 'thaiviet_corp_mymaps_link_v1',
  customLogoStorageKey: 'thaiviet_corp_custom_logo_v1',
  iconOverridesStorageKey: 'thaiviet_corp_icon_overrides_v1',
  customLabelsStorageKey: 'thaiviet_corp_custom_labels_v1',
  adminSessionStorageKey: 'thaiviet_corp_admin_session_v1',
  userPrefsStorageKey: 'thaiviet_corp_user_prefs_v1',

  // Danh sách từ khoá LOẠI TRỪ (không nối đường từ Nhà máy Trung tâm & không tự động gán icon Gà/Heo)
  arcExcludeKeywords: [
    'kho',
    'van phong',
    'vp ',
    'office',
    'rua xe',
    'diem rua',
    'tram rua',
    'sat khuan',
    'sat trung',
    'nha may',
    'factory',
    'warehouse',
    'bao ve',
    'cong ty',
  ],

  // Danh sách từ khoá CHO PHÉP kết nối đường cung từ Nhà máy Trung tâm (chỉ nối tới Trại gà và Trại heo)
  arcIncludeKeywords: [
    'trai ga',
    'trai heo',
    'trang trai ga',
    'trang trai heo',
    'chicken farm',
    'pig farm',
    'poultry',
  ],
};

/**
 * Xác định mốc giờ trong ngày tự động theo giờ thực tế của thiết bị
 */
export function getAutoTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'dusk';
  return 'night';
}

/**
 * Tự động nhận diện nhóm phân loại (chicken | pig | other) từ chuỗi loại trang trại hoặc tên Folder KML
 */
export function detectFarmCategory(rawType: string, rawName = ''): FarmCategory {
  const combined = `${rawType} ${rawName}`.toLowerCase().normalize('NFC');

  if (
    combined.includes('gà') ||
    combined.includes('ga ') ||
    combined.endsWith(' ga') ||
    combined.includes('gia cầm') ||
    combined.includes('gia cam') ||
    combined.includes('chicken') ||
    combined.includes('poultry') ||
    combined.includes('broiler') ||
    combined.includes('layer')
  ) {
    return 'chicken';
  }

  if (
    combined.includes('heo') ||
    combined.includes('lợn') ||
    combined.includes('lon ') ||
    combined.includes('pig') ||
    combined.includes('swine') ||
    combined.includes('sow') ||
    combined.includes('nái') ||
    combined.includes('thịt')
  ) {
    return 'pig';
  }

  return 'other';
}

/**
 * Tự động nhận diện trạng thái hoạt động từ mô tả hoặc trường dữ liệu phụ
 */
export function detectFarmStatus(rawText = ''): FarmStatus {
  const normalized = rawText.toLowerCase().normalize('NFC');
  if (
    normalized.includes('cách ly') ||
    normalized.includes('cach ly') ||
    normalized.includes('isolated') ||
    normalized.includes('quarantine') ||
    normalized.includes('dịch')
  ) {
    return 'isolated';
  }
  if (
    normalized.includes('cảnh báo') ||
    normalized.includes('canh bao') ||
    normalized.includes('warning') ||
    normalized.includes('kiểm tra')
  ) {
    return 'warning';
  }
  return 'active';
}

export const ARC_EXCLUDE_KEYWORDS: string[] = APP_CONFIG.arcExcludeKeywords;
export const ARC_INCLUDE_KEYWORDS: string[] = APP_CONFIG.arcIncludeKeywords;

export function getCategoryConfig(category: FarmCategory) {
  return APP_CONFIG.colors.categories[category] || APP_CONFIG.colors.categories.other;
}
