import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Clock,
  Compass,
  Feather,
  Globe2,
  Layers,
  Lock,
  LogOut,
  Map,
  Moon,
  Play,
  Radar,
  RefreshCw,
  Satellite,
  Search,
  ShieldCheck,
  Square,
  Sun,
  Sunrise,
  Sunset,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { APP_CONFIG } from '../config';
import {
  AppStage,
  CentralHub,
  Farm,
  FarmCategory,
  MapStyleMode,
  SyncState,
  TimeOfDay,
} from '../types';
import { calculateDistanceKm } from '../utils/geo';
import { CountUp } from './CountUp';
import { CuteCategoryIcon, PanelParticles } from './CursorSpotlight';

interface TopControlHUDProps {
  stage: AppStage;
  companyName: string;
  logoUrl: string;
  farms: Farm[];
  centralHub: CentralHub;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchSubmit: () => void;
  activeCategories: Record<FarmCategory, boolean>;
  onToggleCategory: (cat: FarmCategory) => void;
  biosecurityRadius: number;
  onRadiusChange: (r: number) => void;
  isTourRunning: boolean;
  tourIndex: number;
  tourTotal: number;
  onToggleTour: () => void;
  mapStyleMode: MapStyleMode;
  onToggleMapStyle: () => void;
  timeOfDay: TimeOfDay;
  isAutoTime: boolean;
  onSelectTimeOfDay: (t: TimeOfDay) => void;
  onToggleAutoTime: () => void;
  liteMode: boolean;
  onToggleLiteMode: () => void;
  syncState: SyncState;
  onSyncNow: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenImport: () => void;
  hasCustomData: boolean;
  onResetDefault: () => void;
  onFlyOverview: () => void;
  onBackToGlobe: () => void;
  onFlyToHub: () => void;
  isAdmin: boolean;
  isServerIconConnected: boolean;
  onOpenAdminLogin: () => void;
  onLogoutAdmin: () => void;
  onOpenBulkIconModal: () => void;
}

/**
 * BẢNG THỐNG KÊ & ĐIỀU KHIỂN GÓC TRÊN (HIỂN THỊ CẢ Ở ĐỊA CẦU XOAY VÀ BẢN ĐỒ)
 * - Góc trên bên trái: Logo nhỏ (cao 46px, chỉ cắt lấy ~78% phần hoa sen xanh dương phía trên)
 *   đặt trên khung kính trắng mờ + chữ "Công Ty Cổ Phần Thái Việt Corporation" bên cạnh.
 */
