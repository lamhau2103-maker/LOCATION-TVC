import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, PanInfo } from 'framer-motion';
import {
  AlertTriangle,
  Clock,
  Compass,
  Database,
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
  Settings,
  ShieldCheck,
  Sliders,
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
 * BẢNG THỐNG KÊ & ĐIỀU KHIỂN GỌN GÀNG GÓC TRÊN
 * - Hàng 1: Trái = Bảng Logo + Thống kê (giữ nguyên); Phải = 3 nút ("TOUR TỰ ĐỘNG", nút tròn La bàn, nút tròn ⚙ "Tùy chỉnh" + huy hiệu nhỏ "QUẢN TRỊ" nếu đang ở chế độ quản trị).
 * - Hàng 2: Ô tìm kiếm + Chip lọc (Trại gà / Trại heo / Khác) gọn gàng trên 1 hàng, cuộn ngang mượt trên điện thoại.
 * - Panel "Tùy chỉnh" thả xuống dưới nút ⚙ (hoặc bottom-sheet vuốt xuống trên điện thoại) gom 5 nhóm:
 *   1. Dữ liệu | 2. Bản đồ | 3. Thời gian | 4. Hiệu năng & âm thanh | 5. Quản trị
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsWrapperRef = useRef<HTMLDivElement | null>(null);

  const chickenCount = farms.filter((f) => f.category === 'chicken').length;
  const pigCount = farms.filter((f) => f.category === 'pig').length;
  const otherCount = farms.filter((f) => f.category === 'other').length;

  const totalDistanceKm = farms.reduce(
    (acc, f) =>
      acc + calculateDistanceKm(centralHub.lat, centralHub.lng, f.lat, f.lng),
    0
  );

  // Chấm trạng thái nhỏ trên nút ⚙: xanh lá khi đồng bộ bình thường, vàng khi lỗi đồng bộ hoặc đang dùng dữ liệu lưu cũ
  const isSyncNormal =
    Boolean(syncState.lastSyncedTime) && !syncState.isOfflineFallback;

  // Đóng panel Tùy chỉnh khi nhấn phím Esc hoặc bấm ra ngoài
  useEffect(() => {
    if (!isSettingsOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSettingsOpen(false);
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      if (window.innerWidth < 640) return; // Mobile dùng backdrop riêng
      if (
        settingsWrapperRef.current &&
        !settingsWrapperRef.current.contains(e.target as Node)
      ) {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isSettingsOpen]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSearchSubmit();
    }
  };

  const handleSheetDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (info.offset.y > 85 || info.velocity.y > 420) {
      setIsSettingsOpen(false);
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
    shortLabel: string;
    icon: React.ReactNode;
  }> = [
    {
      key: 'dawn',
      shortLabel: 'Bình minh',
      icon: <Sunrise className="h-3.5 w-3.5" />,
    },
    {
      key: 'day',
      shortLabel: 'Ban ngày',
      icon: <Sun className="h-3.5 w-3.5" />,
    },
    {
      key: 'dusk',
      shortLabel: 'Hoàng hôn',
      icon: <Sunset className="h-3.5 w-3.5" />,
    },
    {
      key: 'night',
      shortLabel: 'Đêm',
      icon: <Moon className="h-3.5 w-3.5" />,
    },
  ];

  /**
   * Nội dung 5 nhóm cài đặt bên trong Panel "Tùy chỉnh"
   */
  const renderSettingsSections = () => (
    <div className="space-y-4 text-xs text-[#0f2a24]">
      {/* 1. NHÓM DỮ LIỆU */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-[#2b8fd0] uppercase">
            <Database className="h-3.5 w-3.5" />
            <span>1. Dữ liệu</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0f2a24]/75">
            <span
              className={`h-2 w-2 rounded-full ${
                isSyncNormal
                  ? 'bg-[#10b981] shadow-[0_0_6px_#10b981]'
                  : 'bg-[#f59e0b] shadow-[0_0_6px_#f59e0b]'
              }`}
            />
            <span className="max-w-[180px] truncate" title={syncState.statusText}>
              {syncState.statusText}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onSyncNow}
            disabled={syncState.isSyncing}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-[#2b8fd0] px-3 py-2 text-xs font-extrabold text-white shadow-xs transition-colors hover:bg-[#1e74ad] disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                syncState.isSyncing ? 'animate-spin' : ''
              }`}
            />
            <span>Đồng bộ ngay</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsSettingsOpen(false);
              onOpenImport();
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-950/12 bg-white/90 px-3 py-2 text-xs font-bold text-[#0f2a24] transition-colors hover:border-[#2b8fd0] hover:text-[#2b8fd0] cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5 text-[#2b8fd0]" />
            <span>Nạp dữ liệu</span>
          </button>
        </div>

        {hasCustomData && (
          <button
            type="button"
            onClick={() => {
              onResetDefault();
              setIsSettingsOpen(false);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/75 px-3 py-1.5 text-[11px] font-bold text-[#d9261c] transition-colors hover:bg-rose-100 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Khôi phục dữ liệu mặc định</span>
          </button>
        )}
      </div>

      <div className="h-px bg-emerald-950/10" />

      {/* 2. NHÓM BẢN ĐỒ */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-[#2b8fd0] uppercase">
            <Map className="h-3.5 w-3.5" />
            <span>2. Bản đồ</span>
          </div>
          {stage === 'map' && (
            <button
              type="button"
              onClick={() => {
                setIsSettingsOpen(false);
                onBackToGlobe();
              }}
              className="inline-flex items-center gap-1 rounded-full bg-[#2b8fd0]/10 px-2.5 py-0.5 text-[11px] font-extrabold text-[#2b8fd0] hover:bg-[#2b8fd0]/20 cursor-pointer"
            >
              <Globe2 className="h-3 w-3" />
              <span>Về địa cầu 3D</span>
            </button>
          )}
        </div>

        {/* Segmented Nền bản đồ: Vệ tinh / Đường phố */}
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-emerald-950/10 bg-emerald-950/[0.04] p-1">
          <button
            type="button"
            onClick={() => {
              if (mapStyleMode !== 'satellite') onToggleMapStyle();
            }}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
              mapStyleMode === 'satellite'
                ? 'bg-white text-[#2b8fd0] shadow-xs'
                : 'text-[#0f2a24]/70 hover:text-[#0f2a24]'
            }`}
          >
            <Satellite className="h-3.5 w-3.5" />
            <span>Vệ tinh</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (mapStyleMode !== 'street') onToggleMapStyle();
            }}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
              mapStyleMode === 'street'
                ? 'bg-white text-[#10b981] shadow-xs'
                : 'text-[#0f2a24]/70 hover:text-[#0f2a24]'
            }`}
          >
            <Map className="h-3.5 w-3.5" />
            <span>Đường phố</span>
          </button>
        </div>

        {/* Thanh trượt Bán kính an toàn */}
        <div className="rounded-xl border border-emerald-950/10 bg-white/75 px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between text-xs font-bold">
            <span className="flex items-center gap-1.5 text-[#0f2a24]/85">
              <Radar className="h-3.5 w-3.5 text-[#10b981]" />
              <span>Bán kính an toàn</span>
            </span>
            <span className="font-mono-tabular font-extrabold text-[#059669]">
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
            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-emerald-950/15 accent-[#10b981]"
          />
        </div>
      </div>

      <div className="h-px bg-emerald-950/10" />

      {/* 3. NHÓM THỜI GIAN */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-[#2b8fd0] uppercase">
          <Clock className="h-3.5 w-3.5" />
          <span>3. Thời gian</span>
        </div>

        {/* Segmented 5 mục: Bình minh / Ban ngày / Hoàng hôn / Đêm / Tự động */}
        <div className="grid grid-cols-5 gap-1 rounded-xl border border-emerald-950/10 bg-emerald-950/[0.04] p-1">
          {timeOptions.map((opt) => {
            const active = timeOfDay === opt.key && !isAutoTime;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onSelectTimeOfDay(opt.key)}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-bold transition-all cursor-pointer ${
                  active
                    ? 'bg-[#2b8fd0] text-white shadow-xs'
                    : 'text-[#0f2a24]/75 hover:bg-white/60 hover:text-[#0f2a24]'
                }`}
              >
                {opt.icon}
                <span className="truncate max-w-full">{opt.shortLabel}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={onToggleAutoTime}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-bold transition-all cursor-pointer ${
              isAutoTime
                ? 'bg-[#10b981] text-white shadow-xs'
                : 'text-[#0f2a24]/75 hover:bg-white/60 hover:text-[#0f2a24]'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span className="truncate max-w-full">Tự động</span>
          </button>
        </div>
      </div>

      <div className="h-px bg-emerald-950/10" />

      {/* 4. NHÓM HIỆU NĂNG & ÂM THANH */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-[#2b8fd0] uppercase">
          <Sliders className="h-3.5 w-3.5" />
          <span>4. Hiệu năng & âm thanh</span>
        </div>

        <div className="space-y-1.5 rounded-xl border border-emerald-950/10 bg-white/75 p-2.5">
          {/* Toggle Chế độ nhẹ */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <Feather className="h-3.5 w-3.5 text-[#f59e0b]" />
              <span className="font-bold text-[#0f2a24]">Chế độ nhẹ</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={liteMode}
              onClick={onToggleLiteMode}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                liteMode ? 'bg-[#10b981]' : 'bg-emerald-950/20'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                  liteMode ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="h-px bg-emerald-950/10" />

          {/* Toggle Âm thanh */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              {soundEnabled ? (
                <Volume2 className="h-3.5 w-3.5 text-[#10b981]" />
              ) : (
                <VolumeX className="h-3.5 w-3.5 text-emerald-950/50" />
              )}
              <span className="font-bold text-[#0f2a24]">Âm thanh</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={soundEnabled}
              onClick={onToggleSound}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                soundEnabled ? 'bg-[#10b981]' : 'bg-emerald-950/20'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                  soundEnabled ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="h-px bg-emerald-950/10" />

      {/* 5. NHÓM QUẢN TRỊ */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-[#2b8fd0] uppercase">
            <Lock className="h-3.5 w-3.5" />
            <span>5. Quản trị</span>
          </div>
          {isAdmin && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#10b981]/15 px-2 py-0.5 text-[10px] font-extrabold text-[#059669]">
              <ShieldCheck className="h-3 w-3" />
              <span>Đang bật</span>
            </span>
          )}
        </div>

        {!isAdmin ? (
          <button
            type="button"
            onClick={() => {
              setIsSettingsOpen(false);
              onOpenAdminLogin();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#2b8fd0]/30 bg-white/90 px-3.5 py-2 text-xs font-extrabold text-[#2b8fd0] transition-colors hover:bg-[#2b8fd0] hover:text-white cursor-pointer"
          >
            <Lock className="h-3.5 w-3.5" />
            <span>Đăng nhập quản trị</span>
          </button>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  onOpenBulkIconModal();
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#2b8fd0] px-3 py-2 text-xs font-extrabold text-white shadow-xs transition-colors hover:bg-[#1e74ad] cursor-pointer"
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Chọn icon hàng loạt</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onLogoutAdmin();
                  setIsSettingsOpen(false);
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-[#d9261c] transition-colors hover:bg-rose-100 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Thoát quản trị</span>
              </button>
            </div>

            {!isServerIconConnected && (
              <div className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50/90 px-2.5 py-1.5 text-[11px] font-bold text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>Chưa kết nối máy chủ: lựa chọn chỉ lưu trên máy này</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex flex-col gap-2.5 p-3 sm:p-4">
      {/* HÀNG 1: Bảng Logo + Thống kê bên trái | 3 Nút gọn gàng bên phải */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        {/* Khối Trái: Logo Hoa Sen Thái Việt + Tên công ty + Bảng thống kê (Giữ nguyên) */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 240, damping: 24 }}
          className="glass-panel pointer-events-auto relative overflow-hidden rounded-[22px] px-3.5 py-2.5 sm:px-4"
        >
          <PanelParticles count={6} color="#facc15" disabled={liteMode} />

          <div className="relative z-10 flex flex-wrap items-center gap-3.5 sm:gap-5">
            {/* Thương hiệu: Khung kính trắng chứa phần Hoa sen + Tên công ty */}
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

        {/* Khối Phải: Chỉ còn 3 nút chính ("TOUR TỰ ĐỘNG", nút tròn La bàn, nút tròn ⚙ "Tùy chỉnh" + huy hiệu nhỏ "QUẢN TRỊ") */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: 'spring',
            stiffness: 240,
            damping: 24,
            delay: 0.04,
          }}
          className="pointer-events-auto flex items-center gap-2.5"
        >
          {/* 1. Nút chính nổi bật: TOUR TỰ ĐỘNG */}
          <motion.button
            type="button"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            onClick={onToggleTour}
            className={`flex h-10 items-center gap-2 rounded-full px-4 text-xs font-extrabold tracking-wide shadow-md transition-all cursor-pointer whitespace-nowrap shrink-0 ${
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

          {/* 2. Nút tròn La bàn (xem bản đồ chi tiết) */}
          <motion.button
            type="button"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.95 }}
            onClick={onFlyOverview}
            title="Xem bản đồ chi tiết toàn mạng lưới trang trại"
            className="glass-panel flex h-10 w-10 items-center justify-center rounded-full text-[#0f2a24] transition-colors hover:border-[#2b8fd0] hover:bg-white/95 cursor-pointer shrink-0"
          >
            <Compass className="h-4 w-4 text-[#2b8fd0]" />
          </motion.button>

          {/* Huy hiệu nhỏ "QUẢN TRỊ" cạnh nút ⚙ khi đang ở chế độ quản trị (bấm vào mở panel Tùy chỉnh) */}
          {isAdmin && (
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setIsSettingsOpen((prev) => !prev)}
              title="Đang ở chế độ quản trị · Bấm để mở Tùy chỉnh"
              className="flex h-8 items-center gap-1 rounded-full border border-[#10b981]/40 bg-[#10b981] px-2.5 text-[10px] font-extrabold tracking-wider text-white shadow-sm cursor-pointer whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="h-3 w-3" />
              <span>QUẢN TRỊ</span>
            </motion.button>
          )}

          {/* 3. Nút tròn ⚙ "Tùy chỉnh" có chấm trạng thái đồng bộ nhỏ */}
          <div ref={settingsWrapperRef} className="relative">
            <motion.button
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsSettingsOpen((prev) => !prev)}
              title="Tùy chỉnh"
              aria-label="Tùy chỉnh"
              aria-expanded={isSettingsOpen}
              className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer shrink-0 ${
                isSettingsOpen
                  ? 'bg-[#2b8fd0] text-white shadow-[0_8px_20px_rgba(43,143,208,0.35)]'
                  : 'glass-panel text-[#0f2a24] hover:border-[#2b8fd0] hover:bg-white/95'
              }`}
            >
              <Settings
                className={`h-4 w-4 transition-transform duration-300 ${
                  isSettingsOpen ? 'rotate-90 text-white' : 'text-[#2b8fd0]'
                }`}
              />

              {/* Chấm trạng thái nhỏ: xanh lá khi đồng bộ bình thường, vàng khi lỗi đồng bộ hoặc đang dùng dữ liệu lưu cũ */}
              <span
                title={syncState.statusText}
                className={`absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                  isSyncNormal ? 'bg-[#10b981]' : 'bg-[#f59e0b]'
                }`}
              />
            </motion.button>

            {/* PANEL "TÙY CHỈNH" THẢ XUỐNG NGAY DƯỚI NÚT ⚙ (TRÊN DESKTOP / TABLET) */}
            <AnimatePresence>
              {isSettingsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                  className="glass-panel absolute top-12 right-0 z-50 hidden w-[340px] overflow-hidden rounded-[20px] border border-white/95 bg-white/88 p-4 shadow-[0_24px_60px_rgba(15,42,36,0.22)] backdrop-blur-2xl sm:block"
                >
                  <div className="mb-3 flex items-center justify-between border-b border-emerald-950/10 pb-2">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#0f2a24]">
                      <Settings className="h-3.5 w-3.5 text-[#2b8fd0]" />
                      <span>TÙY CHỈNH HỆ THỐNG</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsSettingsOpen(false)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-emerald-950/50 hover:bg-emerald-950/5 hover:text-[#d9261c] cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {renderSettingsSections()}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* HÀNG 2: Ô tìm kiếm + Chip lọc (Trại gà / Trại heo / Khác) gọn gàng trên 1 hàng, cuộn ngang trên điện thoại */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          type: 'spring',
          stiffness: 240,
          damping: 24,
          delay: 0.08,
        }}
        className="pointer-events-auto flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar"
      >
        {/* Ô tìm kiếm */}
        <div className="relative flex shrink-0 items-center">
          <Search className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-[#2b8fd0]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Tìm tên trại (Enter bay tới)..."
            className="glass-panel h-9 w-44 rounded-full pr-7 pl-9 text-xs font-medium text-[#0f2a24] placeholder-emerald-950/45 transition-all focus:w-56 focus:border-[#2b8fd0] focus:bg-white/95 focus:outline-none sm:w-56 sm:focus:w-68"
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

        {/* Chip lọc theo loại trang trại (cuộn ngang trên điện thoại) */}
        <div className="glass-panel flex shrink-0 items-center gap-1 rounded-full p-1">
          {categoryButtons.map((btn) => {
            const isActive = activeCategories[btn.key];
            return (
              <motion.button
                key={btn.key}
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => onToggleCategory(btn.key)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-white text-[#0f2a24] shadow-xs ring-1 ring-[#2b8fd0]/20'
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
      </motion.div>

      {/* PANEL "TÙY CHỈNH" DẠNG BOTTOM-SHEET VUỐT XUỐNG ĐỂ ĐÓNG TRÊN ĐIỆN THOẠI (< 640px) */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSettingsOpen(false)}
            className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-[#0f2a24]/35 backdrop-blur-xs sm:hidden"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 320 }}
              dragElastic={0.2}
              onDragEnd={handleSheetDragEnd}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel max-h-[85vh] w-full overflow-y-auto rounded-t-[24px] border-t border-white/95 bg-white/92 p-5 pb-7 shadow-[0_-18px_50px_rgba(15,42,36,0.22)] backdrop-blur-2xl"
            >
              {/* Thanh nắm kéo để vuốt xuống đóng */}
              <div className="mb-3 flex justify-center">
                <div className="h-1.5 w-11 rounded-full bg-emerald-950/20" />
              </div>

              <div className="mb-3 flex items-center justify-between border-b border-emerald-950/10 pb-2.5">
                <div className="flex items-center gap-1.5 text-sm font-extrabold text-[#0f2a24]">
                  <Settings className="h-4 w-4 text-[#2b8fd0]" />
                  <span>TÙY CHỈNH HỆ THỐNG</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-950/10 bg-white text-[#0f2a24]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {renderSettingsSections()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
