import React, { useEffect, useState } from 'react';
import { motion, PanInfo } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  GitCommitHorizontal,
  Lock,
  MapPin,
  Navigation,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { APP_CONFIG, getCategoryConfig } from '../config';
import { CentralHub, Farm, FarmCategory, IconChoice } from '../types';
import { calculateDistanceKm } from '../utils/geo';
import { resolveFarmIconType } from '../utils/icons';
import { CountUp } from './CountUp';
import { CuteCategoryIcon, PanelParticles } from './CursorSpotlight';

export type MobileSheetSnap = 'collapsed' | 'half' | 'full';

interface FarmDetailCardProps {
  farm: Farm;
  centralHub: CentralHub;
  biosecurityRadius: number;
  logoUrl: string;
  onClose: () => void;
  onPrevFarm?: () => void;
  onNextFarm?: () => void;
  liteMode?: boolean;
  isAdmin?: boolean;
  onSelectFarmIcon?: (farm: Farm, choice: IconChoice) => Promise<void>;
  isSingleArcActive?: boolean;
  onToggleSingleArc?: () => void;
  mobileSheetSnap?: MobileSheetSnap;
  onChangeMobileSheetSnap?: (snap: MobileSheetSnap) => void;
}

function useDeviceCardMode() {
  const [mode, setMode] = useState<
    'desktop' | 'tablet-portrait' | 'mobile-portrait' | 'mobile-landscape'
  >(() => {
    if (typeof window === 'undefined') return 'desktop';
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (h < 500 && w > h) return 'mobile-landscape';
    if (w < 640) return 'mobile-portrait';
    if (w < 1024 && h >= w) return 'tablet-portrait';
    return 'desktop';
  });

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (h < 500 && w > h) setMode('mobile-landscape');
      else if (w < 640) setMode('mobile-portrait');
      else if (w < 1024 && h >= w) setMode('tablet-portrait');
      else setMode('desktop');
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return mode;
}

function getSubTypeLabel(farm: Farm, fallbackLabel: string): string {
  if (farm.category === 'chicken' || farm.category === 'pig') {
    return fallbackLabel;
  }
  if (farm.subType === 'office') return 'Văn phòng / Điều hành';
  if (farm.subType === 'warehouse') return 'Kho vận / Lưu trữ';
  if (farm.subType === 'wash') return 'Trạm rửa xe / Sát trùng';
  return fallbackLabel;
}

/**
 * CARD THÔNG TIN TRANG TRẠI (KÍNH TRẮNG MỜ TƯƠI SÁNG + ĐÁP ỨNG ĐA THIẾT BỊ)
 * - Hiển thị toạ độ đầy đủ 6 chữ số thập phân kèm nút Copy.
 * - Nếu là trang trại chăn nuôi kết nối được (isConnectable = true), có nút "Hiện đường từ nhà máy" để bật đường cung đơn lẻ.
 * - Trên điện thoại dọc (< 640px): Bottom-sheet 3 nấc (28% / 55% / 90%), luôn thấy nút Đóng (X) và nút Chỉ đường Google Maps.
 * - Trên điện thoại ngang (height < 500px): Đặt bên phải rộng 320px, cuộn dọc bên trong.
 * - Trên iPad dọc: Bottom-sheet tối đa 60% chiều cao.
 * - Trên Laptop / iPad ngang: Đặt bên phải rộng clamp(320px, 28vw, 420px), cao tối đa calc(100dvh - 32px).
 */
