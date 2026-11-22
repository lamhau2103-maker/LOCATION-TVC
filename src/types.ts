export type FarmCategory = 'chicken' | 'pig' | 'other';

export type FarmSubType =
  | 'chicken'
  | 'pig'
  | 'office'
  | 'warehouse'
  | 'wash'
  | 'other';

export type IconChoice = 'chicken' | 'pig' | 'auto';

export type FarmIconOverrides = Record<string, 'chicken' | 'pig'>;

export type FarmStatus = 'active' | 'warning' | 'isolated';

export type AppStage = 'loading' | 'globe' | 'map';

export type MapStyleMode = 'satellite' | 'street';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

export interface Farm {
  id: string;
  name: string;
  /** Tên loại hiển thị gốc (ví dụ: "Trại gà", "Trại heo", hoặc tên Folder trong KML) */
  type: string;
  /** Nhóm phân loại màu: chicken (cam #fb923c), pig (san hô #fb7185), other (xanh ngọc #14b8a6) */
  category: FarmCategory;
  /** Nhóm biểu tượng chi tiết (chicken, pig, office, warehouse, wash, other) */
  subType?: FarmSubType;
  /** Có được nối đường vệt sáng từ Nhà máy Trung tâm hay không */
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
}

export interface CentralHub {
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
