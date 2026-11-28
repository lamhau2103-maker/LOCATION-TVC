export type MaritimeLabelKind = 'archipelago' | 'sea' | 'island';

export interface VietnamSovereigntyLabel {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: MaritimeLabelKind;
}

export interface VietnamArchipelagoIsland {
  id: string;
  name: string;
  archipelago: 'hoang-sa' | 'truong-sa' | 'island';
  lat: number;
  lng: number;
}

/**
 * Giới hạn vùng Biển Đông & lãnh thổ Việt Nam để người dùng có thể phóng to / thu nhỏ
 * và kéo tự do trên toàn vùng biển (kinh độ 101.0°E – 119.5°E, vĩ độ 5.5°N – 24.0°N).
 */
export const VIETNAM_EAST_SEA_BOUNDS = {
  west: 101.0,
  south: 5.5,
  east: 119.5,
  north: 24.0,
} as const;

/**
 * Đường ranh giới vùng biển chủ quyền Việt Nam trên Biển Đông:
 * Từ Vịnh Bắc Bộ -> bao trọn Quần đảo Hoàng Sa (~111°E–113°E, 15°45'N–17°15'N)
 * -> bao trọn Quần đảo Trường Sa (~111°30'E–117°40'E, 6°30'N–12°00'N)
 * -> vùng biển Tây Nam (Côn Đảo, Thổ Chu, Phú Quốc, Vịnh Thái Lan).
 */
export const VIETNAM_MARITIME_SEA_PERIMETER: Array<[number, number]> = [
  [108.05, 21.5], // Móng Cái / Trà Cổ
  [107.75, 21.05], // Vịnh Bắc Bộ
  [107.45, 20.45],
  [107.3, 19.75],
  [107.6, 18.95],
  [108.05, 18.15],
  [108.55, 17.5],
  [109.75, 17.38],
  [111.2, 17.58], // Phía Bắc Quần đảo Hoàng Sa
  [112.95, 17.55],
  [113.68, 17.0], // Phía Đông Quần đảo Hoàng Sa
  [113.72, 15.85],
  [113.2, 15.05], // Phía Nam Quần đảo Hoàng Sa
  [113.05, 14.05],
  [114.2, 13.05],
  [116.1, 12.65],
  [117.75, 12.25], // Phía Bắc - Đông Quần đảo Trường Sa
  [118.25, 11.2],
  [118.3, 9.55],
  [117.75, 8.05],
  [116.55, 6.75], // Phía Đông Nam Quần đảo Trường Sa
  [114.7, 6.18],
  [112.1, 6.22],
  [110.1, 6.6],
  [108.35, 7.18], // Vùng biển Đông Nam Bộ
  [106.45, 7.58], // Phía Nam Côn Đảo
  [104.85, 7.78], // Phía Nam Mũi Cà Mau
  [103.4, 8.65],
  [102.92, 9.25], // Phía Tây Thổ Chu
  [103.28, 10.02], // Phía Tây Phú Quốc
  [103.78, 10.45],
  [104.42, 10.38], // Vùng biển Hà Tiên
];

const VIETNAM_COASTAL_RETURN: Array<[number, number]> = [
  [104.88, 10.02], // Rạch Giá
  [104.78, 9.18], // Cà Mau
  [105.16, 8.58], // Mũi Cà Mau
  [106.25, 9.4], // Trà Vinh / Sóc Trăng
  [107.08, 10.34], // Vũng Tàu
  [108.12, 10.92], // Phan Thiết
  [109.2, 11.9], // Cam Ranh
  [109.32, 13.08], // Tuy Hòa
  [109.24, 13.78], // Quy Nhơn
  [108.95, 15.12], // Quảng Ngãi
  [108.22, 16.08], // Đà Nẵng
  [107.65, 16.7], // Huế
  [106.63, 17.48], // Đồng Hới
  [105.78, 18.75], // Vinh
  [105.92, 19.75], // Thanh Hóa
  [106.75, 20.82], // Hải Phòng
  [107.45, 21.15], // Hạ Long
  [108.05, 21.5], // Đóng vòng tại Móng Cái
];

export const VIETNAM_MARITIME_POLYGON_RING: Array<[number, number]> = [
  ...VIETNAM_MARITIME_SEA_PERIMETER,
  ...VIETNAM_COASTAL_RETURN,
];

export const VIETNAM_MARITIME_POLYGON_FEATURE = {
  type: 'Feature' as const,
  properties: {
    id: 'vietnam-maritime-zone',
    name: 'Vùng biển chủ quyền Việt Nam',
  },
  geometry: {
    type: 'Polygon' as const,
    coordinates: [VIETNAM_MARITIME_POLYGON_RING],
  },
};

export const VIETNAM_MARITIME_ZONE_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [
    VIETNAM_MARITIME_POLYGON_FEATURE,
    {
      type: 'Feature' as const,
      properties: {
        id: 'vietnam-maritime-sea-border',
        name: 'Ranh giới vùng biển Việt Nam',
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: VIETNAM_MARITIME_SEA_PERIMETER,
      },
    },
  ],
};

