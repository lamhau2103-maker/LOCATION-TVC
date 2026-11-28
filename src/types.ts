export type FarmCategory = 'chicken' | 'pig' | 'other';

export type FarmSubType =
  | 'chicken'
  | 'pig'
  | 'hub'
  | 'office'
  | 'warehouse'
  | 'wash'
  | 'other';

export type IconChoice = 'chicken' | 'pig' | 'auto';

export type FarmIconOverrides = Record<string, 'chicken' | 'pig'>;

export type FarmCustomLabels = Record<string, string>;

export type FarmStatus = 'active' | 'warning' | 'isolated';

export type AppStage = 'loading' | 'globe' | 'map';

export type MapStyleMode = 'street' | 'terrain' | 'satellite';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

export interface Farm {
  id: string;
  name: string;
  /** Tên loại hiển thị gốc (ví dụ: "Trại gà", "Trại heo", hoặc tên Folder trong KML) */
  type: string;
  /** Nhóm phân loại màu: chicken (cam #fb923c), pig (san hô #fb7185), other (xanh ngọc #14b8a6) */
  category: FarmCategory;
  /** Nhóm biểu tượng chi tiết (chicken, pig, hub, office, warehouse, wash, other) */
  subType?: FarmSubType;
  /** Có phải là Nhà Máy Cám (tâm phát đốm sáng cung ứng) từ dữ liệu Google My Maps hay không */
  isFeedMill?: boolean;
  /** Có được nối đường vệt sáng từ Nhà Máy Cám hay không */
  isConnectable?: boolean;
  /** Trạng thái vận hành: active (hoạt động), warning (cảnh báo), isolated (cách ly) */
  status: FarmStatus;
  lat: number;
  lng: number;
  description: string;
  /** Đường dẫn ảnh trang trại nếu dữ liệu KML/CSV có đính kèm */
  imageUrl?: string;
  /** Các thuộc tính mở rộng đọc từ <ExtendedData> của KML hoặc các cột phụ của CSV */
  extendedData?: Record<string, string | undefined>;
  /** Khoá toạ độ ổn định "lat.toFixed(5),lng.toFixed(5)" - CHỈ dùng để định danh, không dùng để vẽ */
  farmKey?: string;
  /** Lựa chọn icon thủ công của Quản trị viên (chicken | pig | auto) */
  manualIcon?: IconChoice;
  /** Nhãn mô tả tùy chỉnh của Quản trị viên (lưu trên Upstash Redis) */
  customLabel?: string;
}

export interface CentralHub {
  id?: string;
  farmKey?: string;
  name: string;
  subtitle: string;
  lat: number;
  lng: number;
  address: string;
}

export interface ParseResult {
  farms: Farm[];
  skippedCount: number;
  sourceName: string;
  warnings: string[];
}

export interface SyncState {
  isSyncing: boolean;
  lastSyncedTime: string | null;
  isOfflineFallback: boolean;
  statusText: string;
}

export interface PositionDiagnosticItem {
  id: string;
  name: string;
  isHub?: boolean;
  category: FarmCategory | 'hub';
  rawLat: number;
  rawLng: number;
  renderedLat: number;
  renderedLng: number;
  deviationMeters: number;
  isAccurate: boolean;
}

export interface ArcColorConfig {
  chicken: { from: string; to: string };
  pig: { from: string; to: string };
}

export interface DrivingRouteResult {
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export interface CachedDrivingEntry extends DrivingRouteResult {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  status: 'ok' | 'unavailable';
  updatedAt: number;
}

export type DrivingDistanceCache = Record<string, CachedDrivingEntry>;

export interface DisinfectionRouteConfig {
  targetFarmKeys: string[];
  fromColor: string;
  toColor: string;
}

export type DisinfectionRoutesMap = Record<string, DisinfectionRouteConfig>;