export const FarmDetailCard: React.FC<FarmDetailCardProps> = ({
  farm,
  centralHub,
  biosecurityRadius,
  logoUrl,
  onClose,
  onPrevFarm,
  onNextFarm,
  liteMode = false,
  isAdmin = false,
  onSelectFarmIcon,
  isSingleArcActive = false,
  onToggleSingleArc,
  mobileSheetSnap = 'half',
  onChangeMobileSheetSnap,
}) => {
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });
  const [copied, setCopied] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [isSavingIcon, setIsSavingIcon] = useState(false);

  const deviceMode = useDeviceCardMode();

  const categoryCfg = getCategoryConfig(farm.category);
  const displayIconKey =
    farm.category === 'other' && farm.subType ? farm.subType : farm.category;
  const displayCategoryLabel = getSubTypeLabel(farm, categoryCfg.label);

  const statusCfg =
    APP_CONFIG.colors.statuses[farm.status] ||
    APP_CONFIG.colors.statuses.active;
  const distanceKm = calculateDistanceKm(
    centralHub.lat,
    centralHub.lng,
    farm.lat,
    farm.lng
  );

  const currentManualChoice: IconChoice = farm.manualIcon || 'auto';
  const autoCategory = resolveFarmIconType(farm, {});

  const handleChooseIcon = async (choice: IconChoice) => {
    if (!onSelectFarmIcon || isSavingIcon) return;
    setIsSavingIcon(true);
    try {
      await onSelectFarmIcon(farm, choice);
    } finally {
      setIsSavingIcon(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (deviceMode !== 'desktop') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -4.5;
    const rotateY = ((x - centerX) / centerX) * 4.5;
    setTilt({ rotateX, rotateY });
  };

  const handleMouseLeave = () => {
    setTilt({ rotateX: 0, rotateY: 0 });
  };

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (deviceMode === 'mobile-portrait' && onChangeMobileSheetSnap) {
      if (info.offset.y < -55 || info.velocity.y < -350) {
        if (mobileSheetSnap === 'collapsed') onChangeMobileSheetSnap('half');
        else if (mobileSheetSnap === 'half') onChangeMobileSheetSnap('full');
        return;
      }
      if (info.offset.y > 55 || info.velocity.y > 350) {
        if (mobileSheetSnap === 'full') onChangeMobileSheetSnap('half');
        else if (mobileSheetSnap === 'half')
          onChangeMobileSheetSnap('collapsed');
        else onClose();
        return;
      }
    } else if (info.offset.y > 95 || info.velocity.y > 450) {
      onClose();
    }
  };

  const cycleMobileSnap = () => {
    if (!onChangeMobileSheetSnap) return;
    if (mobileSheetSnap === 'collapsed') onChangeMobileSheetSnap('half');
    else if (mobileSheetSnap === 'half') onChangeMobileSheetSnap('full');
    else onChangeMobileSheetSnap('collapsed');
  };

  const handleCopyCoords = () => {
    navigator.clipboard
      ?.writeText(`${farm.lat.toFixed(6)}, ${farm.lng.toFixed(6)}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  };

  const googleMapsDirectionsUrl = `https://www.google.com/maps/dir/?api=1&origin=${centralHub.lat},${centralHub.lng}&destination=${farm.lat},${farm.lng}&travelmode=driving`;

  const extendedEntries = farm.extendedData
    ? Object.entries(farm.extendedData).filter(
        (entry): entry is [string, string] => Boolean(entry[1])
      )
    : [];

  // Tính class định vị & chiều cao tối đa theo thiết bị
  const wrapperClass =
    deviceMode === 'mobile-landscape'
      ? 'pointer-events-auto fixed top-2 right-2 bottom-2 z-30 flex w-[320px] flex-col'
      : deviceMode === 'mobile-portrait'
      ? 'pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full flex-col px-2 pb-[calc(var(--safe-bottom)+8px)]'
      : deviceMode === 'tablet-portrait'
      ? 'pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-xl flex-col px-3 pb-[calc(var(--safe-bottom)+12px)]'
      : 'pointer-events-auto fixed right-4 bottom-4 z-30 flex w-[clamp(320px,28vw,420px)] flex-col';

  const cardMaxHeightStyle: React.CSSProperties =
    deviceMode === 'mobile-landscape'
      ? { maxHeight: 'calc(100dvh - 16px)' }
      : deviceMode === 'mobile-portrait'
      ? {
          maxHeight:
            mobileSheetSnap === 'collapsed'
              ? '29dvh'
              : mobileSheetSnap === 'half'
              ? '56dvh'
              : '88dvh',
        }
      : deviceMode === 'tablet-portrait'
      ? { maxHeight: '60dvh' }
      : { maxHeight: 'calc(100dvh - 32px)' };

  const isCollapsedMobile =
    deviceMode === 'mobile-portrait' && mobileSheetSnap === 'collapsed';

  return (
    <motion.div
      key={farm.id}
      initial={{ opacity: 0, y: 36, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 36, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      drag={
        deviceMode === 'mobile-portrait' || deviceMode === 'tablet-portrait'
          ? 'y'
          : false
      }
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.18}
      onDragEnd={handleDragEnd}
      className={wrapperClass}
      style={{ perspective: 1100 }}
    >
      <div
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative flex w-full flex-col overflow-hidden rounded-[22px] border border-white/90 bg-white/90 text-[#0f2a24] backdrop-blur-2xl transition-all duration-200 ease-out"
        style={{
          ...cardMaxHeightStyle,
          boxShadow:
            '0 24px 60px -12px rgba(15, 42, 36, 0.24), 0 10px 24px -6px rgba(43, 143, 208, 0.16), inset 0 1px 0 0 rgba(255, 255, 255, 0.95)',
          transform:
            deviceMode === 'desktop'
              ? `rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`
              : undefined,
          transformStyle: 'preserve-3d',
        }}
      >
        <PanelParticles
          count={6}
          color={categoryCfg.hex}
          disabled={liteMode}
        />

        {/* Thanh màu điểm nhấn đỉnh Card */}
        <div
          className="h-1.5 w-full shrink-0"
          style={{
            background: `linear-gradient(90deg, #2b8fd0, ${categoryCfg.hex}, #d9261c)`,
          }}
        />

        {/* Thanh nắm kéo Bottom-sheet trên Mobile / Tablet dọc */}
        {(deviceMode === 'mobile-portrait' ||
          deviceMode === 'tablet-portrait') && (
          <div className="flex shrink-0 items-center justify-between px-4 pt-2 pb-1">
            <div className="w-16" />
            <button
              type="button"
              onClick={cycleMobileSnap}
              title="Bấm hoặc vuốt để đổi độ cao thẻ"
              className="flex h-5 w-16 items-center justify-center cursor-pointer"
            >
              <div className="h-1.5 w-11 rounded-full bg-emerald-950/25" />
            </button>
            {deviceMode === 'mobile-portrait' ? (
              <button
                type="button"
                onClick={cycleMobileSnap}
                className="flex items-center gap-0.5 rounded-full bg-emerald-950/5 px-2 py-0.5 text-[10px] font-bold text-[#2b8fd0]"
              >
                {mobileSheetSnap === 'full' ? (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    <span>Thu gọn</span>
                  </>
                ) : (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    <span>
                      {mobileSheetSnap === 'collapsed' ? 'Mở 55%' : 'Mở 90%'}
                    </span>
                  </>
                )}
              </button>
            ) : (
              <div className="w-16" />
            )}
          </div>
        )}

        {/* HEADER CỐ ĐỊNH: Phân loại + Tên trang trại + Nút điều hướng & Đóng (tối thiểu 44x44px vùng chạm) */}
        <div className="relative z-10 shrink-0 border-b border-emerald-950/10 px-4 pt-2.5 pb-3 sm:px-5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
              <span
                className="flex items-center gap-1.5"
                style={{ color: categoryCfg.hex }}
              >
                <CuteCategoryIcon
                  category={displayIconKey}
                  className="h-4 w-4"
                />
                {displayCategoryLabel}
              </span>
              <span aria-hidden="true" className="text-emerald-950/30">
                ·
              </span>
              <span
                className="flex items-center gap-1"
                style={{ color: statusCfg.color }}
              >
                {farm.status === 'active' ? (
                  <ShieldCheck className="h-3.5 w-3.5" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5" />
                )}
                {statusCfg.label}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {onPrevFarm && (
                <button
                  type="button"
                  onClick={onPrevFarm}
                  title="Trang trại trước"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-950/10 bg-white/90 text-[#0f2a24] shadow-xs transition-colors hover:border-[#2b8fd0] hover:text-[#2b8fd0] cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              {onNextFarm && (
                <button
                  type="button"
                  onClick={onNextFarm}
                  title="Trang trại tiếp theo"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-950/10 bg-white/90 text-[#0f2a24] shadow-xs transition-colors hover:border-[#2b8fd0] hover:text-[#2b8fd0] cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                title="Đóng thẻ thông tin"
                aria-label="Đóng thẻ thông tin"
                className="ml-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-emerald-950/10 bg-white/90 text-[#0f2a24] shadow-xs transition-colors hover:border-[#d9261c] hover:bg-rose-50 hover:text-[#d9261c] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Icon lớn ở đầu Card cạnh Tên Trang Trại */}
          <div className="flex items-center gap-3">
            <motion.div
              key={displayIconKey}
              initial={{ scale: 0.8, rotate: -6 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 340, damping: 18 }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 bg-white shadow-sm sm:h-12 sm:w-12"
              style={{
                borderColor: categoryCfg.hex,
                boxShadow: `0 6px 16px -4px ${categoryCfg.glow}`,
              }}
            >
              <CuteCategoryIcon
                category={displayIconKey}
                className="h-7 w-7 sm:h-8 sm:w-8"
              />
            </motion.div>

            <div className="min-w-0 flex-1">
              <h2 className="font-display line-clamp-2 text-base font-extrabold leading-snug tracking-tight text-[#0f2a24] sm:text-lg">
                {farm.name}
              </h2>
              {farm.type && !isCollapsedMobile && (
                <div className="mt-0.5 truncate text-[11px] font-semibold text-emerald-950/60">
                  Nhóm dữ liệu gốc: {farm.type}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* PHẦN NỘI DUNG CUỘN DỌC BÊN TRONG (Ẩn khi ở nấc thu gọn 28% trên mobile dọc) */}
        {!isCollapsedMobile && (
          <div className="relative z-10 flex-1 overflow-y-auto px-4 py-3.5 sm:px-5">
            {/* Hiển thị ảnh trang trại nếu dữ liệu có */}
            {farm.imageUrl && !imageError && (
              <div className="relative mb-3.5 h-36 w-full overflow-hidden rounded-2xl border border-emerald-950/10 bg-emerald-50">
                <img
                  src={farm.imageUrl}
                  alt={farm.name}
                  referrerPolicy="no-referrer"
                  onError={() => setImageError(true)}
                  className="h-full w-full object-cover"
                />
              </div>
            )}

            {/* Khối "Chọn icon" dành riêng cho QUẢN TRỊ VIÊN */}
            {isAdmin && onSelectFarmIcon && (
              <div className="mb-3.5 rounded-2xl border border-[#2b8fd0]/30 bg-gradient-to-br from-[#2b8fd0]/[0.08] to-[#10b981]/[0.06] p-3">
                <div className="mb-2 flex items-center justify-between text-[11px] font-extrabold tracking-wide text-[#0f2a24]">
                  <span className="flex items-center gap-1.5 text-[#2b8fd0]">
                    <Lock className="h-3.5 w-3.5" />
                    <span>CHỌN ICON (CHẾ ĐỘ QUẢN TRỊ)</span>
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-950/60">
                    {isSavingIcon ? 'Đang lưu...' : 'Lưu cho tất cả mọi người'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={isSavingIcon}
                    onClick={() => handleChooseIcon('chicken')}
                    className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
                      currentManualChoice === 'chicken'
                        ? 'border-[#fb923c] bg-[#fb923c] text-white shadow-[0_6px_16px_rgba(251,146,60,0.4)]'
                        : 'border-white/90 bg-white/90 text-[#0f2a24] hover:border-[#fb923c]'
                    }`}
                  >
                    <CuteCategoryIcon category="chicken" className="h-5 w-5" />
                    <span>Gà</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSavingIcon}
                    onClick={() => handleChooseIcon('pig')}
                    className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
                      currentManualChoice === 'pig'
                        ? 'border-[#fb7185] bg-[#fb7185] text-white shadow-[0_6px_16px_rgba(251,113,133,0.4)]'
                        : 'border-white/90 bg-white/90 text-[#0f2a24] hover:border-[#fb7185]'
                    }`}
                  >
                    <CuteCategoryIcon category="pig" className="h-5 w-5" />
                    <span>Heo</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSavingIcon}
                    onClick={() => handleChooseIcon('auto')}
                    className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
                      currentManualChoice === 'auto'
                        ? 'border-[#14b8a6] bg-[#14b8a6] text-white shadow-[0_6px_16px_rgba(20,184,166,0.38)]'
                        : 'border-white/90 bg-white/90 text-[#0f2a24] hover:border-[#14b8a6]'
                    }`}
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>
                      Tự động (
                      {autoCategory === 'chicken'
                        ? 'Gà'
                        : autoCategory === 'pig'
                        ? 'Heo'
                        : 'Khác'}
                      )
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Mô tả chi tiết */}
            {farm.description && (
              <p className="mb-3.5 whitespace-pre-line text-xs font-medium leading-relaxed text-[#0f2a24]/80 sm:text-sm">
                {farm.description}
              </p>
            )}

            {/* Lưới thông số chính */}
            <div className="mb-3.5 grid grid-cols-2 gap-3 border-y border-emerald-950/10 py-3">
              <div>
                <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-950/65">
                  <CuteCategoryIcon
                    category="hub"
                    className="h-3.5 w-3.5 text-[#2b8fd0]"
                  />
                  <span>Cách nhà máy trung tâm</span>
                </div>
                <div className="text-base font-extrabold text-[#2b8fd0] sm:text-lg">
                  <CountUp end={distanceKm} decimals={2} suffix=" km" />
                </div>
              </div>

              <div>
                <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-950/65">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#10b981]" />
                  <span>Bán kính ATSH</span>
                </div>
                <div className="text-base font-extrabold text-[#059669] sm:text-lg">
                  <CountUp end={biosecurityRadius} decimals={0} suffix=" m" />
                </div>
              </div>
            </div>

            {/* Toạ độ GPS đầy đủ 6 chữ số thập phân + Nút Copy */}
            <div className="mb-3.5 flex items-center justify-between gap-2 rounded-2xl border border-emerald-950/10 bg-emerald-950/[0.04] px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-1.5 text-[#0f2a24]">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[#2b8fd0]" />
                <span className="shrink-0 font-medium text-emerald-950/65">
                  Toạ độ:
                </span>
                <span className="font-mono-tabular truncate font-bold text-[#0f2a24]">
                  {farm.lat.toFixed(6)}, {farm.lng.toFixed(6)}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyCoords}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-white/80 px-2 py-1 text-[11px] font-bold text-[#2b8fd0] transition-colors hover:text-[#d9261c] cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#10b981]" />
                    <span>Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            {/* Thông tin phụ từ <ExtendedData> (KML) hoặc các cột phụ (CSV) */}
            {extendedEntries.length > 0 && (
              <div className="mb-2">
                <div className="mb-1.5 text-[11px] font-extrabold tracking-wider text-emerald-950/60 uppercase">
                  Thông số vận hành & Chuồng trại 3D
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {extendedEntries.map(([key, val]) => (
                    <div
                      key={key}
                      className="flex flex-col border-b border-emerald-950/10 pb-1.5"
                    >
                      <span className="text-[11px] font-medium text-emerald-950/60">
                        {key}
                      </span>
                      <span
                        className="truncate font-bold text-[#0f2a24]"
                        title={val}
                      >
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* FOOTER CỐ ĐỊNH: Nút "Hiện đường từ nhà máy" (cho trại gà/heo kết nối được) + Nút "CHỈ ĐƯỜNG GOOGLE MAPS" */}
        <div className="relative z-10 shrink-0 border-t border-emerald-950/10 bg-white/75 px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-2">
            {farm.isConnectable && onToggleSingleArc && (
              <button
                type="button"
                onClick={onToggleSingleArc}
                className={`flex min-h-[40px] w-full items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-extrabold transition-all cursor-pointer ${
                  isSingleArcActive
                    ? 'border-[#f59e0b] bg-amber-50 text-[#d97706] shadow-xs'
                    : 'border-[#2b8fd0]/30 bg-white text-[#2b8fd0] hover:bg-sky-50'
                }`}
              >
                <GitCommitHorizontal className="h-4 w-4" />
                <span>
                  {isSingleArcActive
                    ? 'Ẩn đường kết nối từ nhà máy'
                    : 'Hiện đường từ nhà máy'}
                </span>
              </button>
            )}

            <a
              href={googleMapsDirectionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#2b8fd0] to-[#10b981] px-5 py-2.5 text-xs font-extrabold tracking-wider text-white shadow-[0_8px_20px_rgba(43,143,208,0.32)] transition-shadow hover:shadow-[0_12px_26px_rgba(43,143,208,0.45)] sm:text-sm"
            >
              <Navigation className="h-4 w-4 fill-current" />
              <span>CHỈ ĐƯỜNG GOOGLE MAPS</span>
            </a>
          </div>

          {!isCollapsedMobile && (
            <div className="mt-2.5 flex items-center justify-center gap-2 opacity-65">
              {!logoError && (
                <img
                  src={logoUrl}
                  alt={APP_CONFIG.companyName}
                  onError={() => setLogoError(true)}
                  className="h-4 w-auto object-contain select-none"
                />
              )}
              <span className="text-[10px] font-bold tracking-wide text-[#0f2a24]">
                {APP_CONFIG.companyName}
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

interface HubDetailCardProps {
  centralHub: CentralHub;
  farms: Farm[];
  activeCategories: Record<FarmCategory, boolean>;
  logoUrl: string;
  onClose: () => void;
  onSelectFarm: (farm: Farm) => void;
  liteMode?: boolean;
  mobileSheetSnap?: MobileSheetSnap;
  onChangeMobileSheetSnap?: (snap: MobileSheetSnap) => void;
}

/**
 * CARD THÔNG TIN NHÀ MÁY TRUNG TÂM THÁI VIỆT (KHI BẤM VÀO ICON NHÀ MÁY TRUNG TÂM)
 * - Hiển thị tên, logo, toạ độ 6 chữ số thập phân kèm nút Copy
 * - Hiển thị thống kê trực tiếp: "Đang kết nối X trại gà, Y trại heo" (tự động cập nhật khi bật/tắt chip lọc)
 * - Cho phép bấm vào từng trại đang kết nối trong danh sách hoặc đóng card để thu hồi đường cung
 */
export const HubDetailCard: React.FC<HubDetailCardProps> = ({
  centralHub,
  farms,
  activeCategories,
  logoUrl,
  onClose,
  onSelectFarm,
  liteMode = false,
  mobileSheetSnap = 'half',
  onChangeMobileSheetSnap,
}) => {
  const [copied, setCopied] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const deviceMode = useDeviceCardMode();

  const connectedFarms = farms.filter(
    (f) =>
      f.isConnectable &&
      (f.category === 'chicken' || f.category === 'pig') &&
      activeCategories[f.category]
  );
  const connectedChickenCount = connectedFarms.filter(
    (f) => f.category === 'chicken'
  ).length;
  const connectedPigCount = connectedFarms.filter(
    (f) => f.category === 'pig'
  ).length;

  const handleCopyCoords = () => {
    navigator.clipboard
      ?.writeText(`${centralHub.lat.toFixed(6)}, ${centralHub.lng.toFixed(6)}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  };

  const cycleMobileSnap = () => {
    if (!onChangeMobileSheetSnap) return;
    if (mobileSheetSnap === 'collapsed') onChangeMobileSheetSnap('half');
    else if (mobileSheetSnap === 'half') onChangeMobileSheetSnap('full');
    else onChangeMobileSheetSnap('collapsed');
  };

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (deviceMode === 'mobile-portrait' && onChangeMobileSheetSnap) {
      if (info.offset.y < -55 || info.velocity.y < -350) {
        if (mobileSheetSnap === 'collapsed') onChangeMobileSheetSnap('half');
        else if (mobileSheetSnap === 'half') onChangeMobileSheetSnap('full');
        return;
      }
      if (info.offset.y > 55 || info.velocity.y > 350) {
        if (mobileSheetSnap === 'full') onChangeMobileSheetSnap('half');
        else if (mobileSheetSnap === 'half')
          onChangeMobileSheetSnap('collapsed');
        else onClose();
        return;
      }
    } else if (info.offset.y > 95 || info.velocity.y > 450) {
      onClose();
    }
  };

  const googleMapsHubUrl = `https://www.google.com/maps/search/?api=1&query=${centralHub.lat},${centralHub.lng}`;

  const wrapperClass =
    deviceMode === 'mobile-landscape'
      ? 'pointer-events-auto fixed top-2 right-2 bottom-2 z-30 flex w-[320px] flex-col'
      : deviceMode === 'mobile-portrait'
      ? 'pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full flex-col px-2 pb-[calc(var(--safe-bottom)+8px)]'
      : deviceMode === 'tablet-portrait'
      ? 'pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-xl flex-col px-3 pb-[calc(var(--safe-bottom)+12px)]'
      : 'pointer-events-auto fixed right-4 bottom-4 z-30 flex w-[clamp(320px,28vw,420px)] flex-col';

  const cardMaxHeightStyle: React.CSSProperties =
    deviceMode === 'mobile-landscape'
      ? { maxHeight: 'calc(100dvh - 16px)' }
      : deviceMode === 'mobile-portrait'
      ? {
          maxHeight:
            mobileSheetSnap === 'collapsed'
              ? '29dvh'
              : mobileSheetSnap === 'half'
              ? '56dvh'
              : '88dvh',
        }
      : deviceMode === 'tablet-portrait'
      ? { maxHeight: '60dvh' }
      : { maxHeight: 'calc(100dvh - 32px)' };

  const isCollapsedMobile =
    deviceMode === 'mobile-portrait' && mobileSheetSnap === 'collapsed';

  return (
    <motion.div
      key="central-hub-card"
      initial={{ opacity: 0, y: 36, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 36, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      drag={
        deviceMode === 'mobile-portrait' || deviceMode === 'tablet-portrait'
          ? 'y'
          : false
      }
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.18}
      onDragEnd={handleDragEnd}
      className={wrapperClass}
    >
      <div
        className="relative flex w-full flex-col overflow-hidden rounded-[22px] border border-white/95 bg-white/92 text-[#0f2a24] backdrop-blur-2xl"
        style={{
          ...cardMaxHeightStyle,
          boxShadow:
            '0 24px 60px -12px rgba(15, 42, 36, 0.25), 0 10px 24px -6px rgba(43, 143, 208, 0.2), inset 0 1px 0 0 rgba(255, 255, 255, 0.95)',
        }}
      >
        <PanelParticles count={6} color="#facc15" disabled={liteMode} />

        {/* Thanh màu điểm nhấn đỉnh Card Nhà máy Trung tâm */}
        <div
          className="h-1.5 w-full shrink-0"
          style={{
            background: 'linear-gradient(90deg, #2b8fd0, #facc15, #d9261c)',
          }}
        />

        {(deviceMode === 'mobile-portrait' ||
          deviceMode === 'tablet-portrait') && (
          <div className="flex shrink-0 items-center justify-between px-4 pt-2 pb-1">
            <div className="w-16" />
            <button
              type="button"
              onClick={cycleMobileSnap}
              className="flex h-5 w-16 items-center justify-center cursor-pointer"
            >
              <div className="h-1.5 w-11 rounded-full bg-emerald-950/25" />
            </button>
            {deviceMode === 'mobile-portrait' ? (
              <button
                type="button"
                onClick={cycleMobileSnap}
                className="flex items-center gap-0.5 rounded-full bg-emerald-950/5 px-2 py-0.5 text-[10px] font-bold text-[#2b8fd0]"
              >
                {mobileSheetSnap === 'full' ? (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    <span>Thu gọn</span>
                  </>
                ) : (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    <span>
                      {mobileSheetSnap === 'collapsed' ? 'Mở 55%' : 'Mở 90%'}
                    </span>
                  </>
                )}
              </button>
            ) : (
              <div className="w-16" />
            )}
          </div>
        )}

        {/* Header cố định */}
        <div className="relative z-10 shrink-0 border-b border-emerald-950/10 px-4 pt-2.5 pb-3 sm:px-5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#2b8fd0]">
              <Radio className="h-4 w-4 animate-pulse text-[#d9261c]" />
              <span>TRUNG TÂM ĐIỀU HÀNH & KẾT NỐI</span>
            </div>

            <button
              type="button"
              onClick={onClose}
              title="Đóng & thu hồi đường kết nối"
              aria-label="Đóng thẻ nhà máy trung tâm"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-950/10 bg-white/90 text-[#0f2a24] shadow-xs transition-colors hover:border-[#d9261c] hover:bg-rose-50 hover:text-[#d9261c] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-[#facc15] bg-white p-1.5 shadow-[0_6px_18px_rgba(250,204,21,0.35)]">
              {!logoError ? (
                <div className="h-full w-full overflow-hidden">
                  <img
                    src={logoUrl}
                    alt={centralHub.name}
                    onError={() => setLogoError(true)}
                    className="h-[132%] w-full object-cover object-top select-none"
                  />
                </div>
              ) : (
                <CuteCategoryIcon category="hub" className="h-8 w-8" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-extrabold leading-snug tracking-tight text-[#0f2a24] sm:text-lg">
                {centralHub.name}
              </h2>
              <p className="truncate text-xs font-semibold text-emerald-950/65">
                {centralHub.subtitle}
              </p>
            </div>
          </div>

          {/* Khối thống kê đường kết nối trực tiếp */}
          <div className="mt-2.5 rounded-2xl border border-[#facc15]/60 bg-gradient-to-r from-amber-50/95 via-sky-50/90 to-rose-50/90 px-3.5 py-2.5 shadow-2xs">
            <div className="text-xs font-extrabold text-[#0f2a24] sm:text-sm">
              Đang kết nối{' '}
              <span className="text-[#ea580c]">
                {connectedChickenCount} trại gà
              </span>
              ,{' '}
              <span className="text-[#e11d48]">
                {connectedPigCount} trại heo
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] font-bold text-emerald-950/70">
              <span className="inline-flex items-center gap-1 text-[#ea580c]">
                <span className="h-2 w-2 rounded-full bg-[#fb923c]" />
                Tia vàng → cam: Trại gà
              </span>
              <span className="inline-flex items-center gap-1 text-[#e11d48]">
                <span className="h-2 w-2 rounded-full bg-[#fb7185]" />
                Tia vàng → hồng: Trại heo
              </span>
            </div>
          </div>
        </div>

        {/* Nội dung cuộn dọc */}
        {!isCollapsedMobile && (
          <div className="relative z-10 flex-1 overflow-y-auto px-4 py-3.5 sm:px-5">
            {centralHub.address && (
              <p className="mb-3 text-xs font-semibold text-[#0f2a24]/80">
                Địa chỉ: {centralHub.address}
              </p>
            )}

            {/* Toạ độ GPS đầy đủ 6 chữ số thập phân + Nút Copy */}
            <div className="mb-3.5 flex items-center justify-between gap-2 rounded-2xl border border-emerald-950/10 bg-emerald-950/[0.04] px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-1.5 text-[#0f2a24]">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[#2b8fd0]" />
                <span className="shrink-0 font-medium text-emerald-950/65">
                  Toạ độ:
                </span>
                <span className="font-mono-tabular truncate font-bold text-[#0f2a24]">
                  {centralHub.lat.toFixed(6)}, {centralHub.lng.toFixed(6)}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyCoords}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-white/80 px-2 py-1 text-[11px] font-bold text-[#2b8fd0] transition-colors hover:text-[#d9261c] cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#10b981]" />
                    <span>Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            {/* Danh sách các trang trại đang kết nối */}
            <div>
              <div className="mb-2 flex items-center justify-between text-[11px] font-extrabold tracking-wider text-emerald-950/60 uppercase">
                <span>
                  Danh sách trại đang kết nối ({connectedFarms.length})
                </span>
                <span>Khoảng cách</span>
              </div>
              {connectedFarms.length === 0 ? (
                <div className="rounded-xl border border-emerald-950/10 bg-white/60 p-3 text-center text-xs font-semibold text-emerald-950/60">
                  Không có trại gà hoặc trại heo nào đang bật trong bộ lọc.
                </div>
              ) : (
                <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                  {connectedFarms.map((f) => {
                    const dist = calculateDistanceKm(
                      centralHub.lat,
                      centralHub.lng,
                      f.lat,
                      f.lng
                    );
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => onSelectFarm(f)}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border border-emerald-950/10 bg-white/85 px-3 py-2 text-left text-xs transition-colors hover:border-[#2b8fd0] hover:bg-sky-50/70 cursor-pointer"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <CuteCategoryIcon
                            category={f.category}
                            className="h-4 w-4 shrink-0"
                          />
                          <span className="truncate font-bold text-[#0f2a24]">
                            {f.name}
                          </span>
                        </div>
                        <span className="font-mono-tabular shrink-0 text-[11px] font-extrabold text-[#2b8fd0]">
                          {dist.toFixed(1)} km
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer cố định */}
        <div className="relative z-10 shrink-0 border-t border-emerald-950/10 bg-white/75 px-4 py-3 sm:px-5">
          <a
            href={googleMapsHubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#2b8fd0] to-[#10b981] px-5 py-2.5 text-xs font-extrabold tracking-wider text-white shadow-[0_8px_20px_rgba(43,143,208,0.32)] transition-shadow hover:shadow-[0_12px_26px_rgba(43,143,208,0.45)] sm:text-sm"
          >
            <Navigation className="h-4 w-4 fill-current" />
            <span>MỞ VỊ TRÍ NHÀ MÁY TRÊN GOOGLE MAPS</span>
          </a>
        </div>
      </div>
    </motion.div>
  );
};
