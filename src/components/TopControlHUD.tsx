import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, PanInfo } from 'framer-motion';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Crosshair,
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
import {
  DropdownLocationItem,
  normalizeMatchText,
  sortLocationsForDropdown,
} from '../utils/icons';
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
  onSelectFarm: (farm: Farm) => void;
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
  onFlyOverview: () => void;
  onBackToGlobe: () => void;
  onFlyToHub: () => void;
  isAdmin: boolean;
  isServerIconConnected: boolean;
  onOpenAdminLogin: () => void;
  onLogoutAdmin: () => void;
  onOpenBulkIconModal: () => void;
  onOpenPositionDiagnostics: () => void;
  hasActiveCard?: boolean;
}

/**
 * BẢNG THỐNG KÊ & ĐIỀU KHIỂN ĐÁP ỨNG MỌI THIẾT BỊ (LAPTOP, IPAD, ĐIỆN THOẠI DỌC & NGANG)
 * - Laptop & iPad (>= 640px):
 *   + Hàng 1: Trái = Bảng Logo + Thống kê; Phải = 3 nút ("TOUR TỰ ĐỘNG", nút tròn La bàn, nút tròn ⚙ "Tùy chỉnh" + huy hiệu "QUẢN TRỊ").
 *   + Hàng 2: Combobox / Searchable Dropdown "Tìm tên trại / địa điểm..." + Chip lọc (Trại gà / Trại heo / Khác).
 * - Điện thoại dọc (< 640px):
 *   + Thanh trên gọn: Logo + tên ngắn + chip thống kê thu gọn (bấm vào để mở rộng/thu gọn) + nút La bàn & nút ⚙ Tùy chỉnh (44x44px).
 *   + Thanh dưới (bottom dock): Chip lọc cuộn ngang nằm ngay trên dock + nút kính lúp tìm kiếm (bấm bung rộng & xổ lên danh sách) + nút "TOUR TỰ ĐỘNG".
 * - Điện thoại ngang (chiều cao < 500px):
 *   + Thu gọn thanh trên thành 1 dòng mỏng, các nút chỉ hiện icon 44x44px để không tràn chiều dọc.
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
  onSelectFarm,
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
  onFlyOverview,
  onBackToGlobe,
  onFlyToHub,
  isAdmin,
  isServerIconConnected,
  onOpenAdminLogin,
  onLogoutAdmin,
  onOpenBulkIconModal,
  onOpenPositionDiagnostics,
  hasActiveCard = false,
}) => {
  const [logoError, setLogoError] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileStatsExpanded, setIsMobileStatsExpanded] = useState(false);
  const [isMobileSearchExpanded, setIsMobileSearchExpanded] = useState(false);
  const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false);
  const [isLandscapeShort, setIsLandscapeShort] = useState(false);

  const settingsWrapperRef = useRef<HTMLDivElement | null>(null);
  const desktopDropdownWrapperRef = useRef<HTMLDivElement | null>(null);
  const landscapeDropdownWrapperRef = useRef<HTMLDivElement | null>(null);
  const mobileDropdownWrapperRef = useRef<HTMLDivElement | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const checkViewport = () => {
      setIsLandscapeShort(
        window.innerHeight < 500 && window.innerWidth > window.innerHeight
      );
    };
    checkViewport();
    window.addEventListener('resize', checkViewport);
    window.addEventListener('orientationchange', checkViewport);
    return () => {
      window.removeEventListener('resize', checkViewport);
      window.removeEventListener('orientationchange', checkViewport);
    };
  }, []);

  const chickenCount = farms.filter((f) => f.category === 'chicken').length;
  const pigCount = farms.filter((f) => f.category === 'pig').length;
  const otherCount = farms.filter((f) => f.category === 'other').length;

  const totalDistanceKm = farms.reduce(
    (acc, f) =>
      acc + calculateDistanceKm(centralHub.lat, centralHub.lng, f.lat, f.lng),
    0
  );

  const isSyncNormal =
    Boolean(syncState.lastSyncedTime) && !syncState.isOfflineFallback;

  // Xây dựng danh sách TẤT CẢ các địa điểm (Nhà máy trung tâm + tất cả trang trại/văn phòng/kho/rửa xe)
  // được sắp xếp theo đúng 7 thứ tự ưu tiên bắt buộc từ trên xuống dưới bằng sortLocationsForDropdown
  const sortedAllLocations = React.useMemo(() => {
    const rawItems: Array<DropdownLocationItem & { farm?: Farm }> = [
      {
        id: '__CENTRAL_HUB__',
        name: centralHub.name,
        type: centralHub.subtitle || 'Nhà máy trung tâm',
        category: 'hub',
        subType: 'hub',
        lat: centralHub.lat,
        lng: centralHub.lng,
        isHub: true,
      },
      ...farms.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        category: f.category,
        subType: f.subType || f.category,
        lat: f.lat,
        lng: f.lng,
        isHub: false,
        farm: f,
      })),
    ];

    return sortLocationsForDropdown(rawItems);
  }, [farms, centralHub]);

  // Lọc nhanh danh sách khi người dùng gõ chữ (nếu chưa gõ gì thì hiển thị TẤT CẢ các điểm)
  const filteredDropdownLocations = React.useMemo(() => {
    const normQ = normalizeMatchText(searchQuery);
    if (!normQ) return sortedAllLocations;
    return sortedAllLocations.filter((item) => {
      const hay = normalizeMatchText(
        `${item.name} ${item.type || ''} ${item.groupLabel || ''}`
      );
      return hay.includes(normQ);
    });
  }, [sortedAllLocations, searchQuery]);

  const handleSelectDropdownLocation = (
    item: (typeof sortedAllLocations)[number]
  ) => {
    setIsLocationDropdownOpen(false);
    setIsMobileSearchExpanded(false);
    onSearchChange('');
    if (item.isHub || item.id === '__CENTRAL_HUB__') {
      onFlyToHub();
    } else if (item.farm) {
      onSelectFarm(item.farm);
    }
  };

  useEffect(() => {
    if (!isLocationDropdownOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLocationDropdownOpen(false);
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inDesktop = desktopDropdownWrapperRef.current?.contains(target);
      const inLandscape = landscapeDropdownWrapperRef.current?.contains(target);
      const inMobile = mobileDropdownWrapperRef.current?.contains(target);
      if (!inDesktop && !inLandscape && !inMobile) {
        setIsLocationDropdownOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isLocationDropdownOpen]);

  useEffect(() => {
    if (!isSettingsOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSettingsOpen(false);
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      if (window.innerWidth < 640) return;
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
      if (filteredDropdownLocations.length > 0) {
        handleSelectDropdownLocation(filteredDropdownLocations[0]);
      } else {
        onSearchSubmit();
        setIsLocationDropdownOpen(false);
        setIsMobileSearchExpanded(false);
      }
    }
  };

  /**
   * Hiển thị danh sách xổ xuống tất cả các điểm theo thứ tự ưu tiên 1 -> 7
   * Mỗi dòng cao tối thiểu 44px dễ chạm trên cả điện thoại lẫn máy tính.
   */
  const renderLocationDropdownList = (openUpward = false) => (
    <AnimatePresence>
      {isLocationDropdownOpen && (
        <motion.div
          initial={{ opacity: 0, y: openUpward ? 10 : -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: openUpward ? 10 : -8, scale: 0.97 }}
          transition={{ duration: 0.16 }}
          className={`glass-panel pointer-events-auto absolute z-50 overflow-hidden rounded-2xl border border-white/95 bg-white/96 shadow-[0_22px_55px_rgba(15,42,36,0.24)] backdrop-blur-2xl ${
            openUpward
              ? 'inset-x-0 bottom-13 max-h-[52dvh]'
              : 'top-11 left-0 w-[320px] max-h-[60dvh] sm:w-[360px]'
          }`}
        >
          <div className="flex items-center justify-between border-b border-emerald-950/10 bg-sky-50/70 px-3 py-1.5 text-[11px] font-extrabold text-[#0f2a24]">
            <span>
              Danh sách địa điểm ({filteredDropdownLocations.length}/
              {sortedAllLocations.length})
            </span>
            <span className="text-[10px] font-semibold text-[#2b8fd0]">
              Theo thứ tự ưu tiên
            </span>
          </div>
          <div
            className={`overflow-y-auto overscroll-contain p-1.5 ${
              openUpward ? 'max-h-[calc(52dvh-34px)]' : 'max-h-[calc(60dvh-34px)]'
            }`}
          >
            {filteredDropdownLocations.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs font-semibold text-emerald-950/55">
                Không tìm thấy địa điểm nào khớp với &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              filteredDropdownLocations.map((item, idx) => {
                const prevGroupLabel =
                  idx > 0 ? filteredDropdownLocations[idx - 1].groupLabel : null;
                const showGroupHeader = item.groupLabel !== prevGroupLabel;
                const iconCat = item.isHub
                  ? 'hub'
                  : item.subType || item.category;

                return (
                  <React.Fragment key={item.id}>
                    {showGroupHeader && (
                      <div className="mt-1.5 mb-0.5 flex items-center justify-between px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-[#2b8fd0] uppercase first:mt-0">
                        <span>{item.groupLabel}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSelectDropdownLocation(item)}
                      className={`flex min-h-[44px] w-full items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                        item.isHub
                          ? 'bg-gradient-to-r from-sky-50/90 to-amber-50/80 font-extrabold text-[#0f2a24] ring-1 ring-[#2b8fd0]/25 hover:from-sky-100/90 hover:to-amber-100/80'
                          : 'font-bold text-[#0f2a24] hover:bg-sky-50/85'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-950/10 bg-white shadow-2xs">
                          <CuteCategoryIcon
                            category={iconCat}
                            className="h-4 w-4"
                          />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate leading-snug">
                            {item.name}
                          </div>
                          {item.isHub && (
                            <div className="truncate text-[10px] font-semibold text-[#2b8fd0]">
                              Bấm để bật luồng chấm sáng độ phủ cung ứng
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-emerald-950/[0.05] px-2 py-0.5 text-[10px] font-bold text-emerald-950/65">
                        {item.isHub
                          ? 'Nhà máy TT'
                          : item.category === 'pig'
                          ? 'Trại heo'
                          : item.category === 'chicken'
                          ? 'Trại gà'
                          : item.subType === 'office'
                          ? 'Văn phòng'
                          : item.subType === 'warehouse'
                          ? 'Kho'
                          : item.subType === 'wash'
                          ? 'Rửa xe'
                          : 'Khác'}
                      </span>
                    </button>
                  </React.Fragment>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

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
      {/* 1. NHÓM DỮ LIỆU (Chỉ Quản trị viên mới có quyền chỉnh sửa) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
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
            <span
              className="max-w-[180px] truncate"
              title={syncState.statusText}
            >
              {syncState.statusText}
            </span>
          </div>
        </div>

        {!isAdmin && (
          <div className="flex items-center gap-1.5 rounded-xl border border-amber-300/70 bg-amber-50/80 px-2.5 py-1.5 text-[11px] font-bold text-amber-800">
            <Lock className="h-3 w-3 shrink-0 text-amber-600" />
            <span>Chỉ quản trị viên mới có quyền chỉnh sửa</span>
          </div>
        )}

        <div
          className={
            !isAdmin
              ? 'pointer-events-none select-none opacity-45'
              : 'transition-opacity'
          }
          style={
            !isAdmin
              ? { opacity: 0.45, pointerEvents: 'none' }
              : undefined
          }
          aria-disabled={!isAdmin}
        >
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onSyncNow}
              disabled={!isAdmin || syncState.isSyncing}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-[#2b8fd0] px-3 py-2 text-xs font-extrabold text-white shadow-xs transition-colors hover:bg-[#1e74ad] disabled:opacity-60 cursor-pointer"
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
              disabled={!isAdmin}
              onClick={() => {
                if (!isAdmin) return;
                setIsSettingsOpen(false);
                onOpenImport();
              }}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-emerald-950/12 bg-white/90 px-3 py-2 text-xs font-bold text-[#0f2a24] transition-colors hover:border-[#2b8fd0] hover:text-[#2b8fd0] disabled:opacity-60 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5 text-[#2b8fd0]" />
              <span>Nạp dữ liệu</span>
            </button>
          </div>
        </div>
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
              className="inline-flex items-center gap-1 rounded-full bg-[#2b8fd0]/10 px-2.5 py-1 text-[11px] font-extrabold text-[#2b8fd0] hover:bg-[#2b8fd0]/20 cursor-pointer"
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
            className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
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
            className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
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

        <div className="grid grid-cols-5 gap-1 rounded-xl border border-emerald-950/10 bg-emerald-950/[0.04] p-1">
          {timeOptions.map((opt) => {
            const active = timeOfDay === opt.key && !isAutoTime;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onSelectTimeOfDay(opt.key)}
                className={`flex min-h-[42px] flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-bold transition-all cursor-pointer ${
                  active
                    ? 'bg-[#2b8fd0] text-white shadow-xs'
                    : 'text-[#0f2a24]/75 hover:bg-white/60 hover:text-[#0f2a24]'
                }`}
              >
                {opt.icon}
                <span className="max-w-full truncate">{opt.shortLabel}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={onToggleAutoTime}
            className={`flex min-h-[42px] flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-bold transition-all cursor-pointer ${
              isAutoTime
                ? 'bg-[#10b981] text-white shadow-xs'
                : 'text-[#0f2a24]/75 hover:bg-white/60 hover:text-[#0f2a24]'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span className="max-w-full truncate">Tự động</span>
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
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                liteMode ? 'bg-[#10b981]' : 'bg-emerald-950/20'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                  liteMode ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="h-px bg-emerald-950/10" />

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
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                soundEnabled ? 'bg-[#10b981]' : 'bg-emerald-950/20'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                  soundEnabled ? 'translate-x-5' : 'translate-x-1'
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
            className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-[#2b8fd0]/30 bg-white/90 px-3.5 py-2 text-xs font-extrabold text-[#2b8fd0] transition-colors hover:bg-[#2b8fd0] hover:text-white cursor-pointer"
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
                className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-[#2b8fd0] px-2.5 py-2 text-xs font-extrabold text-white shadow-xs transition-colors hover:bg-[#1e74ad] cursor-pointer"
              >
                <Layers className="h-3.5 w-3.5 shrink-0" />
                <span>Chọn icon hàng loạt</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  onOpenPositionDiagnostics();
                }}
                className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-[#2b8fd0]/30 bg-white px-2.5 py-2 text-xs font-extrabold text-[#2b8fd0] shadow-xs transition-colors hover:bg-sky-50 cursor-pointer"
              >
                <Crosshair className="h-3.5 w-3.5 shrink-0" />
                <span>Kiểm tra vị trí</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                onLogoutAdmin();
                setIsSettingsOpen(false);
              }}
              className="flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-extrabold text-[#d9261c] transition-colors hover:bg-rose-100 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Thoát quản trị</span>
            </button>

            {!isServerIconConnected && (
              <div className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50/90 px-2.5 py-1.5 text-[11px] font-bold text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span>Chưa kết nối máy chủ: lựa chọn chỉ lưu trên máy này</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // TRƯỜNG HỢP 1: ĐIỆN THOẠI XOAY NGANG (height < 500px) -> Thanh trên 1 dòng siêu gọn
  if (isLandscapeShort) {
    return (
      <>
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-3 py-1.5"
          style={{
            paddingTop: 'max(6px, var(--safe-top))',
            paddingLeft: 'max(12px, var(--safe-left))',
            paddingRight: 'max(12px, var(--safe-right))',
          }}
        >
          {/* Cụm Trái: Logo + Chip thống kê 1 dòng + Chip lọc */}
          <div className="glass-panel pointer-events-auto flex items-center gap-2 rounded-full px-2.5 py-1">
            <button
              type="button"
              onClick={stage === 'map' ? onBackToGlobe : onFlyOverview}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white bg-white p-1 shadow-xs cursor-pointer"
            >
              {!logoError ? (
                <img
                  src={logoUrl}
                  alt={companyName}
                  onError={() => setLogoError(true)}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Globe2 className="h-4 w-4 text-[#2b8fd0]" />
              )}
            </button>

            <button
              type="button"
              onClick={onFlyToHub}
              className="hidden items-center gap-1 text-[11px] font-extrabold text-[#2b8fd0] hover:underline md:inline-flex cursor-pointer"
            >
              <CuteCategoryIcon category="hub" className="h-3.5 w-3.5" />
              <span>Nhà máy TT</span>
            </button>

            <div className="h-4 w-px bg-emerald-950/15" />

            <span className="text-[11px] font-extrabold text-[#0f2a24]">
              {farms.length} trại
            </span>

            {categoryButtons.map((btn) => {
              const isActive = activeCategories[btn.key];
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => onToggleCategory(btn.key)}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white text-[#0f2a24] shadow-2xs ring-1 ring-[#2b8fd0]/20'
                      : 'opacity-45'
                  }`}
                >
                  <CuteCategoryIcon category={btn.key} className="h-3.5 w-3.5" />
                  <span>{btn.count}</span>
                </button>
              );
            })}
          </div>

          {/* Cụm Phải: Tìm kiếm nhỏ + Nút icon Tour + La bàn + Tùy chỉnh */}
          <div className="pointer-events-auto flex items-center gap-1.5">
            <div
              ref={landscapeDropdownWrapperRef}
              className="relative flex items-center"
            >
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#2b8fd0]" />
              <input
                type="text"
                value={searchQuery}
                onFocus={() => setIsLocationDropdownOpen(true)}
                onChange={(e) => {
                  onSearchChange(e.target.value);
                  setIsLocationDropdownOpen(true);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Tất cả địa điểm..."
                className="glass-panel h-9 w-36 rounded-full pr-11 pl-7 text-xs font-medium text-[#0f2a24] transition-all focus:w-48 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="absolute right-6 text-emerald-950/50 hover:text-[#d9261c]"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsLocationDropdownOpen((prev) => !prev)}
                title="Mở danh sách tất cả địa điểm"
                className="absolute right-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[#2b8fd0] hover:bg-[#2b8fd0]/10 cursor-pointer"
              >
                {isLocationDropdownOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              {renderLocationDropdownList(false)}
            </div>

            <button
              type="button"
              onClick={onToggleTour}
              title={isTourRunning ? 'Dừng Tour' : 'Tour tự động'}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-white shadow-sm cursor-pointer ${
                isTourRunning
                  ? 'bg-[#d9261c]'
                  : 'bg-gradient-to-r from-[#2b8fd0] to-[#10b981]'
              }`}
            >
              {isTourRunning ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={onFlyOverview}
              title="Xem toàn cảnh bản đồ"
              className="glass-panel flex h-9 w-9 items-center justify-center rounded-full text-[#2b8fd0] cursor-pointer"
            >
              <Compass className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen((p) => !p)}
              title="Tùy chỉnh"
              className={`relative flex h-9 w-9 items-center justify-center rounded-full cursor-pointer ${
                isSettingsOpen
                  ? 'bg-[#2b8fd0] text-white'
                  : 'glass-panel text-[#2b8fd0]'
              }`}
            >
              <Settings className="h-4 w-4" />
              <span
                className={`absolute top-0.5 right-0.5 h-2 w-2 rounded-full ring-1 ring-white ${
                  isSyncNormal ? 'bg-[#10b981]' : 'bg-[#f59e0b]'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Modal Tùy chỉnh cho màn hình ngang thấp */}
        <AnimatePresence>
          {isSettingsOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-end bg-[#0f2a24]/35 p-2 backdrop-blur-xs"
            >
              <motion.div
                initial={{ x: 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 40, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-panel max-h-[calc(100dvh-16px)] w-[340px] overflow-y-auto rounded-[20px] border border-white/95 bg-white/95 p-4 shadow-2xl"
              >
                <div className="mb-2.5 flex items-center justify-between border-b border-emerald-950/10 pb-2">
                  <span className="text-xs font-extrabold text-[#0f2a24]">
                    TÙY CHỈNH HỆ THỐNG
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-950/5"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {renderSettingsSections()}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <>
      {/* =====================================================================
          GIAO DIỆN ĐIỆN THOẠI DỌC (< 640px):
          - Thanh trên gọn (Logo + Tên ngắn + Chip thống kê bấm để mở rộng + Nút La bàn & ⚙ Tùy chỉnh)
          - Thanh dưới (Bottom Dock): Chip lọc cuộn ngang + Nút Tìm kiếm bung rộng + Nút TOUR TỰ ĐỘNG
         ===================================================================== */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-20 flex flex-col gap-2 px-2.5 pt-2 sm:hidden"
        style={{
          paddingTop: 'calc(var(--safe-top) + 8px)',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          {/* Cụm Trái: Logo + Tên ngắn + Thống kê thu gọn */}
          <div className="glass-panel pointer-events-auto flex min-w-0 flex-1 items-center justify-between gap-2 rounded-2xl px-2.5 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={stage === 'map' ? onBackToGlobe : onFlyOverview}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white bg-white p-1 shadow-xs ring-1 ring-[#2b8fd0]/20"
              >
                {!logoError ? (
                  <div className="h-full w-full overflow-hidden">
                    <img
                      src={logoUrl}
                      alt={companyName}
                      onError={() => setLogoError(true)}
                      className="h-[132%] w-full object-cover object-top"
                    />
                  </div>
                ) : (
                  <Globe2 className="h-5 w-5 text-[#2b8fd0]" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsMobileStatsExpanded((p) => !p)}
                className="min-w-0 text-left"
              >
                <div className="font-display truncate text-xs font-extrabold text-[#0f2a24]">
                  Thái Việt Corp
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-extrabold">
                  <span className="text-[#0f2a24]">{farms.length} trại</span>
                  <span className="text-emerald-950/30">·</span>
                  <span className="text-[#ea580c]">{chickenCount} gà</span>
                  <span className="text-[#e11d48]">{pigCount} heo</span>
                  {isMobileStatsExpanded ? (
                    <ChevronUp className="h-3 w-3 text-[#2b8fd0]" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-[#2b8fd0]" />
                  )}
                </div>
              </button>
            </div>
          </div>

          {/* Cụm Phải: Nút tròn La bàn (44x44) + Nút tròn ⚙ Tùy chỉnh (44x44) */}
          <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onFlyOverview}
              title="Xem bản đồ chi tiết"
              className="glass-panel flex h-11 w-11 items-center justify-center rounded-full text-[#2b8fd0]"
            >
              <Compass className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen((p) => !p)}
              title="Tùy chỉnh"
              className={`relative flex h-11 w-11 items-center justify-center rounded-full ${
                isSettingsOpen
                  ? 'bg-[#2b8fd0] text-white shadow-md'
                  : 'glass-panel text-[#2b8fd0]'
              }`}
            >
              <Settings className="h-5 w-5" />
              <span
                className={`absolute top-1 right-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                  isSyncNormal ? 'bg-[#10b981]' : 'bg-[#f59e0b]'
                }`}
              />
              {isAdmin && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-[#10b981] px-1.5 text-[8px] font-extrabold text-white">
                  QT
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Bảng thống kê mở rộng trên điện thoại khi bấm vào chip thống kê */}
        <AnimatePresence>
          {isMobileStatsExpanded && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-panel pointer-events-auto rounded-2xl p-3 text-xs"
            >
              <div className="mb-2 flex items-center justify-between border-b border-emerald-950/10 pb-2">
                <span className="font-display font-extrabold text-[#0f2a24]">
                  {companyName}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileStatsExpanded(false);
                    onFlyToHub();
                  }}
                  className="inline-flex items-center gap-1 font-extrabold text-[#2b8fd0]"
                >
                  <CuteCategoryIcon category="hub" className="h-3.5 w-3.5" />
                  <span>Xem Nhà máy TT</span>
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-xl bg-white/75 p-1.5">
                  <div className="text-[10px] font-semibold text-emerald-950/60">
                    Tổng trại
                  </div>
                  <div className="text-sm font-extrabold text-[#0f2a24]">
                    {farms.length}
                  </div>
                </div>
                <div className="rounded-xl bg-white/75 p-1.5">
                  <div className="text-[10px] font-semibold text-[#ea580c]">
                    Trại gà
                  </div>
                  <div className="text-sm font-extrabold text-[#ea580c]">
                    {chickenCount}
                  </div>
                </div>
                <div className="rounded-xl bg-white/75 p-1.5">
                  <div className="text-[10px] font-semibold text-[#e11d48]">
                    Trại heo
                  </div>
                  <div className="text-sm font-extrabold text-[#e11d48]">
                    {pigCount}
                  </div>
                </div>
                <div className="rounded-xl bg-white/75 p-1.5">
                  <div className="text-[10px] font-semibold text-[#0d9488]">
                    Khác
                  </div>
                  <div className="text-sm font-extrabold text-[#0d9488]">
                    {otherCount}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* BOTTOM DOCK TRÊN ĐIỆN THOẠI DỌC (< 640px) - Tự ẩn khi đang mở Card thông tin để không đè nhau */}
      {!hasActiveCard && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-2.5 sm:hidden"
          style={{
            paddingBottom: 'calc(var(--safe-bottom) + 10px)',
          }}
        >
          {/* Hàng chip lọc cuộn ngang ngay phía trên Bottom Dock */}
          <div className="pointer-events-auto flex items-center justify-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
            <button
              type="button"
              onClick={onFlyToHub}
              className="glass-panel flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold text-[#2b8fd0] shadow-xs"
            >
              <CuteCategoryIcon category="hub" className="h-4 w-4" />
              <span>Nhà máy TT</span>
            </button>

            {categoryButtons.map((btn) => {
              const isActive = activeCategories[btn.key];
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => onToggleCategory(btn.key)}
                  className={`flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all ${
                    isActive
                      ? 'glass-panel bg-white/95 text-[#0f2a24] shadow-xs ring-1 ring-[#2b8fd0]/25'
                      : 'glass-panel bg-white/60 text-emerald-950/45 opacity-65'
                  }`}
                >
                  <CuteCategoryIcon category={btn.key} className="h-4 w-4" />
                  <span>{btn.label}</span>
                  <span className="font-mono-tabular text-[11px] opacity-70">
                    ({btn.count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Thanh Dock chính: Nút Tìm kiếm / Danh sách điểm (bung rộng khi bấm) + Nút TOUR TỰ ĐỘNG */}
          <div
            ref={mobileDropdownWrapperRef}
            className="pointer-events-auto relative flex items-center gap-2"
          >
            {isMobileSearchExpanded || searchQuery ? (
              <div className="glass-panel relative flex h-11 flex-1 items-center rounded-full bg-white/95 px-3.5 shadow-md">
                <Search className="h-4 w-4 shrink-0 text-[#2b8fd0]" />
                <input
                  ref={mobileSearchInputRef}
                  type="text"
                  value={searchQuery}
                  onFocus={() => setIsLocationDropdownOpen(true)}
                  onChange={(e) => {
                    onSearchChange(e.target.value);
                    setIsLocationDropdownOpen(true);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Chọn hoặc tìm địa điểm..."
                  autoFocus
                  className="h-full w-full bg-transparent px-2 text-xs font-semibold text-[#0f2a24] placeholder-emerald-950/45 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setIsLocationDropdownOpen((prev) => !prev)}
                  title="Đóng/mở danh sách địa điểm"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#2b8fd0]"
                >
                  {isLocationDropdownOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronUp className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSearchChange('');
                    setIsLocationDropdownOpen(false);
                    setIsMobileSearchExpanded(false);
                  }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-emerald-950/55"
                >
                  <X className="h-4 w-4" />
                </button>
                {renderLocationDropdownList(true)}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileSearchExpanded(true);
                    setIsLocationDropdownOpen(true);
                    setTimeout(() => mobileSearchInputRef.current?.focus(), 60);
                  }}
                  aria-label="Tìm kiếm và chọn địa điểm"
                  className="glass-panel flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#2b8fd0] shadow-md"
                >
                  <Search className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={onToggleTour}
                  className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-full px-5 text-xs font-extrabold tracking-wide text-white shadow-lg ${
                    isTourRunning
                      ? 'bg-[#d9261c]'
                      : 'bg-gradient-to-r from-[#2b8fd0] to-[#10b981]'
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
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          GIAO DIỆN IPAD / TABLET & LAPTOP (>= 640px)
         ===================================================================== */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-20 hidden flex-col gap-2.5 p-3 sm:flex sm:p-4"
        style={{
          paddingTop: 'max(14px, var(--safe-top))',
          paddingLeft: 'max(16px, var(--safe-left))',
          paddingRight: 'max(16px, var(--safe-right))',
        }}
      >
        {/* HÀNG 1: Bảng Logo + Thống kê bên trái | 3 Nút gọn gàng bên phải */}
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
                      title="Bấm để xem mạng lưới kết nối từ Nhà máy Trung tâm"
                      className="inline-flex items-center gap-1 font-bold text-[#2b8fd0] hover:text-[#d9261c] hover:underline cursor-pointer"
                    >
                      <CuteCategoryIcon category="hub" className="h-3.5 w-3.5" />
                      {centralHub.name}
                    </button>
                  </div>
                </div>
              </div>

              {/* Chỉ số Thống kê */}
              <div className="flex flex-wrap items-center gap-3.5 text-xs sm:gap-5">
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

                <div className="hidden h-7 w-px bg-emerald-950/10 lg:block" />

                <div className="hidden lg:block">
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

          {/* Khối Phải: 3 nút chính ("TOUR TỰ ĐỘNG", nút tròn La bàn, nút tròn ⚙ "Tùy chỉnh" + huy hiệu "QUẢN TRỊ") */}
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
            {/* 1. Nút chính nổi bật: TOUR TỰ ĐỘNG (cao 44px chuẩn chạm) */}
            <motion.button
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={onToggleTour}
              className={`flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-xs font-extrabold tracking-wide whitespace-nowrap shadow-md transition-all cursor-pointer ${
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

            {/* 2. Nút tròn La bàn (44x44px) */}
            <motion.button
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.95 }}
              onClick={onFlyOverview}
              title="Xem bản đồ chi tiết toàn mạng lưới trang trại"
              className="glass-panel flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#0f2a24] transition-colors hover:border-[#2b8fd0] hover:bg-white/95 cursor-pointer"
            >
              <Compass className="h-4 w-4 text-[#2b8fd0]" />
            </motion.button>

            {/* Huy hiệu nhỏ "QUẢN TRỊ" cạnh nút ⚙ khi đang ở chế độ quản trị */}
            {isAdmin && (
              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setIsSettingsOpen((prev) => !prev)}
                title="Đang ở chế độ quản trị · Bấm để mở Tùy chỉnh"
                className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-[#10b981]/40 bg-[#10b981] px-3 text-[10px] font-extrabold tracking-wider whitespace-nowrap text-white shadow-sm cursor-pointer"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>QUẢN TRỊ</span>
              </motion.button>
            )}

            {/* 3. Nút tròn ⚙ "Tùy chỉnh" (44x44px) */}
            <div ref={settingsWrapperRef} className="relative">
              <motion.button
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsSettingsOpen((prev) => !prev)}
                title="Tùy chỉnh"
                aria-label="Tùy chỉnh"
                aria-expanded={isSettingsOpen}
                className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all cursor-pointer ${
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
                    className="glass-panel absolute top-13 right-0 z-50 hidden max-h-[calc(100dvh-90px)] w-[350px] overflow-y-auto rounded-[20px] border border-white/95 bg-white/92 p-4 shadow-[0_24px_60px_rgba(15,42,36,0.22)] backdrop-blur-2xl sm:block"
                  >
                    <div className="mb-3 flex items-center justify-between border-b border-emerald-950/10 pb-2">
                      <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#0f2a24]">
                        <Settings className="h-3.5 w-3.5 text-[#2b8fd0]" />
                        <span>TÙY CHỈNH HỆ THỐNG</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsSettingsOpen(false)}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-emerald-950/50 hover:bg-emerald-950/5 hover:text-[#d9261c] cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {renderSettingsSections()}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>

        {/* HÀNG 2: Ô tìm kiếm (Searchable Dropdown) + Chip lọc (Trại gà / Trại heo / Khác) */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: 'spring',
            stiffness: 240,
            damping: 24,
            delay: 0.08,
          }}
          className="pointer-events-auto flex flex-wrap items-center gap-2 pb-1"
        >
          {/* Ô tìm kiếm kết hợp Danh sách xổ xuống tất cả các điểm (Searchable Dropdown) */}
          <div
            ref={desktopDropdownWrapperRef}
            className="relative flex shrink-0 items-center"
          >
            <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#2b8fd0]" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setIsLocationDropdownOpen(true)}
              onChange={(e) => {
                onSearchChange(e.target.value);
                setIsLocationDropdownOpen(true);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Tìm tên trại / Chọn địa điểm..."
              className="glass-panel h-10 w-60 rounded-full pr-14 pl-9 text-xs font-semibold text-[#0f2a24] placeholder-emerald-950/50 transition-all focus:w-72 focus:border-[#2b8fd0] focus:bg-white/95 focus:outline-none lg:w-68 lg:focus:w-80"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                title="Xóa từ khóa"
                className="absolute right-8 text-emerald-950/50 hover:text-[#d9261c] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsLocationDropdownOpen((prev) => !prev)}
              title="Xổ danh sách tất cả địa điểm theo thứ tự ưu tiên"
              className="absolute right-1.5 flex h-7 w-7 items-center justify-center rounded-full text-[#2b8fd0] transition-colors hover:bg-[#2b8fd0]/12 cursor-pointer"
            >
              {isLocationDropdownOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {renderLocationDropdownList(false)}
          </div>

          {/* Chip lọc theo loại trang trại */}
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
                  className={`flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
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
      </div>

      {/* PANEL "TÙY CHỈNH" DẠNG BOTTOM-SHEET VUỐT XUỐNG ĐỂ ĐÓNG TRÊN ĐIỆN THOẠI DỌC (< 640px) */}
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
              className="glass-panel max-h-[calc(100dvh-24px)] w-full overflow-y-auto rounded-t-[24px] border-t border-white/95 bg-white/95 p-5 shadow-[0_-18px_50px_rgba(15,42,36,0.22)] backdrop-blur-2xl"
              style={{
                paddingBottom: 'calc(var(--safe-bottom) + 24px)',
              }}
            >
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
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-950/10 bg-white text-[#0f2a24]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {renderSettingsSections()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
