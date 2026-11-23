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
  Pencil,
  Radio,
  RotateCcw,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  APP_CONFIG,
  getCategoryConfig,
  PRESET_LOCATION_LABELS,
  RESPONSIVE_BREAKPOINTS,
} from '../config';
import {
  ArcColorConfig,
  CentralHub,
  Farm,
  FarmCategory,
  FarmCustomLabels,
  IconChoice,
} from '../types';
import { calculateDistanceKm } from '../utils/geo';
import {
  getDefaultLocationLabel,
  getFarmKey,
  getLocationDisplayLabel,
  resolveFarmIconType,
} from '../utils/icons';
import { CountUp } from './CountUp';
import { CuteCategoryIcon, PanelParticles } from './CursorSpotlight';

export type MobileSheetSnap = 'collapsed' | 'half' | 'full';

function extractExistingGoogleMapsUrl(
  description?: string,
  extendedData?: Record<string, string | undefined>
): string | null {
  const candidates: string[] = [];
  if (description) candidates.push(description);
  if (extendedData) {
    for (const val of Object.values(extendedData)) {
      if (val) candidates.push(val);
    }
  }
  const regex =
    /https?:\/\/(?:(?:www\.|maps\.)?google\.[a-z.]+\/maps[^\s"'<>]*|goo\.gl\/maps\/[^\s"'<>]+|maps\.app\.goo\.gl\/[^\s"'<>]+)/i;
  for (const text of candidates) {
    const match = text.match(regex);
    if (match && match[0]) {
      return match[0];
    }
  }
  return null;
}