export const VIETNAM_MARITIME_BOUNDARY_PATH = {
  id: 'vietnam-maritime-sea-border-globe',
  coords: VIETNAM_MARITIME_SEA_PERIMETER,
};

export const VIETNAM_SOVEREIGNTY_LABELS: VietnamSovereigntyLabel[] = [
  {
    id: 'sovereignty-hoang-sa',
    name: 'Quần đảo Hoàng Sa (Việt Nam)',
    lat: 16.5,
    lng: 112.0,
    kind: 'archipelago',
  },
  {
    id: 'sovereignty-truong-sa',
    name: 'Quần đảo Trường Sa (Việt Nam)',
    lat: 10.0,
    lng: 114.0,
    kind: 'archipelago',
  },
  {
    id: 'sovereignty-bien-dong',
    name: 'Biển Đông',
    lat: 13.8,
    lng: 111.0,
    kind: 'sea',
  },
  {
    id: 'sovereignty-phu-quoc',
    name: 'Đảo Phú Quốc',
    lat: 10.22,
    lng: 103.96,
    kind: 'island',
  },
  {
    id: 'sovereignty-con-dao',
    name: 'Côn Đảo',
    lat: 8.69,
    lng: 106.61,
    kind: 'island',
  },
];

export const VIETNAM_ARCHIPELAGO_ISLANDS: VietnamArchipelagoIsland[] = [
  // Quần đảo Hoàng Sa (Việt Nam)
  {
    id: 'hs-phu-lam',
    name: 'Đảo Phú Lâm',
    archipelago: 'hoang-sa',
    lat: 16.835,
    lng: 112.338,
  },
  {
    id: 'hs-hoang-sa',
    name: 'Đảo Hoàng Sa',
    archipelago: 'hoang-sa',
    lat: 16.535,
    lng: 111.61,
  },
  {
    id: 'hs-linh-con',
    name: 'Đảo Linh Côn',
    archipelago: 'hoang-sa',
    lat: 16.665,
    lng: 112.735,
  },
  {
    id: 'hs-tri-ton',
    name: 'Đảo Tri Tôn',
    archipelago: 'hoang-sa',
    lat: 15.785,
    lng: 111.203,
  },
  {
    id: 'hs-bach-quy',
    name: 'Đảo Bạch Quy',
    archipelago: 'hoang-sa',
    lat: 16.048,
    lng: 112.442,
  },
  // Quần đảo Trường Sa (Việt Nam)
  {
    id: 'ts-song-tu-tay',
    name: 'Đảo Song Tử Tây',
    archipelago: 'truong-sa',
    lat: 11.429,
    lng: 114.331,
  },
  {
    id: 'ts-thi-tu',
    name: 'Đảo Thị Tứ',
    archipelago: 'truong-sa',
    lat: 11.053,
    lng: 114.285,
  },
  {
    id: 'ts-nam-yet',
    name: 'Đảo Nam Yết',
    archipelago: 'truong-sa',
    lat: 10.179,
    lng: 114.365,
  },
  {
    id: 'ts-sinh-ton',
    name: 'Đảo Sinh Tồn',
    archipelago: 'truong-sa',
    lat: 9.885,
    lng: 114.329,
  },
  {
    id: 'ts-truong-sa-lon',
    name: 'Đảo Trường Sa Lớn',
    archipelago: 'truong-sa',
    lat: 8.644,
    lng: 111.919,
  },
  {
    id: 'ts-phan-vinh',
    name: 'Đảo Phan Vinh',
    archipelago: 'truong-sa',
    lat: 8.972,
    lng: 113.686,
  },
  {
    id: 'ts-an-bang',
    name: 'Đảo An Bang',
    archipelago: 'truong-sa',
    lat: 7.892,
    lng: 112.905,
  },
  {
    id: 'ts-tien-nu',
    name: 'Đảo Tiên Nữ',
    archipelago: 'truong-sa',
    lat: 8.842,
    lng: 114.618,
  },
];

export const VIETNAM_SOVEREIGNTY_LABELS_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: VIETNAM_SOVEREIGNTY_LABELS.map((item) => ({
    type: 'Feature' as const,
    properties: {
      id: item.id,
      name: item.name,
      kind: item.kind,
    },
    geometry: {
      type: 'Point' as const,
      coordinates: [item.lng, item.lat] as [number, number],
    },
  })),
};

export const VIETNAM_ARCHIPELAGO_ISLANDS_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: VIETNAM_ARCHIPELAGO_ISLANDS.map((island) => ({
    type: 'Feature' as const,
    properties: {
      id: island.id,
      name: island.name,
      archipelago: island.archipelago,
    },
    geometry: {
      type: 'Point' as const,
      coordinates: [island.lng, island.lat] as [number, number],
    },
  })),
};
