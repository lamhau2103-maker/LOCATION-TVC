import React, { useState } from 'react';
import { motion, PanInfo } from 'framer-motion';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Lock,
  MapPin,
  Navigation,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { APP_CONFIG, getCategoryConfig } from '../config';
import { CentralHub, Farm, IconChoice } from '../types';
import { calculateDistanceKm } from '../utils/geo';
import { resolveFarmIconType } from '../utils/icons';
import { CountUp } from './CountUp';
import { CuteCategoryIcon, PanelParticles } from './CursorSpotlight';

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
}

/**
 * CARD THÔNG TIN TRANG TRẠI (KÍNH TRẮNG MỜ TƯƠI SÁNG + DẤU THƯƠNG HIỆU THÁI VIỆT CORPORATION)
 * - Hiển thị Icon lớn (Gà / Heo / Nhà trại) ở đầu card cạnh tên trang trại.
 * - Khi đang ở Chế độ Quản trị (isAdmin = true), hiển thị khối "Chọn icon" với 3 nút lớn trực quan:
 *   Gà / Heo / Tự động. Người xem thường chỉ xem, không thấy mục này.
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
}) => {
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });
  const [copied, setCopied] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [isSavingIcon, setIsSavingIcon] = useState(false);

  const categoryCfg = getCategoryConfig(farm.category);
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
    if (window.innerWidth < 768) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -6;
    const rotateY = ((x - centerX) / centerX) * 6;
    setTilt({ rotateX, rotateY });
  };

  const handleMouseLeave = () => {
    setTilt({ rotateX: 0, rotateY: 0 });
  };

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (info.offset.y > 95 || info.velocity.y > 450) {
      onClose();
    }
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

  return (
    <motion.div
      key={farm.id}
      initial={{ opacity: 0, y: 40, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 40, scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      drag={
        typeof window !== 'undefined' && window.innerWidth < 768 ? 'y' : false
      }
      dragConstraints={{ top: 0, bottom: 260 }}
      dragElastic={0.2}
      onDragEnd={handleDragEnd}
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-lg px-3 pb-3 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[425px] sm:px-0 sm:pb-0"
      style={{ perspective: 1100 }}
    >
      <div
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/85 text-[#0f2a24] backdrop-blur-2xl transition-transform duration-150 ease-out"
        style={{
          boxShadow:
            '0 24px 60px -12px rgba(15, 42, 36, 0.22), 0 10px 24px -6px rgba(43, 143, 208, 0.14), inset 0 1px 0 0 rgba(255, 255, 255, 0.95)',
          transform: `rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
          transformStyle: 'preserve-3d',
        }}
      >
        <PanelParticles
          count={8}
          color={categoryCfg.hex}
          disabled={liteMode}
        />

        {/* Thanh màu điểm nhấn đỉnh Card */}
        <div
          className="h-1.5 w-full"
          style={{
            background: `linear-gradient(90deg, #2b8fd0, ${categoryCfg.hex}, #d9261c)`,
          }}
        />

        {/* Thanh nắm kéo Bottom-sheet trên Mobile */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <div className="h-1.5 w-11 rounded-full bg-emerald-950/20" />
        </div>

        {/* Hiển thị ảnh trang trại phía trên nếu dữ liệu có */}
        {farm.imageUrl && !imageError && (
          <div className="relative h-40 w-full overflow-hidden border-b border-emerald-950/10 bg-emerald-50">
            <img
              src={farm.imageUrl}
              alt={farm.name}
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
          </div>
        )}

        <div className="relative z-10 p-5 sm:p-6">
          {/* Dòng Phân loại & Trạng thái + Nút điều hướng/đóng */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span
                className="flex items-center gap-1.5"
                style={{ color: categoryCfg.hex }}
              >
                <CuteCategoryIcon
                  category={farm.category}
                  className="h-4 w-4"
                />
                {categoryCfg.label}
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
                <motion.button
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={onPrevFarm}
                  title="Trang trại trước"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-950/10 bg-white/85 text-[#0f2a24] shadow-xs transition-colors hover:border-[#2b8fd0] hover:text-[#2b8fd0] cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </motion.button>
              )}
              {onNextFarm && (
                <motion.button
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={onNextFarm}
                  title="Trang trại tiếp theo"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-950/10 bg-white/85 text-[#0f2a24] shadow-xs transition-colors hover:border-[#2b8fd0] hover:text-[#2b8fd0] cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </motion.button>
              )}
              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.94 }}
                onClick={onClose}
                title="Đóng thẻ thông tin"
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-full border border-emerald-950/10 bg-white/85 text-[#0f2a24] shadow-xs transition-colors hover:border-[#d9261c] hover:bg-rose-50 hover:text-[#d9261c] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </motion.button>
            </div>
          </div>

          {/* Icon lớn ở đầu Card cạnh Tên Trang Trại */}
          <div className="mb-3 flex items-center gap-3.5">
            <motion.div
              key={farm.category}
              initial={{ scale: 0.75, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 340, damping: 18 }}
              className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl border-2 bg-white shadow-md"
              style={{
                borderColor: categoryCfg.hex,
                boxShadow: `0 8px 20px -4px ${categoryCfg.glow}`,
              }}
            >
              <CuteCategoryIcon category={farm.category} className="h-9 w-9" />
            </motion.div>

            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-extrabold leading-snug tracking-tight text-[#0f2a24] sm:text-xl">
                {farm.name}
              </h2>
              {farm.type && (
                <div className="mt-0.5 text-xs font-semibold text-emerald-950/60">
                  Nhóm dữ liệu gốc: {farm.type}
                </div>
              )}
            </div>
          </div>

          {/* Khối "Chọn icon" dành riêng cho QUẢN TRỊ VIÊN (Người xem thường không thấy) */}
          {isAdmin && onSelectFarmIcon && (
            <div className="mb-4 rounded-2xl border border-[#2b8fd0]/30 bg-gradient-to-br from-[#2b8fd0]/[0.08] to-[#10b981]/[0.06] p-3">
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
                {/* Nút Gà */}
                <motion.button
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.96 }}
                  disabled={isSavingIcon}
                  onClick={() => handleChooseIcon('chicken')}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-xs font-extrabold transition-all cursor-pointer ${
                    currentManualChoice === 'chicken'
                      ? 'border-[#fb923c] bg-[#fb923c] text-white shadow-[0_6px_16px_rgba(251,146,60,0.4)]'
                      : 'border-white/90 bg-white/90 text-[#0f2a24] hover:border-[#fb923c]'
                  }`}
                >
                  <CuteCategoryIcon category="chicken" className="h-6 w-6" />
                  <span>Gà</span>
                </motion.button>

                {/* Nút Heo */}
                <motion.button
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.96 }}
                  disabled={isSavingIcon}
                  onClick={() => handleChooseIcon('pig')}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-xs font-extrabold transition-all cursor-pointer ${
                    currentManualChoice === 'pig'
                      ? 'border-[#fb7185] bg-[#fb7185] text-white shadow-[0_6px_16px_rgba(251,113,133,0.4)]'
                      : 'border-white/90 bg-white/90 text-[#0f2a24] hover:border-[#fb7185]'
                  }`}
                >
                  <CuteCategoryIcon category="pig" className="h-6 w-6" />
                  <span>Heo</span>
                </motion.button>

                {/* Nút Tự động */}
                <motion.button
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.96 }}
                  disabled={isSavingIcon}
                  onClick={() => handleChooseIcon('auto')}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-xs font-extrabold transition-all cursor-pointer ${
                    currentManualChoice === 'auto'
                      ? 'border-[#14b8a6] bg-[#14b8a6] text-white shadow-[0_6px_16px_rgba(20,184,166,0.38)]'
                      : 'border-white/90 bg-white/90 text-[#0f2a24] hover:border-[#14b8a6]'
                  }`}
                >
                  <div className="flex h-6 w-6 items-center justify-center">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <span>
                    Tự động (
                    {autoCategory === 'chicken'
                      ? 'Gà'
                      : autoCategory === 'pig'
                      ? 'Heo'
                      : 'Khác'}
                    )
                  </span>
                </motion.button>
              </div>
            </div>
          )}

          {/* Mô tả chi tiết */}
          <p className="mb-4 max-h-24 overflow-y-auto whitespace-pre-line text-xs font-medium leading-relaxed text-[#0f2a24]/80 sm:text-sm">
            {farm.description}
          </p>

          {/* Lưới thông số chính (Số đếm tăng dần CountUp) */}
          <div className="mb-4 grid grid-cols-2 gap-3 border-y border-emerald-950/10 py-3.5">
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-950/65">
                <CuteCategoryIcon
                  category="hub"
                  className="h-3.5 w-3.5 text-[#2b8fd0]"
                />
                <span>Cách nhà máy trung tâm</span>
              </div>
              <div className="text-lg font-extrabold text-[#2b8fd0] sm:text-xl">
                <CountUp end={distanceKm} decimals={2} suffix=" km" />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-950/65">
                <ShieldCheck className="h-3.5 w-3.5 text-[#10b981]" />
                <span>Bán kính ATSH</span>
              </div>
              <div className="text-lg font-extrabold text-[#059669] sm:text-xl">
                <CountUp end={biosecurityRadius} decimals={0} suffix=" m" />
              </div>
            </div>
          </div>

          {/* Toạ độ GPS + Nút Copy */}
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-emerald-950/10 bg-emerald-950/[0.04] px-3.5 py-2.5 text-xs">
            <div className="flex items-center gap-2 text-[#0f2a24]">
              <MapPin className="h-3.5 w-3.5 text-[#2b8fd0] shrink-0" />
              <span className="font-medium text-emerald-950/65">Toạ độ:</span>
              <span className="font-mono-tabular font-bold text-[#0f2a24]">
                {farm.lat.toFixed(5)}°N, {farm.lng.toFixed(5)}°E
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopyCoords}
              className="flex items-center gap-1 text-[11px] font-bold text-[#2b8fd0] transition-colors hover:text-[#d9261c] cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#10b981]" />
                  <span>Đã chép</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Chép</span>
                </>
              )}
            </button>
          </div>

          {/* Thông tin phụ từ <ExtendedData> (KML) hoặc các cột phụ (CSV) */}
          {extendedEntries.length > 0 && (
            <div className="mb-4 max-h-36 overflow-y-auto pr-1">
              <div className="mb-2 text-[11px] font-extrabold tracking-wider text-emerald-950/60 uppercase">
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
                      className="font-bold text-[#0f2a24] truncate"
                      title={val}
                    >
                      {val}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Nút Chỉ đường bo tròn hover nhấc lên */}
          <motion.a
            href={googleMapsDirectionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ y: -2, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#2b8fd0] to-[#10b981] px-5 py-3 text-xs font-extrabold tracking-wider text-white shadow-[0_10px_25px_rgba(43,143,208,0.35)] transition-shadow hover:shadow-[0_14px_30px_rgba(43,143,208,0.5)] sm:text-sm"
          >
            <Navigation className="h-4 w-4 fill-current" />
            CHỈ ĐƯỜNG GOOGLE MAPS
          </motion.a>

          {/* Dấu thương hiệu nhỏ mờ nhẹ ở chân Card */}
          <div className="mt-4 flex items-center justify-center gap-2 border-t border-emerald-950/10 pt-2.5 opacity-65">
            {!logoError && (
              <img
                src={logoUrl}
                alt={APP_CONFIG.companyName}
                onError={() => setLogoError(true)}
                className="h-5 w-auto object-contain select-none"
              />
            )}
            <span className="text-[10px] font-bold tracking-wide text-[#0f2a24]">
              {APP_CONFIG.companyName}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