function buildGoogleMapsShareUrl(
  lat: number,
  lng: number,
  description?: string,
  extendedData?: Record<string, string | undefined>
): string {
  const existing = extractExistingGoogleMapsUrl(description, extendedData);
  if (existing) return existing;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

interface FarmDetailCardProps {
  farm: Farm;
  centralHub: CentralHub | null;
  customLabels?: FarmCustomLabels;
  biosecurityRadius: number;
  logoUrl: string;
  onClose: () => void;
  onPrevFarm?: () => void;
  onNextFarm?: () => void;
  liteMode?: boolean;
  isAdmin?: boolean;
  onSelectFarmIcon?: (farm: Farm, choice: IconChoice) => Promise<void>;
  onSaveCustomLabel?: (farm: Farm, label: string) => Promise<void>;
  isSingleArcActive?: boolean;
  onToggleSingleArc?: () => void;
  mobileSheetSnap?: MobileSheetSnap;
  onChangeMobileSheetSnap?: (snap: MobileSheetSnap) => void;
}

function useDeviceCardMode() {
  const resolveMode = () => {
    if (typeof window === 'undefined') return 'desktop' as const;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (h < RESPONSIVE_BREAKPOINTS.landscapeShortMaxHeight && w > h) {
      return 'mobile-landscape' as const;
    }
    if (w <= RESPONSIVE_BREAKPOINTS.mobileMax) return 'mobile-portrait' as const;
    if (w <= RESPONSIVE_BREAKPOINTS.tabletMax && h >= w) {
      return 'tablet-portrait' as const;
    }
    if (w <= RESPONSIVE_BREAKPOINTS.tabletMax && w > h) {
      return 'tablet-landscape' as const;
    }
    return 'desktop' as const;
  };

  const [mode, setMode] = useState<
    | 'desktop'
    | 'tablet-landscape'
    | 'tablet-portrait'
    | 'mobile-portrait'
    | 'mobile-landscape'
  >(resolveMode);

  useEffect(() => {
    const update = () => setMode(resolveMode());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return mode;
}

/**
 * CARD THÔNG TIN TRANG TRẠI (KÍNH TRẮNG MỜ TƯƠI SÁNG + ĐÁP ỨNG ĐA THIẾT BỊ)
 * - Hiển thị nhãn mô tả (nhãn tùy chỉnh của Admin từ Upstash Redis hoặc tự động thông minh) kèm nút "Sửa mô tả" cho Quản trị viên.
 * - Hiển thị toạ độ đầy đủ 6 chữ số thập phân kèm nút Copy.
 * - Nếu là trang trại chăn nuôi kết nối được (isConnectable = true), có nút "Hiện đường từ Nhà Máy Cám" để bật đường cung đơn lẻ.
 */
export const FarmDetailCard: React.FC<FarmDetailCardProps> = ({
  farm,
  centralHub,
  customLabels,
  biosecurityRadius,
  logoUrl,
  onClose,
  onPrevFarm,
  onNextFarm,
  liteMode = false,
  isAdmin = false,
  onSelectFarmIcon,
  onSaveCustomLabel,
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

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false);
  const [shareToast, setShareToast] = useState('');

  const showShareToast = (msg: string) => {
    setShareToast(msg);
    setTimeout(() => setShareToast(''), 2000);
  };



  const deviceMode = useDeviceCardMode();

  const categoryCfg = getCategoryConfig(farm.category);
  const displayIconKey =
    farm.subType === 'hub'
      ? 'hub'
      : farm.category === 'other' && farm.subType
      ? farm.subType
      : farm.category;
  const farmKey = farm.farmKey || getFarmKey(farm.lat, farm.lng);
  const hasCustomLabel = Boolean(customLabels?.[farmKey]?.trim());
  const defaultAutoLabel = getDefaultLocationLabel(farm);
  const displayCategoryLabel = getLocationDisplayLabel(farm, customLabels);

  const mapsLink = buildGoogleMapsShareUrl(
    farm.lat,
    farm.lng,
    farm.description,
    farm.extendedData
  );
  const shareText = `${farm.name}\nLoại: ${displayCategoryLabel}\nToạ độ: ${farm.lat.toFixed(6)}, ${farm.lng.toFixed(6)}\nGoogle Maps: ${mapsLink}`;

  const handleShare = () => {
    const isMobileDevice =
      deviceMode === 'mobile-portrait' || deviceMode === 'mobile-landscape';
    if (
      isMobileDevice &&
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      navigator
        .share({
          title: farm.name,
          text: shareText,
        })
        .catch((err) => {
          if (err && (err as Error).name === 'AbortError') return;
          setIsShareMenuOpen(true);
        });
    } else {
      setIsShareMenuOpen((prev) => !prev);
    }
  };

  const copyToClipboard = (
    textToCopy: string,
    successMsg: string,
    closeMenu = true
  ) => {
    if (!navigator.clipboard?.writeText) {
      showShareToast('Không thể sao chép');
      return;
    }
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        showShareToast(successMsg);
        if (closeMenu) setIsShareMenuOpen(false);
      })
      .catch(() => {
        showShareToast('Không thể sao chép');
      });
  };

  useEffect(() => {
    setIsEditingLabel(false);
    setLabelInput(displayCategoryLabel);
  }, [farm.id, displayCategoryLabel]);

  const statusCfg =
    APP_CONFIG.colors.statuses[farm.status] ||
    APP_CONFIG.colors.statuses.active;
  const distanceKm = centralHub
    ? calculateDistanceKm(centralHub.lat, centralHub.lng, farm.lat, farm.lng)
    : null;

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

  const handleCommitLabel = async (nextValue: string) => {
    if (!onSaveCustomLabel || isSavingLabel) return;
    setIsSavingLabel(true);
    try {
      await onSaveCustomLabel(farm, nextValue.trim());
      setIsEditingLabel(false);
    } finally {
      setIsSavingLabel(false);
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

  const googleMapsDirectionsUrl = centralHub
    ? `https://www.google.com/maps/dir/?api=1&origin=${centralHub.lat},${centralHub.lng}&destination=${farm.lat},${farm.lng}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${farm.lat},${farm.lng}&travelmode=driving`;

  const extendedEntries = farm.extendedData
    ? Object.entries(farm.extendedData).filter(
        (entry): entry is [string, string] => Boolean(entry[1])
      )
    : [];

  // Tính class định vị & chiều cao tối đa theo thiết bị (320px -> 4K)
  const wrapperClass =
    deviceMode === 'mobile-landscape'
      ? 'pointer-events-auto fixed top-2 right-2 bottom-2 z-30 flex w-[min(320px,44vw)] flex-col'
      : deviceMode === 'mobile-portrait'
      ? 'pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full flex-col px-2 pb-[calc(var(--safe-bottom)+8px)]'
      : deviceMode === 'tablet-portrait'
      ? 'pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-xl flex-col px-3 pb-[calc(var(--safe-bottom)+12px)]'
      : deviceMode === 'tablet-landscape'
      ? 'pointer-events-auto fixed right-3 bottom-3 z-30 flex w-[clamp(320px,36vw,380px)] flex-col'
      : 'pointer-events-auto fixed right-4 bottom-4 z-30 flex w-[clamp(340px,28vw,420px)] flex-col';

  const cardMaxHeightStyle: React.CSSProperties =
    deviceMode === 'mobile-landscape'
      ? { maxHeight: 'calc(100dvh - 16px)' }
      : deviceMode === 'mobile-portrait'
      ? {
          maxHeight:
            mobileSheetSnap === 'collapsed'
              ? '28dvh'
              : mobileSheetSnap === 'half'
              ? '55dvh'
              : '86dvh',
        }
      : deviceMode === 'tablet-portrait'
      ? { maxHeight: '56dvh' }
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
                <span>{displayCategoryLabel}</span>
              </span>
              {isAdmin && onSaveCustomLabel && (
                <button
                  type="button"
                  onClick={() => {
                    setLabelInput(displayCategoryLabel);
                    setIsEditingLabel((prev) => !prev);
                  }}
                  title="Sửa nhãn mô tả phân loại"
                  className="inline-flex items-center gap-1 rounded-full border border-[#2b8fd0]/30 bg-[#2b8fd0]/10 px-2 py-0.5 text-[10px] font-extrabold text-[#2b8fd0] transition-colors hover:bg-[#2b8fd0] hover:text-white cursor-pointer"
                >
                  <Pencil className="h-2.5 w-2.5" />
                  <span>Sửa mô tả</span>
                </button>
              )}
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

            <div className="flex shrink-0 items-center gap-1">
              {onPrevFarm && (
                <button
                  type="button"
                  onClick={onPrevFarm}
                  title="Trang trại trước"
                  aria-label="Trang trại trước"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-950/10 bg-white/90 text-[#0f2a24] shadow-xs transition-colors hover:border-[#2b8fd0] hover:text-[#2b8fd0] cursor-pointer sm:h-9 sm:w-9"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              {onNextFarm && (
                <button
                  type="button"
                  onClick={onNextFarm}
                  title="Trang trại tiếp theo"
                  aria-label="Trang trại tiếp theo"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-950/10 bg-white/90 text-[#0f2a24] shadow-xs transition-colors hover:border-[#2b8fd0] hover:text-[#2b8fd0] cursor-pointer sm:h-9 sm:w-9"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                title="Đóng thẻ thông tin"
                aria-label="Đóng thẻ thông tin"
                className="ml-0.5 flex h-10 w-10 items-center justify-center rounded-full border border-emerald-950/10 bg-white/90 text-[#0f2a24] shadow-xs transition-colors hover:border-[#d9261c] hover:bg-rose-50 hover:text-[#d9261c] cursor-pointer sm:h-9 sm:w-9"
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
              <h2 className="font-display line-clamp-2 break-words text-[clamp(0.95rem,2.4vw,1.125rem)] font-extrabold leading-snug tracking-tight text-[#0f2a24]">
                {farm.name}
              </h2>
              {farm.type && !isCollapsedMobile && (
                <div className="mt-0.5 truncate text-[11px] font-semibold text-emerald-950/60">
                  Nhóm dữ liệu gốc: {farm.type}
                </div>
              )}
            </div>
          </div>

          {/* Bộ chỉnh sửa Nhãn mô tả inline cho Quản trị viên */}
          {isAdmin && onSaveCustomLabel && isEditingLabel && (
            <div className="mt-2.5 rounded-2xl border border-[#2b8fd0]/30 bg-sky-50/85 p-2.5 text-xs">
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-extrabold tracking-wide text-[#2b8fd0] uppercase">
                <span>Chỉnh sửa nhãn mô tả (Lưu cho mọi người)</span>
                {hasCustomLabel && (
                  <button
                    type="button"
                    disabled={isSavingLabel}
                    onClick={() => handleCommitLabel('')}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-950/70 hover:text-[#d9261c] cursor-pointer"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    <span>Mặc định ({defaultAutoLabel})</span>
                  </button>
                )}
              </div>

              <div className="mb-2 flex flex-wrap gap-1">
                {PRESET_LOCATION_LABELS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={isSavingLabel}
                    onClick={() => setLabelInput(preset)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors cursor-pointer ${
                      labelInput.trim() === preset
                        ? 'bg-[#2b8fd0] text-white'
                        : 'border border-emerald-950/15 bg-white text-[#0f2a24] hover:border-[#2b8fd0]'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={labelInput}
                  maxLength={60}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCommitLabel(labelInput);
                    }
                  }}
                  placeholder="Nhập nhãn mô tả tùy chỉnh..."
                  className="min-w-0 flex-1 rounded-xl border border-[#2b8fd0]/35 bg-white px-2.5 py-1.5 text-[16px] font-semibold text-[#0f2a24] focus:border-[#2b8fd0] focus:outline-none sm:text-xs"
                />
                <button
                  type="button"
                  disabled={isSavingLabel}
                  onClick={() => handleCommitLabel(labelInput)}
                  className="shrink-0 rounded-xl bg-[#2b8fd0] px-3 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-[#1e74ad] disabled:opacity-60 cursor-pointer"
                >
                  {isSavingLabel ? '...' : 'Lưu'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingLabel(false)}
                  className="shrink-0 rounded-xl border border-emerald-950/15 bg-white px-2 py-1.5 text-xs font-bold text-[#0f2a24] hover:bg-emerald-950/5 cursor-pointer"
                >
                  Huỷ
                </button>
              </div>
            </div>
          )}
        </div>

        {/* PHẦN NỘI DUNG CUỘN DỌC BÊN TRONG (Ẩn khi ở nấc thu gọn 28% trên mobile dọc) */}
        {!isCollapsedMobile && (
          <div className="relative z-10 flex-1 overflow-y-auto px-4 py-3.5 sm:px-5">
            {/* Hiển thị ảnh trang trại nếu dữ liệu có (lazy-load tối ưu mobile) */}
            {farm.imageUrl && !imageError && (
              <div className="relative mb-3.5 h-36 w-full overflow-hidden rounded-2xl border border-emerald-950/10 bg-emerald-50">
                <img
                  src={farm.imageUrl}
                  alt={farm.name}
                  loading="lazy"
                  decoding="async"
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
              <p className="mb-3.5 break-words whitespace-pre-line text-xs font-medium leading-relaxed text-[#0f2a24]/80 sm:text-sm">
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
                  <span>Cách {centralHub?.name || 'Nhà Máy Cám'}</span>
                </div>
                <div className="text-base font-extrabold text-[#2b8fd0] sm:text-lg">
                  {distanceKm !== null ? (
                    <CountUp end={distanceKm} decimals={2} suffix=" km" />
                  ) : (
                    <span>—</span>
                  )}
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
            {farm.isConnectable && centralHub && onToggleSingleArc && (
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
                    ? `Ẩn đường kết nối từ ${centralHub.name}`
                    : `Hiện đường từ ${centralHub.name}`}
                </span>
              </button>
            )}

            {shareToast && !isShareMenuOpen && (
              <div className="rounded-xl bg-emerald-500 px-3 py-1.5 text-center text-xs font-bold text-white shadow-xs">
                {shareToast}
              </div>
            )}
            <div className="relative flex gap-2">
              <button
                type="button"
                onClick={handleShare}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full border border-emerald-950/20 bg-white/90 px-4 py-2.5 text-xs font-extrabold text-[#0f2a24] shadow-xs hover:border-[#2b8fd0] hover:bg-sky-50 transition-all cursor-pointer"
              >
                <Share2 className="h-4 w-4 text-[#2b8fd0]" />
                <span>Chia sẻ vị trí</span>
              </button>

              <a
                href={googleMapsDirectionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[44px] flex-[1.4] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#2b8fd0] to-[#10b981] px-4 py-2.5 text-xs font-extrabold tracking-wider text-white shadow-[0_8px_20px_rgba(43,143,208,0.32)] transition-shadow hover:shadow-[0_12px_26px_rgba(43,143,208,0.45)] sm:text-sm"
              >
                <Navigation className="h-4 w-4 fill-current" />
                <span>CHỈ ĐƯỜNG</span>
              </a>
            </div>

            {/* Menu chia sẻ dự phòng */}
            {isShareMenuOpen && (
              <div className="absolute inset-x-4 bottom-full mb-2 overflow-hidden rounded-2xl border border-white bg-white/95 p-3 shadow-2xl backdrop-blur-xl z-30 text-xs space-y-1.5">
                <div className="font-extrabold text-[#0f2a24] pb-1 border-b border-emerald-950/10 flex justify-between items-center">
                  <span>Chia sẻ vị trí</span>
                  <button type="button" onClick={() => setIsShareMenuOpen(false)} className="text-emerald-950/50 hover:text-[#d9261c] cursor-pointer">✕</button>
                </div>
                {shareToast && (
                  <div className="rounded-xl bg-emerald-500 px-3 py-1.5 text-center font-bold text-white shadow-xs">
                    {shareToast}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => copyToClipboard(shareText, 'Đã sao chép nội dung chia sẻ!')}
                  className="w-full text-left rounded-xl px-3 py-2 font-bold text-[#0f2a24] hover:bg-sky-50 transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Copy className="h-3.5 w-3.5 text-[#2b8fd0]" />
                  <span>Sao chép nội dung chia sẻ</span>
                </button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(mapsLink, 'Đã sao chép link Google Maps!')}
                  className="w-full text-left rounded-xl px-3 py-2 font-bold text-[#0f2a24] hover:bg-sky-50 transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Copy className="h-3.5 w-3.5 text-[#f59e0b]" />
                  <span>Sao chép link Google Maps</span>
                </button>
                <div className="pt-1.5 border-t border-emerald-950/10 flex flex-wrap gap-1">
                  <a href={`https://zalo.me/share?url=${encodeURIComponent(mapsLink)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-600 hover:bg-blue-100">Zalo</a>
                  <a href="https://www.messenger.com/" target="_blank" rel="noopener noreferrer" onClick={() => copyToClipboard(shareText, 'Đã sao chép! Dán vào Messenger để gửi.', false)} className="rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700 hover:bg-sky-100">Messenger</a>
                  <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(mapsLink)}&quote=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-600 hover:bg-indigo-100">Facebook</a>
                  <a href={`https://t.me/share/url?url=${encodeURIComponent(mapsLink)}&text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-600 hover:bg-sky-100">Telegram</a>
                  <a href={`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600 hover:bg-emerald-100">WhatsApp</a>
                  <a href={`mailto:?subject=${encodeURIComponent(farm.name)}&body=${encodeURIComponent(shareText)}`} className="rounded-lg bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-100">Email</a>
                </div>
              </div>
            )}
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
  feedMillFarm?: Farm | null;
  customLabels?: FarmCustomLabels;
  farms: Farm[];
  activeCategories: Record<FarmCategory, boolean>;
  logoUrl: string;
  onClose: () => void;
  onSelectFarm: (farm: Farm) => void;
  liteMode?: boolean;
  isAdmin?: boolean;
  onSaveCustomLabel?: (farm: Farm, label: string) => Promise<void>;
  arcColors?: ArcColorConfig;
  onSaveArcColors?: (colors: ArcColorConfig) => Promise<void>;
  mobileSheetSnap?: MobileSheetSnap;
  onChangeMobileSheetSnap?: (snap: MobileSheetSnap) => void;
}

/**
 * CARD THÔNG TIN NHÀ MÁY CÁM (LẤY TRỰC TIẾP TỪ DỮ LIỆU GOOGLE MY MAPS)
 * - Hiển thị tên thật, nhãn mô tả (có nút Sửa mô tả cho Quản trị viên), toạ độ 6 chữ số thập phân kèm nút Copy
 * - Hiển thị thống kê trực tiếp: "Độ phủ cung ứng: X trại gà, Y trại heo"
 * - Cho phép bấm vào từng trại đang kết nối trong danh sách hoặc đóng card để thu hồi đường cung
 */
export const HubDetailCard: React.FC<HubDetailCardProps> = ({
  centralHub,
  feedMillFarm,
  customLabels,
  farms,
  activeCategories,
  logoUrl,
  onClose,
  onSelectFarm,
  liteMode = false,
  isAdmin = false,
  onSaveCustomLabel,
  arcColors,
  onSaveArcColors,
  mobileSheetSnap = 'half',
  onChangeMobileSheetSnap,
}) => {
  const [copied, setCopied] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false);
  const [shareToast, setShareToast] = useState('');
  const deviceMode = useDeviceCardMode();

  const showShareToast = (msg: string) => {
    setShareToast(msg);
    setTimeout(() => setShareToast(''), 2000);
  };

  const hubDisplayLabel = feedMillFarm
    ? getLocationDisplayLabel(feedMillFarm, customLabels)
    : 'Nhà máy cám';

  const googleMapsHubUrl = `https://www.google.com/maps/search/?api=1&query=${centralHub.lat},${centralHub.lng}`;
  const mapsHubShareLink = buildGoogleMapsShareUrl(
    centralHub.lat,
    centralHub.lng,
    feedMillFarm?.description || centralHub.address,
    feedMillFarm?.extendedData
  );
  const shareHubText = `${centralHub.name}\nLoại: ${hubDisplayLabel}\nToạ độ: ${centralHub.lat.toFixed(6)}, ${centralHub.lng.toFixed(6)}\nGoogle Maps: ${mapsHubShareLink}`;

  const handleShareHub = () => {
    const isMobileDevice =
      deviceMode === 'mobile-portrait' || deviceMode === 'mobile-landscape';
    if (
      isMobileDevice &&
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      navigator
        .share({
          title: centralHub.name,
          text: shareHubText,
        })
        .catch((err) => {
          if (err && (err as Error).name === 'AbortError') return;
          setIsShareMenuOpen(true);
        });
    } else {
      setIsShareMenuOpen((prev) => !prev);
    }
  };

  const copyHubToClipboard = (
    textToCopy: string,
    successMsg: string,
    closeMenu = true
  ) => {
    if (!navigator.clipboard?.writeText) {
      showShareToast('Không thể sao chép');
      return;
    }
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        showShareToast(successMsg);
        if (closeMenu) setIsShareMenuOpen(false);
      })
      .catch(() => {
        showShareToast('Không thể sao chép');
      });
  };

  const currentArcColors = arcColors || {
    chicken: { from: '#FACC15', to: '#F97316' },
    pig: { from: '#FACC15', to: '#FB7185' },
  };

  const [draftArcColors, setDraftArcColors] = useState<ArcColorConfig>(currentArcColors);
  const [isEditingArcs, setIsEditingArcs] = useState(false);
  const [isSavingArcs, setIsSavingArcs] = useState(false);
  const [arcSaveError, setArcSaveError] = useState('');

  useEffect(() => {
    setDraftArcColors(currentArcColors);
  }, [arcColors]);

  const hasUnsavedArcs = JSON.stringify(draftArcColors) !== JSON.stringify(currentArcColors);

  const PRESET_PALETTES = [
    { name: 'Mặc định', chicken: { from: '#FACC15', to: '#F97316' }, pig: { from: '#FACC15', to: '#FB7185' } },
    { name: 'Hoàng hôn', chicken: { from: '#EF4444', to: '#F97316' }, pig: { from: '#8B5CF6', to: '#EC4899' } },
    { name: 'Đại dương', chicken: { from: '#3B82F6', to: '#14B8A6' }, pig: { from: '#14B8A6', to: '#10B981' } },
    { name: 'Rừng xanh', chicken: { from: '#10B981', to: '#FACC15' }, pig: { from: '#14B8A6', to: '#3B82F6' } },
  ];

  const handleCommitHubLabel = async (nextVal: string) => {
    if (!feedMillFarm || !onSaveCustomLabel || isSavingLabel) return;
    setIsSavingLabel(true);
    try {
      await onSaveCustomLabel(feedMillFarm, nextVal.trim());
      setIsEditingLabel(false);
    } finally {
      setIsSavingLabel(false);
    }
  };

  const connectedFarms = farms.filter(
    (f) =>
      !f.isFeedMill &&
      f.id !== centralHub.id &&
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

  const wrapperClass =
    deviceMode === 'mobile-landscape'
      ? 'pointer-events-auto fixed top-2 right-2 bottom-2 z-30 flex w-[min(320px,44vw)] flex-col'
      : deviceMode === 'mobile-portrait'
      ? 'pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full flex-col px-2 pb-[calc(var(--safe-bottom)+8px)]'
      : deviceMode === 'tablet-portrait'
      ? 'pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-xl flex-col px-3 pb-[calc(var(--safe-bottom)+12px)]'
      : deviceMode === 'tablet-landscape'
      ? 'pointer-events-auto fixed right-3 bottom-3 z-30 flex w-[clamp(320px,36vw,380px)] flex-col'
      : 'pointer-events-auto fixed right-4 bottom-4 z-30 flex w-[clamp(340px,28vw,420px)] flex-col';

  const cardMaxHeightStyle: React.CSSProperties =
    deviceMode === 'mobile-landscape'
      ? { maxHeight: 'calc(100dvh - 16px)' }
      : deviceMode === 'mobile-portrait'
      ? {
          maxHeight:
            mobileSheetSnap === 'collapsed'
              ? '28dvh'
              : mobileSheetSnap === 'half'
              ? '55dvh'
              : '86dvh',
        }
      : deviceMode === 'tablet-portrait'
      ? { maxHeight: '56dvh' }
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
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-extrabold text-[#2b8fd0]">
              <Radio className="h-4 w-4 animate-pulse text-[#d9261c]" />
              <span>{hubDisplayLabel.toUpperCase()}</span>
              {isAdmin && feedMillFarm && onSaveCustomLabel && (
                <button
                  type="button"
                  onClick={() => {
                    setLabelInput(hubDisplayLabel);
                    setIsEditingLabel((prev) => !prev);
                  }}
                  title="Sửa nhãn mô tả phân loại"
                  className="inline-flex items-center gap-1 rounded-full border border-[#2b8fd0]/30 bg-[#2b8fd0]/10 px-2 py-0.5 text-[10px] font-extrabold text-[#2b8fd0] transition-colors hover:bg-[#2b8fd0] hover:text-white cursor-pointer"
                >
                  <Pencil className="h-2.5 w-2.5" />
                  <span>Sửa mô tả</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              title="Đóng & thu hồi đường kết nối"
              aria-label="Đóng thẻ Nhà Máy Cám"
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

          {isAdmin && feedMillFarm && onSaveCustomLabel && isEditingLabel && (
            <div className="mt-2.5 rounded-2xl border border-[#2b8fd0]/30 bg-sky-50/85 p-2.5 text-xs">
              <div className="mb-1.5 flex flex-wrap gap-1">
                {PRESET_LOCATION_LABELS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={isSavingLabel}
                    onClick={() => setLabelInput(preset)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors cursor-pointer ${
                      labelInput.trim() === preset
                        ? 'bg-[#2b8fd0] text-white'
                        : 'border border-emerald-950/15 bg-white text-[#0f2a24] hover:border-[#2b8fd0]'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={labelInput}
                  maxLength={60}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCommitHubLabel(labelInput);
                    }
                  }}
                  placeholder="Nhập nhãn mô tả..."
                  className="min-w-0 flex-1 rounded-xl border border-[#2b8fd0]/35 bg-white px-2.5 py-1.5 text-[16px] font-semibold text-[#0f2a24] focus:border-[#2b8fd0] focus:outline-none sm:text-xs"
                />
                <button
                  type="button"
                  disabled={isSavingLabel}
                  onClick={() => handleCommitHubLabel(labelInput)}
                  className="shrink-0 rounded-xl bg-[#2b8fd0] px-3 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-[#1e74ad] disabled:opacity-60 cursor-pointer"
                >
                  {isSavingLabel ? '...' : 'Lưu'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingLabel(false)}
                  className="shrink-0 rounded-xl border border-emerald-950/15 bg-white px-2 py-1.5 text-xs font-bold text-[#0f2a24] cursor-pointer"
                >
                  Huỷ
                </button>
              </div>
            </div>
          )}

          {/* Khối thống kê độ phủ cung ứng trực tiếp */}
          <div className="mt-2.5 rounded-2xl border border-[#facc15]/60 bg-gradient-to-r from-amber-50/95 via-sky-50/90 to-rose-50/90 px-3.5 py-2.5 shadow-2xs">
            <div className="text-xs font-extrabold text-[#0f2a24] sm:text-sm">
              Độ phủ cung ứng:{' '}
              <span style={{ color: currentArcColors.chicken.to }}>
                {connectedChickenCount} trại gà
              </span>
              ,{' '}
              <span style={{ color: currentArcColors.pig.to }}>
                {connectedPigCount} trại heo
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] font-bold text-emerald-950/70">
              <span className="inline-flex items-center gap-1.5" style={{ color: currentArcColors.chicken.to }}>
                <span
                  className="h-2.5 w-4 rounded-full shadow-xs shrink-0"
                  style={{
                    background: `linear-gradient(90deg, ${currentArcColors.chicken.from}, ${currentArcColors.chicken.to})`,
                  }}
                />
                <span>Trại gà ({currentArcColors.chicken.from} → {currentArcColors.chicken.to})</span>
              </span>
              <span className="inline-flex items-center gap-1.5" style={{ color: currentArcColors.pig.to }}>
                <span
                  className="h-2.5 w-4 rounded-full shadow-xs shrink-0"
                  style={{
                    background: `linear-gradient(90deg, ${currentArcColors.pig.from}, ${currentArcColors.pig.to})`,
                  }}
                />
                <span>Trại heo ({currentArcColors.pig.from} → {currentArcColors.pig.to})</span>
              </span>
            </div>
          </div>

          {isAdmin && onSaveArcColors && (
            <div className="mt-2 rounded-2xl border border-[#2b8fd0]/30 bg-sky-50/90 p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsEditingArcs((prev) => !prev)}
                  className="flex items-center gap-1.5 font-bold text-[#2b8fd0] cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Tuỳ chỉnh màu tia cung ứng {isEditingArcs ? '▲' : '▼'}</span>
                </button>
                {hasUnsavedArcs && (
                  <span className="text-[10px] font-extrabold text-amber-600 animate-pulse">Chưa lưu</span>
                )}
              </div>

              {isEditingArcs && (
                <div className="mt-2.5 space-y-3">
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[10px] font-bold text-emerald-950/70 self-center mr-1">Bộ phối:</span>
                    {PRESET_PALETTES.map((pal) => (
                      <button
                        key={pal.name}
                        type="button"
                        onClick={() => setDraftArcColors(pal.name === 'Mặc định' ? { chicken: { from: '#FACC15', to: '#F97316' }, pig: { from: '#FACC15', to: '#FB7185' } } : pal)}
                        className="rounded-full border border-emerald-950/15 bg-white px-2 py-0.5 text-[10px] font-bold text-[#0f2a24] hover:border-[#2b8fd0] cursor-pointer"
                      >
                        {pal.name}
                      </button>
                    ))}
                  </div>

                  {/* Chicken */}
                  <div className="rounded-xl border border-emerald-950/10 bg-white/80 p-2">
                    <div className="mb-1 text-[11px] font-extrabold" style={{ color: draftArcColors.chicken.to }}>Trại gà (Chicken):</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-emerald-950/60">Màu đầu (Nhà máy):</label>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <input
                            type="color"
                            value={draftArcColors.chicken.from}
                            onChange={(e) => setDraftArcColors({ ...draftArcColors, chicken: { ...draftArcColors.chicken, from: e.target.value } })}
                            className="h-7 w-7 rounded border border-emerald-950/20 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={draftArcColors.chicken.from}
                            onChange={(e) => setDraftArcColors({ ...draftArcColors, chicken: { ...draftArcColors.chicken, from: e.target.value } })}
                            className="w-20 rounded border border-emerald-950/20 px-1.5 py-1 text-[11px] font-mono uppercase"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-emerald-950/60">Màu cuối (Trại):</label>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <input
                            type="color"
                            value={draftArcColors.chicken.to}
                            onChange={(e) => setDraftArcColors({ ...draftArcColors, chicken: { ...draftArcColors.chicken, to: e.target.value } })}
                            className="h-7 w-7 rounded border border-emerald-950/20 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={draftArcColors.chicken.to}
                            onChange={(e) => setDraftArcColors({ ...draftArcColors, chicken: { ...draftArcColors.chicken, to: e.target.value } })}
                            className="w-20 rounded border border-emerald-950/20 px-1.5 py-1 text-[11px] font-mono uppercase"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Pig */}
                  <div className="rounded-xl border border-emerald-950/10 bg-white/80 p-2">
                    <div className="mb-1 text-[11px] font-extrabold" style={{ color: draftArcColors.pig.to }}>Trại heo (Pig):</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-emerald-950/60">Màu đầu (Nhà máy):</label>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <input
                            type="color"
                            value={draftArcColors.pig.from}
                            onChange={(e) => setDraftArcColors({ ...draftArcColors, pig: { ...draftArcColors.pig, from: e.target.value } })}
                            className="h-7 w-7 rounded border border-emerald-950/20 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={draftArcColors.pig.from}
                            onChange={(e) => setDraftArcColors({ ...draftArcColors, pig: { ...draftArcColors.pig, from: e.target.value } })}
                            className="w-20 rounded border border-emerald-950/20 px-1.5 py-1 text-[11px] font-mono uppercase"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-emerald-950/60">Màu cuối (Trại):</label>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <input
                            type="color"
                            value={draftArcColors.pig.to}
                            onChange={(e) => setDraftArcColors({ ...draftArcColors, pig: { ...draftArcColors.pig, to: e.target.value } })}
                            className="h-7 w-7 rounded border border-emerald-950/20 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={draftArcColors.pig.to}
                            onChange={(e) => setDraftArcColors({ ...draftArcColors, pig: { ...draftArcColors.pig, to: e.target.value } })}
                            className="w-20 rounded border border-emerald-950/20 px-1.5 py-1 text-[11px] font-mono uppercase"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setDraftArcColors({ chicken: { from: '#FACC15', to: '#F97316' }, pig: { from: '#FACC15', to: '#FB7185' } })}
                      className="rounded-lg border border-emerald-950/15 bg-white px-2.5 py-1 text-[11px] font-bold text-[#0f2a24] cursor-pointer"
                    >
                      Khôi phục mặc định
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDraftArcColors(currentArcColors)}
                        className="rounded-lg bg-emerald-950/10 px-2.5 py-1 text-[11px] font-bold text-[#0f2a24] cursor-pointer"
                      >
                        Huỷ
                      </button>
                      <button
                        type="button"
                        disabled={isSavingArcs}
                        onClick={async () => {
                          setIsSavingArcs(true);
                          setArcSaveError('');
                          try {
                            await onSaveArcColors(draftArcColors);
                          } catch (err) {
                            setArcSaveError(err instanceof Error ? err.message : 'Lỗi lưu màu');
                          } finally {
                            setIsSavingArcs(false);
                          }
                        }}
                        className="rounded-lg bg-[#2b8fd0] px-3.5 py-1 text-[11px] font-extrabold text-white shadow-xs hover:bg-[#1e74ad] disabled:opacity-60 cursor-pointer"
                      >
                        {isSavingArcs ? 'Đang lưu...' : 'Lưu màu lên Upstash'}
                      </button>
                    </div>
                  </div>
                  {arcSaveError && <div className="text-[10px] font-bold text-rose-600">{arcSaveError}</div>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nội dung cuộn dọc */}
        {!isCollapsedMobile && (
          <div className="relative z-10 flex-1 overflow-y-auto px-4 py-3.5 sm:px-5">
            {centralHub.address && (
              <p className="mb-3 break-words text-xs font-semibold text-[#0f2a24]/80">
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
          <div className="relative flex flex-col gap-2">
            {shareToast && (
              <div className="rounded-xl bg-emerald-500 px-3 py-1.5 text-center font-bold text-white shadow-xs">
                {shareToast}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleShareHub}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full border border-emerald-950/20 bg-white/90 px-4 py-2.5 text-xs font-extrabold text-[#0f2a24] shadow-xs hover:border-[#2b8fd0] hover:bg-sky-50 transition-all cursor-pointer"
              >
                <Share2 className="h-4 w-4 text-[#2b8fd0]" />
                <span>Chia sẻ vị trí</span>
              </button>

              <a
                href={googleMapsHubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[44px] flex-[1.4] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#2b8fd0] to-[#10b981] px-4 py-2.5 text-xs font-extrabold tracking-wider text-white shadow-[0_8px_20px_rgba(43,143,208,0.32)] transition-shadow hover:shadow-[0_12px_26px_rgba(43,143,208,0.45)] sm:text-sm"
              >
                <Navigation className="h-4 w-4 fill-current" />
                <span>MỞ GOOGLE MAPS</span>
              </a>
            </div>

            {/* Menu chia sẻ dự phòng */}
            {isShareMenuOpen && (
              <div className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-2xl border border-white bg-white/95 p-3 shadow-2xl backdrop-blur-xl z-30 text-xs space-y-1.5">
                <div className="font-extrabold text-[#0f2a24] pb-1 border-b border-emerald-950/10 flex justify-between items-center">
                  <span>Chia sẻ vị trí nhà máy</span>
                  <button type="button" onClick={() => setIsShareMenuOpen(false)} className="text-emerald-950/50 hover:text-[#d9261c] cursor-pointer">✕</button>
                </div>
                <button
                  type="button"
                  onClick={() => copyHubToClipboard(shareHubText, 'Đã sao chép nội dung chia sẻ!')}
                  className="w-full text-left rounded-xl px-3 py-2 font-bold text-[#0f2a24] hover:bg-sky-50 transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Copy className="h-3.5 w-3.5 text-[#2b8fd0]" />
                  <span>Sao chép nội dung chia sẻ</span>
                </button>
                <button
                  type="button"
                  onClick={() => copyHubToClipboard(mapsHubShareLink, 'Đã sao chép link Google Maps!')}
                  className="w-full text-left rounded-xl px-3 py-2 font-bold text-[#0f2a24] hover:bg-sky-50 transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Copy className="h-3.5 w-3.5 text-[#f59e0b]" />
                  <span>Sao chép link Google Maps</span>
                </button>
                <div className="pt-1.5 border-t border-emerald-950/10 flex flex-wrap gap-1">
                  <a href={`https://zalo.me/share?url=${encodeURIComponent(mapsHubShareLink)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-600 hover:bg-blue-100">Zalo</a>
                  <a href="https://www.messenger.com/" target="_blank" rel="noopener noreferrer" onClick={() => copyHubToClipboard(shareHubText, 'Đã sao chép! Dán vào Messenger để gửi.', false)} className="rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700 hover:bg-sky-100">Messenger</a>
                  <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(mapsHubShareLink)}&quote=${encodeURIComponent(shareHubText)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-600 hover:bg-indigo-100">Facebook</a>
                  <a href={`https://t.me/share/url?url=${encodeURIComponent(mapsHubShareLink)}&text=${encodeURIComponent(shareHubText)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-600 hover:bg-sky-100">Telegram</a>
                  <a href={`https://api.whatsapp.com/send?text=${encodeURIComponent(shareHubText)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600 hover:bg-emerald-100">WhatsApp</a>
                  <a href={`mailto:?subject=${encodeURIComponent(centralHub.name)}&body=${encodeURIComponent(shareHubText)}`} className="rounded-lg bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-100">Email</a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