export const TopControlHUD: React.FC<TopControlHUDProps> = ({
  stage,
  companyName,
  logoUrl,
  farms,
  centralHub,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  activeCategories,
  onToggleCategory,
  biosecurityRadius,
  onRadiusChange,
  isTourRunning,
  tourIndex,
  tourTotal,
  onToggleTour,
  mapStyleMode,
  onToggleMapStyle,
  timeOfDay,
  isAutoTime,
  onSelectTimeOfDay,
  onToggleAutoTime,
  liteMode,
  onToggleLiteMode,
  syncState,
  onSyncNow,
  soundEnabled,
  onToggleSound,
  onOpenImport,
  hasCustomData,
  onResetDefault,
  onFlyOverview,
  onBackToGlobe,
  onFlyToHub,
  isAdmin,
  isServerIconConnected,
  onOpenAdminLogin,
  onLogoutAdmin,
  onOpenBulkIconModal,
}) => {
  const [logoError, setLogoError] = useState(false);

  const chickenCount = farms.filter((f) => f.category === 'chicken').length;
  const pigCount = farms.filter((f) => f.category === 'pig').length;
  const otherCount = farms.filter((f) => f.category === 'other').length;

  const totalDistanceKm = farms.reduce(
    (acc, f) =>
      acc + calculateDistanceKm(centralHub.lat, centralHub.lng, f.lat, f.lng),
    0
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSearchSubmit();
    }
  };

  const categoryButtons: Array<{
    key: FarmCategory;
    label: string;
    count: number;
    color: string;
  }> = [
    {
      key: 'chicken',
      label: 'Trại gà',
      count: chickenCount,
      color: APP_CONFIG.colors.categories.chicken.hex,
    },
    {
      key: 'pig',
      label: 'Trại heo',
      count: pigCount,
      color: APP_CONFIG.colors.categories.pig.hex,
    },
    {
      key: 'other',
      label: 'Khác',
      count: otherCount,
      color: APP_CONFIG.colors.categories.other.hex,
    },
  ];

  const timeOptions: Array<{
    key: TimeOfDay;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      key: 'dawn',
      label: 'Bình minh',
      icon: <Sunrise className="h-3.5 w-3.5 text-[#fb923c]" />,
    },
    {
      key: 'day',
      label: 'Ban ngày',
      icon: <Sun className="h-3.5 w-3.5 text-[#f59e0b]" />,
    },
    {
      key: 'dusk',
      label: 'Hoàng hôn',
      icon: <Sunset className="h-3.5 w-3.5 text-[#fb7185]" />,
    },
    {
      key: 'night',
      label: 'Đêm',
      icon: <Moon className="h-3.5 w-3.5 text-[#2b8fd0]" />,
    },
  ];

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex flex-col gap-2.5 p-3 sm:p-4">
      {/* Hàng 1: Thương hiệu Thái Việt Corporation + Bảng thống kê + Cụm nút điều khiển */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        {/* Khối Trái: Logo Hoa Sen Thái Việt + Tên công ty + Bảng thống kê */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 240, damping: 24 }}
          className="glass-panel pointer-events-auto relative overflow-hidden rounded-[22px] px-3.5 py-2.5 sm:px-4"
        >
          <PanelParticles count={6} color="#facc15" disabled={liteMode} />

          <div className="relative z-10 flex flex-wrap items-center gap-3.5 sm:gap-5">
            {/* Thương hiệu: Khung kính trắng chứa phần Hoa sen (78% phía trên) + Tên công ty bằng chữ thật */}
            <div className="flex items-center gap-3 border-r border-emerald-950/10 pr-3.5">
              <motion.button
                type="button"
                whileHover={{ y: -1, scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={stage === 'map' ? onBackToGlobe : onFlyOverview}
                title={
                  stage === 'map'
                    ? 'Về địa cầu 3D tự xoay'
                    : 'Xem bản đồ chi tiết'
                }
                className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] border border-white/95 bg-white/90 p-1.5 shadow-[0_6px_16px_rgba(43,143,208,0.18)] ring-1 ring-[#2b8fd0]/20 cursor-pointer"
              >
                {!logoError ? (
                  <div className="h-full w-full overflow-hidden">
                    <img
                      src={logoUrl}
                      alt={companyName}
                      onError={() => setLogoError(true)}
                      className="h-[132%] w-full object-cover object-top select-none"
                    />
                  </div>
                ) : (
                  <Globe2 className="h-6 w-6 text-[#2b8fd0]" />
                )}
              </motion.button>

              <div>
                <div className="font-display text-xs font-extrabold tracking-tight text-[#0f2a24] sm:text-sm">
                  {companyName}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-emerald-950/70">
                  <button
                    type="button"
                    onClick={onFlyToHub}
                    className="inline-flex items-center gap-1 font-bold text-[#2b8fd0] hover:text-[#d9261c] hover:underline cursor-pointer"
                  >
                    <CuteCategoryIcon category="hub" className="h-3.5 w-3.5" />
                    {centralHub.name}
                  </button>
                </div>
              </div>
            </div>

            {/* Chỉ số Thống kê (Tổng số trại, Theo loại có icon dễ thương, Tổng khoảng cách) */}
            <div className="flex flex-wrap items-center gap-3.5 sm:gap-5 text-xs">
              <div>
                <div className="text-[11px] font-medium text-emerald-950/65">
                  Tổng trại
                </div>
                <div className="text-base font-extrabold text-[#0f2a24] sm:text-lg">
                  <CountUp end={farms.length} />
                </div>
              </div>

              <div className="h-7 w-px bg-emerald-950/10" />

              <div className="flex items-center gap-3.5">
                <div className="flex items-center gap-1.5">
                  <CuteCategoryIcon
                    category="chicken"
                    className="h-4 w-4 text-[#fb923c]"
                  />
                  <div>
                    <div className="text-[10px] font-semibold text-[#ea580c]">
                      Trại gà
                    </div>
                    <div className="text-sm font-extrabold text-[#ea580c]">
                      <CountUp end={chickenCount} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <CuteCategoryIcon
                    category="pig"
                    className="h-4 w-4 text-[#fb7185]"
                  />
                  <div>
                    <div className="text-[10px] font-semibold text-[#e11d48]">
                      Trại heo
                    </div>
                    <div className="text-sm font-extrabold text-[#e11d48]">
                      <CountUp end={pigCount} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <CuteCategoryIcon
                    category="other"
                    className="h-4 w-4 text-[#14b8a6]"
                  />
                  <div>
                    <div className="text-[10px] font-semibold text-[#0d9488]">
                      Khác
                    </div>
                    <div className="text-sm font-extrabold text-[#0d9488]">
                      <CountUp end={otherCount} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="hidden h-7 w-px bg-emerald-950/10 md:block" />

              <div className="hidden md:block">
                <div className="text-[11px] font-medium text-emerald-950/65">
                  Tổng khoảng cách
                </div>
                <div className="text-base font-extrabold text-[#2b8fd0]">
                  <CountUp end={totalDistanceKm} decimals={1} suffix=" km" />
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Khối Phải: Đồng bộ My Maps, Tour, Nạp file, Về địa cầu, Đổi nền, Chế độ nhẹ, Âm thanh */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: 'spring',
            stiffness: 240,
            damping: 24,
            delay: 0.04,
          }}
          className="pointer-events-auto flex flex-wrap items-center gap-2"
        >
          {/* Nút "Về địa cầu" khi đang ở chế độ bản đồ */}
          {stage === 'map' && (
            <motion.button
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={onBackToGlobe}
              className="glass-panel flex items-center gap-1.5 rounded-full border-[#2b8fd0]/35 px-3.5 py-2 text-xs font-extrabold text-[#2b8fd0] transition-colors hover:border-[#2b8fd0] hover:bg-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <Globe2 className="h-3.5 w-3.5" />
              <span>Về địa cầu</span>
            </motion.button>
          )}

          {/* Cụm Trạng thái đồng bộ & Nút ĐỒNG BỘ NGAY */}
          <div className="glass-panel flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
            <span
              className="max-w-[190px] truncate text-[11px] font-semibold text-[#0f2a24]/80"
              title={syncState.statusText}
            >
              {syncState.statusText}
            </span>
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.95 }}
              onClick={onSyncNow}
              disabled={syncState.isSyncing}
              title="Đồng bộ dữ liệu mới nhất từ Google My Maps"
              className="inline-flex items-center gap-1 rounded-full bg-[#2b8fd0] px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-[#1e74ad] disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3 w-3 ${syncState.isSyncing ? 'animate-spin' : ''}`}
              />
              <span>ĐỒNG BỘ NGAY</span>
            </motion.button>
          </div>

          {/* Nút TOUR TỰ ĐỘNG */}
          <motion.button
            type="button"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            onClick={onToggleTour}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-extrabold tracking-wide shadow-md transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              isTourRunning
                ? 'bg-[#d9261c] text-white shadow-[0_8px_20px_rgba(217,38,28,0.38)]'
                : 'bg-gradient-to-r from-[#2b8fd0] to-[#10b981] text-white shadow-[0_8px_20px_rgba(43,143,208,0.3)]'
            }`}
          >
            {isTourRunning ? (
              <>
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>
                  DỪNG TOUR ({tourIndex + 1}/{tourTotal})
                </span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>TOUR TỰ ĐỘNG</span>
              </>
            )}
          </motion.button>

          {/* Nút NẠP DỮ LIỆU */}
          <motion.button
            type="button"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            onClick={onOpenImport}
            className="glass-panel flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold text-[#0f2a24] transition-colors hover:border-[#2b8fd0] hover:bg-white/95 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload className="h-3.5 w-3.5 text-[#2b8fd0]" />
            <span>NẠP DỮ LIỆU</span>
          </motion.button>

          {/* Cụm Chế độ Quản trị viên (cạnh nút NẠP DỮ LIỆU) */}
          {!isAdmin ? (
            <motion.button
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={onOpenAdminLogin}
              title="Đăng nhập Chế độ Quản trị để chọn icon Gà / Heo cho từng trang trại"
              className="glass-panel flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-[#0f2a24]/85 transition-colors hover:border-[#2b8fd0] hover:bg-white/95 hover:text-[#2b8fd0] cursor-pointer whitespace-nowrap shrink-0"
            >
              <Lock className="h-3.5 w-3.5 text-[#2b8fd0]" />
              <span>Quản trị</span>
            </motion.button>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Nhãn ĐANG Ở CHẾ ĐỘ QUẢN TRỊ */}
              <div className="flex items-center gap-1.5 rounded-full border border-[#10b981]/40 bg-[#10b981] px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-white shadow-sm whitespace-nowrap shrink-0">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>ĐANG Ở CHẾ ĐỘ QUẢN TRỊ</span>
              </div>

              {/* Nút Chọn icon hàng loạt */}
              <motion.button
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.96 }}
                onClick={onOpenBulkIconModal}
                className="glass-panel flex items-center gap-1.5 rounded-full border-[#2b8fd0]/40 bg-white/95 px-3 py-1.5 text-xs font-extrabold text-[#2b8fd0] hover:bg-[#2b8fd0] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Chọn icon hàng loạt</span>
              </motion.button>

              {/* Nút Thoát quản trị */}
              <motion.button
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.96 }}
                onClick={onLogoutAdmin}
                className="glass-panel flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-[#d9261c] hover:bg-rose-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Thoát quản trị</span>
              </motion.button>

              {!isServerIconConnected && (
                <div
                  title="Chưa cấu hình biến môi trường Upstash Redis trên máy chủ"
                  className="glass-panel flex items-center gap-1 rounded-full border-amber-400/60 bg-amber-50/90 px-2.5 py-1 text-[11px] font-bold text-amber-800 whitespace-nowrap shrink-0"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <span>Chưa kết nối máy chủ: lựa chọn chỉ lưu trên máy này</span>
                </div>
              )}
            </div>
          )}

          {hasCustomData && (
            <motion.button
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={onResetDefault}
              title="Xoá dữ liệu đã lưu trong localStorage và khôi phục mặc định"
              className="glass-panel flex items-center gap-1 rounded-full px-3 py-2 text-xs font-bold text-[#d9261c] hover:bg-rose-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Xoá dữ liệu</span>
            </motion.button>
          )}

          {/* Nút Chuyển nền: Vệ tinh Esri / Đường phố sáng */}
          <motion.button
            type="button"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            onClick={onToggleMapStyle}
            title="Chuyển đổi giữa Ảnh vệ tinh Esri World Imagery và Bản đồ Đường phố sáng"
            className="glass-panel flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold text-[#0f2a24] hover:border-[#2b8fd0] hover:bg-white/95 cursor-pointer whitespace-nowrap shrink-0"
          >
            {mapStyleMode === 'satellite' ? (
              <>
                <Satellite className="h-3.5 w-3.5 text-[#2b8fd0]" />
                <span>Nền: Vệ tinh</span>
              </>
            ) : (
              <>
                <Map className="h-3.5 w-3.5 text-[#10b981]" />
                <span>Nền: Đường phố sáng</span>
              </>
            )}
          </motion.button>

          {/* Nút Chế độ nhẹ (Lite Mode) */}
          <motion.button
            type="button"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            onClick={onToggleLiteMode}
            title="Bật/tắt Chế độ nhẹ"
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              liteMode
                ? 'bg-[#facc15] text-[#0f2a24] shadow-md'
                : 'glass-panel text-[#0f2a24] hover:bg-white/90'
            }`}
          >
            <Feather className="h-3.5 w-3.5" />
            <span>Chế độ nhẹ</span>
          </motion.button>

          {/* Nút Bật / Tắt Âm thanh */}
          <motion.button
            type="button"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.95 }}
            onClick={onToggleSound}
            title={
              soundEnabled
                ? 'Âm thanh hiệu ứng: ĐANG BẬT'
                : 'Âm thanh hiệu ứng: ĐANG TẮT'
            }
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors cursor-pointer shrink-0 ${
              soundEnabled
                ? 'bg-[#10b981] text-white shadow-md'
                : 'glass-panel text-[#0f2a24]/70 hover:text-[#0f2a24]'
            }`}
          >
            {soundEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </motion.button>

          {/* Nút Toàn cảnh mạng lưới */}
          <motion.button
            type="button"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.95 }}
            onClick={onFlyOverview}
            title="Xem bản đồ chi tiết toàn mạng lưới trang trại"
            className="glass-panel flex h-9 w-9 items-center justify-center rounded-full text-[#0f2a24] hover:bg-white/90 cursor-pointer shrink-0"
          >
            <Compass className="h-4 w-4 text-[#2b8fd0]" />
          </motion.button>
        </motion.div>
      </div>

      {/* Hàng 2: Thanh tìm kiếm + Chip lọc loại + Thanh chọn 4 mốc giờ trong ngày + Thanh trượt bán kính an toàn */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          type: 'spring',
          stiffness: 240,
          damping: 24,
          delay: 0.08,
        }}
        className="flex flex-wrap items-center justify-between gap-2.5"
      >
        {/* Nhóm Trái: Tìm kiếm + Chip lọc có Icon dễ thương */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-[#2b8fd0]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tìm tên trại (Enter bay tới)..."
              className="glass-panel w-52 rounded-full py-2 pr-8 pl-9 text-xs font-medium text-[#0f2a24] placeholder-emerald-950/45 transition-all focus:w-64 focus:border-[#2b8fd0] focus:bg-white/95 focus:outline-none sm:w-60 sm:focus:w-72"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 text-emerald-950/50 hover:text-[#d9261c] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Chip lọc theo loại trang trại (lọc ngay trên địa cầu hoặc bản đồ) */}
          <div className="glass-panel flex items-center gap-1 rounded-full p-1">
            {categoryButtons.map((btn) => {
              const isActive = activeCategories[btn.key];
              return (
                <motion.button
                  key={btn.key}
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => onToggleCategory(btn.key)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-white text-[#0f2a24] shadow-sm ring-1 ring-[#2b8fd0]/20'
                      : 'text-emerald-950/45 opacity-60 hover:opacity-90'
                  }`}
                >
                  <span style={{ color: btn.color }}>
                    <CuteCategoryIcon category={btn.key} className="h-4 w-4" />
                  </span>
                  <span>{btn.label}</span>
                  <span className="font-mono-tabular text-[11px] text-emerald-950/60">
                    ({btn.count})
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Nhóm Phải: Thanh chọn 4 mốc giờ trong ngày + Thanh trượt bán kính an toàn sinh học */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <div className="glass-panel flex flex-wrap items-center gap-1 rounded-full p-1">
            {timeOptions.map((opt) => {
              const active = timeOfDay === opt.key && !isAutoTime;
              const activeAuto = timeOfDay === opt.key && isAutoTime;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onSelectTimeOfDay(opt.key)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#2b8fd0] text-white shadow-sm'
                      : activeAuto
                      ? 'bg-[#10b981]/20 text-[#0f2a24] ring-1 ring-[#10b981]/40'
                      : 'text-[#0f2a24]/70 hover:bg-white/60 hover:text-[#0f2a24]'
                  }`}
                >
                  {opt.icon}
                  <span className="hidden sm:inline">{opt.label}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={onToggleAutoTime}
              title="Tự động đổi ánh sáng theo giờ thực tế của thiết bị"
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                isAutoTime
                  ? 'bg-[#10b981] text-white shadow-sm'
                  : 'text-[#0f2a24]/70 hover:bg-white/60'
              }`}
            >
              <Clock className="h-3 w-3" />
              <span>Tự động</span>
            </button>
          </div>

          {/* Thanh trượt Bán kính An toàn Sinh học */}
          <div className="glass-panel flex items-center gap-2.5 rounded-full px-3.5 py-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#0f2a24]">
              <Radar className="h-3.5 w-3.5 text-[#10b981]" />
              <span className="hidden md:inline">An toàn:</span>
              <span className="font-mono-tabular text-[#059669]">
                {biosecurityRadius} m
              </span>
            </div>
            <input
              type="range"
              min={APP_CONFIG.minBiosecurityRadiusMeters}
              max={APP_CONFIG.maxBiosecurityRadiusMeters}
              step={50}
              value={biosecurityRadius}
              onChange={(e) => onRadiusChange(Number(e.target.value))}
              className="h-1.5 w-20 cursor-pointer appearance-none rounded-lg bg-emerald-950/15 accent-[#10b981] sm:w-28"
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
};
