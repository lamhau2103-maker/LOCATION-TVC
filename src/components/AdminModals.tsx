import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Crosshair,
  KeyRound,
  Layers,
  Lock,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { Farm, IconChoice, PositionDiagnosticItem } from '../types';
import { getFarmKey, resolveFarmIconType } from '../utils/icons';
import { CuteCategoryIcon } from './CursorSpotlight';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitPassword: (
    password: string
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * HỘP THOẠI NHẬP MẬT KHẨU QUẢN TRỊ VIÊN
 * - Kiểm tra mật khẩu ở phía server (/api/icons?action=login với header x-admin-password)
 * - Tự động chuyển thành bottom-sheet toàn chiều ngang trên điện thoại (< 640px)
 */
export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  onSubmitPassword,
}) => {
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setErrorMsg('Vui lòng nhập mật khẩu quản trị');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await onSubmitPassword(password.trim());
      if (res.ok) {
        setPassword('');
        setErrorMsg(null);
        onClose();
      } else {
        setErrorMsg(res.error || 'Sai mật khẩu');
      }
    } catch {
      setErrorMsg('Sai mật khẩu');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f2a24]/45 p-0 backdrop-blur-md sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 24 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[calc(100dvh-24px)] w-full max-w-md overflow-y-auto rounded-t-[24px] border border-white/95 bg-white/95 p-5 text-[#0f2a24] shadow-[0_24px_60px_rgba(15,42,36,0.28)] backdrop-blur-2xl sm:rounded-[24px] sm:p-6"
            style={{
              paddingBottom: 'calc(var(--safe-bottom) + 20px)',
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2b8fd0]/15 text-[#2b8fd0]">
                  <Lock className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-extrabold text-[#0f2a24]">
                    Chế Độ Quản Trị Viên
                  </h3>
                  <p className="text-xs font-medium text-emerald-950/65">
                    Nhập mật khẩu để phân loại icon Gà / Heo cho mọi người
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-950/10 bg-white/80 text-[#0f2a24] hover:border-[#d9261c] hover:text-[#d9261c] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-[#0f2a24]">
                  Mật khẩu quản trị (ADMIN_PASSWORD)
                </label>
                <div className="relative flex items-center">
                  <KeyRound className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#2b8fd0]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    placeholder="Nhập mật khẩu quản trị..."
                    autoFocus
                    className="w-full rounded-2xl border border-emerald-950/15 bg-white py-2.5 pr-4 pl-10 text-sm font-semibold text-[#0f2a24] placeholder-emerald-950/40 focus:border-[#2b8fd0] focus:ring-2 focus:ring-[#2b8fd0]/20 focus:outline-none"
                  />
                </div>
                {errorMsg && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-bold text-[#d9261c]">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[40px] rounded-full border border-emerald-950/15 bg-white px-4 py-2 text-xs font-bold text-[#0f2a24] hover:bg-emerald-950/5 cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-gradient-to-r from-[#2b8fd0] to-[#10b981] px-5 py-2 text-xs font-extrabold text-white shadow-md hover:opacity-95 disabled:opacity-60 cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>{isLoading ? 'Đang kiểm tra...' : 'Xác nhận'}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

interface BulkIconModalProps {
  isOpen: boolean;
  onClose: () => void;
  farms: Farm[];
  isServerConnected: boolean;
  onSelectFarmIcon: (farm: Farm, choice: IconChoice) => Promise<void>;
  onBulkSelectFarmsIcon: (
    targetFarms: Farm[],
    choice: IconChoice
  ) => Promise<void>;
}

/**
 * BẢNG "CHỌN ICON HÀNG LOẠT" DÀNH CHO QUẢN TRỊ VIÊN
 * - Trên điện thoại (< 640px): chuyển thành bottom-sheet toàn chiều ngang, hiển thị từng trang trại dạng thẻ dọc gọn gàng.
 */
export const BulkIconModal: React.FC<BulkIconModalProps> = ({
  isOpen,
  onClose,
  farms,
  isServerConnected,
  onSelectFarmIcon,
  onBulkSelectFarmsIcon,
}) => {
  const [query, setQuery] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  const filteredFarms = useMemo(() => {
    const q = query.trim().toLowerCase().normalize('NFC');
    if (!q) return farms;
    return farms.filter(
      (f) =>
        f.name.toLowerCase().normalize('NFC').includes(q) ||
        f.type.toLowerCase().normalize('NFC').includes(q) ||
        f.description.toLowerCase().normalize('NFC').includes(q)
    );
  }, [farms, query]);

  const handleRowClick = async (farm: Farm, choice: IconChoice) => {
    const key = farm.farmKey || getFarmKey(farm.lat, farm.lng);
    setSavingKey(key);
    try {
      await onSelectFarmIcon(farm, choice);
    } finally {
      setSavingKey(null);
    }
  };

  const handleApplyAllFiltered = async (choice: IconChoice) => {
    if (filteredFarms.length === 0) return;
    setIsBulkSaving(true);
    try {
      await onBulkSelectFarmsIcon(filteredFarms, choice);
    } finally {
      setIsBulkSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f2a24]/45 p-0 backdrop-blur-md sm:items-center sm:p-5"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 24 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[calc(100dvh-24px)] w-full max-w-3xl flex-col overflow-hidden rounded-t-[26px] border border-white/95 bg-white/95 text-[#0f2a24] shadow-[0_28px_70px_rgba(15,42,36,0.3)] backdrop-blur-2xl sm:rounded-[26px]"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-emerald-950/10 px-4 py-3.5 sm:px-6 sm:py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#2b8fd0]/15 text-[#2b8fd0]">
                  <Layers className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display truncate text-sm font-extrabold text-[#0f2a24] sm:text-lg">
                    Chọn Icon Hàng Loạt ({farms.length} trang trại)
                  </h3>
                  <p className="truncate text-[11px] font-medium text-emerald-950/65 sm:text-xs">
                    {isServerConnected
                      ? 'Lưu trực tiếp lên Upstash Redis cho tất cả mọi người'
                      : 'Chưa kết nối máy chủ: lựa chọn chỉ lưu trên máy này'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-950/10 bg-white text-[#0f2a24] hover:border-[#d9261c] hover:text-[#d9261c] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Thanh tìm kiếm & Nút gán nhanh */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-emerald-950/10 bg-emerald-950/[0.02] px-4 py-3 sm:px-6">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#2b8fd0]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm tên trang trại để gán icon nhanh..."
                  className="w-full rounded-full border border-emerald-950/15 bg-white py-2 pr-8 pl-9 text-xs font-semibold text-[#0f2a24] placeholder-emerald-950/45 focus:border-[#2b8fd0] focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-emerald-950/45 hover:text-[#d9261c] cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {filteredFarms.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="mr-1 text-[11px] font-bold text-emerald-950/60">
                    Gán cả {filteredFarms.length} trại:
                  </span>
                  <button
                    type="button"
                    disabled={isBulkSaving}
                    onClick={() => handleApplyAllFiltered('chicken')}
                    className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-[#fb923c]/40 bg-[#fb923c]/12 px-2.5 py-1 text-[11px] font-extrabold text-[#c2410c] hover:bg-[#fb923c]/25 disabled:opacity-50 cursor-pointer"
                  >
                    <CuteCategoryIcon category="chicken" className="h-3.5 w-3.5" />
                    <span>Tất cả Gà</span>
                  </button>
                  <button
                    type="button"
                    disabled={isBulkSaving}
                    onClick={() => handleApplyAllFiltered('pig')}
                    className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-[#fb7185]/40 bg-[#fb7185]/12 px-2.5 py-1 text-[11px] font-extrabold text-[#be123c] hover:bg-[#fb7185]/25 disabled:opacity-50 cursor-pointer"
                  >
                    <CuteCategoryIcon category="pig" className="h-3.5 w-3.5" />
                    <span>Tất cả Heo</span>
                  </button>
                  <button
                    type="button"
                    disabled={isBulkSaving}
                    onClick={() => handleApplyAllFiltered('auto')}
                    className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-emerald-950/15 bg-white px-2.5 py-1 text-[11px] font-bold text-[#0f2a24] hover:bg-emerald-950/5 disabled:opacity-50 cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3 text-[#14b8a6]" />
                    <span>Tự động</span>
                  </button>
                </div>
              )}
            </div>

            {/* Danh sách trang trại (Dạng thẻ dọc trên mobile, dạng hàng ngang trên desktop) */}
            <div className="flex-1 divide-y divide-emerald-950/10 overflow-y-auto px-4 py-2 sm:px-6">
              {filteredFarms.length === 0 ? (
                <div className="py-12 text-center text-xs font-semibold text-emerald-950/55">
                  Không tìm thấy trang trại nào khớp với từ khoá "{query}"
                </div>
              ) : (
                filteredFarms.map((farm) => {
                  const key = farm.farmKey || getFarmKey(farm.lat, farm.lng);
                  const currentChoice: IconChoice = farm.manualIcon || 'auto';
                  const autoDetected = resolveFarmIconType(farm, {});
                  const isRowSaving = savingKey === key || isBulkSaving;
                  const displayIconKey =
                    farm.category === 'other' && farm.subType
                      ? farm.subType
                      : farm.category;

                  return (
                    <div
                      key={farm.id}
                      className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      {/* Cột trái: Icon hiện tại + Tên trang trại + Toạ độ gốc */}
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border-2 bg-white shadow-xs"
                          style={{
                            borderColor:
                              farm.category === 'chicken'
                                ? '#fb923c'
                                : farm.category === 'pig'
                                ? '#fb7185'
                                : '#14b8a6',
                          }}
                        >
                          <CuteCategoryIcon
                            category={displayIconKey}
                            className="h-7 w-7"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-extrabold text-[#0f2a24] sm:text-sm">
                            {farm.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-emerald-950/60">
                            <span>{farm.type}</span>
                            <span>·</span>
                            <span className="font-mono-tabular">
                              {farm.lat.toFixed(5)}, {farm.lng.toFixed(5)}
                            </span>
                            {currentChoice === 'auto' && (
                              <span className="rounded-full bg-emerald-950/5 px-2 py-0.5 text-[10px] font-bold text-[#0f766e]">
                                Tự động:{' '}
                                {autoDetected === 'chicken'
                                  ? 'Gà'
                                  : autoDetected === 'pig'
                                  ? 'Heo'
                                  : 'Khác'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Cột phải: 3 nút chọn nhanh Gà / Heo / Tự động */}
                      <div className="grid shrink-0 grid-cols-3 gap-1.5 sm:flex sm:items-center">
                        <button
                          type="button"
                          disabled={isRowSaving}
                          onClick={() => handleRowClick(farm, 'chicken')}
                          className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
                            currentChoice === 'chicken'
                              ? 'border-[#fb923c] bg-[#fb923c] text-white shadow-sm'
                              : 'border-emerald-950/12 bg-white text-[#0f2a24] hover:border-[#fb923c]'
                          }`}
                        >
                          <CuteCategoryIcon
                            category="chicken"
                            className="h-4 w-4"
                          />
                          <span>Gà</span>
                        </button>

                        <button
                          type="button"
                          disabled={isRowSaving}
                          onClick={() => handleRowClick(farm, 'pig')}
                          className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
                            currentChoice === 'pig'
                              ? 'border-[#fb7185] bg-[#fb7185] text-white shadow-sm'
                              : 'border-emerald-950/12 bg-white text-[#0f2a24] hover:border-[#fb7185]'
                          }`}
                        >
                          <CuteCategoryIcon
                            category="pig"
                            className="h-4 w-4"
                          />
                          <span>Heo</span>
                        </button>

                        <button
                          type="button"
                          disabled={isRowSaving}
                          onClick={() => handleRowClick(farm, 'auto')}
                          className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                            currentChoice === 'auto'
                              ? 'border-[#14b8a6] bg-[#14b8a6] text-white shadow-sm'
                              : 'border-emerald-950/12 bg-white text-[#0f2a24] hover:border-[#14b8a6]'
                          }`}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Tự động</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between border-t border-emerald-950/10 bg-emerald-950/[0.02] px-4 py-3 sm:px-6"
              style={{
                paddingBottom: 'calc(var(--safe-bottom) + 12px)',
              }}
            >
              <span className="text-[11px] font-semibold text-emerald-950/65">
                Mẹo: Chọn "Tự động" để tự nhận diện theo từ khoá (ưu tiên từ khoá loại trừ).
              </span>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[38px] shrink-0 rounded-full bg-[#0f2a24] px-5 py-1.5 text-xs font-extrabold text-white hover:bg-[#0f2a24]/90 cursor-pointer"
              >
                Đóng bảng
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

interface PositionDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  getDiagnostics: () => PositionDiagnosticItem[];
  onFlyToPoint?: (lat: number, lng: number, id: string) => void;
}

/**
 * BẢNG "KIỂM TRA VỊ TRÍ" DÀNH RIÊNG CHO QUẢN TRỊ VIÊN (PHẦN A - MỤC 5)
 * - Liệt kê từng điểm (Nhà máy trung tâm + toàn bộ Trang trại):
 *   + Tên điểm
 *   + Toạ độ dữ liệu gốc (lat, lng 6 chữ số thập phân)
 *   + Toạ độ đối tượng 3D đang render trên địa cầu/bản đồ (lat, lng 6 chữ số thập phân)
 *   + Đánh dấu ✓ nếu trùng khớp (sai số < 1m), ⚠ nếu lệch >= 1m
 */
export const PositionDiagnosticsModal: React.FC<
  PositionDiagnosticsModalProps
> = ({ isOpen, onClose, getDiagnostics, onFlyToPoint }) => {
  const [items, setItems] = useState<PositionDiagnosticItem[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      setItems(getDiagnostics());
    }
  }, [isOpen, getDiagnostics]);

  const handleRefresh = () => {
    setItems(getDiagnostics());
  };

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase().normalize('NFC');
    if (!q) return items;
    return items.filter((item) =>
      item.name.toLowerCase().normalize('NFC').includes(q)
    );
  }, [items, query]);

  const matchCount = items.filter((i) => i.isAccurate).length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f2a24]/45 p-0 backdrop-blur-md sm:items-center sm:p-5"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 24 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[calc(100dvh-24px)] w-full max-w-4xl flex-col overflow-hidden rounded-t-[26px] border border-white/95 bg-white/95 text-[#0f2a24] shadow-[0_28px_70px_rgba(15,42,36,0.3)] backdrop-blur-2xl sm:rounded-[26px]"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-emerald-950/10 px-4 py-3.5 sm:px-6 sm:py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#10b981]/15 text-[#059669]">
                  <Crosshair className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display truncate text-sm font-extrabold text-[#0f2a24] sm:text-lg">
                    Kiểm Tra Vị Trí Tọa Độ 3D ({matchCount}/{items.length} điểm khớp 100%)
                  </h3>
                  <p className="truncate text-[11px] font-medium text-emerald-950/65 sm:text-xs">
                    Đối chiếu tọa độ dữ liệu gốc và tọa độ đối tượng 3D thực tế trên mặt cầu (sai số &lt; 1m đạt chuẩn ✓)
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleRefresh}
                  title="Kiểm tra lại"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-950/10 bg-white text-[#2b8fd0] hover:border-[#2b8fd0] cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-950/10 bg-white text-[#0f2a24] hover:border-[#d9261c] hover:text-[#d9261c] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Thanh tìm kiếm */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-950/10 bg-emerald-950/[0.02] px-4 py-2.5 sm:px-6">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#2b8fd0]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm tên điểm cần kiểm tra tọa độ..."
                  className="w-full rounded-full border border-emerald-950/15 bg-white py-1.5 pr-8 pl-9 text-xs font-semibold text-[#0f2a24] placeholder-emerald-950/45 focus:border-[#2b8fd0] focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-emerald-950/45"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs font-bold">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[#059669]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>✓ Khớp &lt; 1m: {matchCount}</span>
                </span>
                {items.length - matchCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>⚠ Lệch: {items.length - matchCount}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Danh sách kiểm tra (Thẻ dọc trên điện thoại, bảng rõ ràng trên màn hình lớn) */}
            <div className="flex-1 divide-y divide-emerald-950/10 overflow-y-auto px-4 py-2 sm:px-6">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-950/10 bg-white">
                      <CuteCategoryIcon
                        category={item.category}
                        className="h-6 w-6"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-extrabold text-[#0f2a24] sm:text-sm">
                          {item.name}
                        </span>
                        {onFlyToPoint && (
                          <button
                            type="button"
                            onClick={() => {
                              onFlyToPoint(item.rawLat, item.rawLng, item.id);
                              onClose();
                            }}
                            className="shrink-0 rounded-full bg-[#2b8fd0]/10 px-2 py-0.5 text-[10px] font-extrabold text-[#2b8fd0] hover:bg-[#2b8fd0]/20 cursor-pointer"
                          >
                            Bay tới
                          </button>
                        )}
                      </div>
                      <div className="mt-1 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2 sm:gap-4">
                        <div className="font-mono-tabular text-emerald-950/75">
                          <span className="font-sans font-semibold text-emerald-950/55">
                            Gốc:{' '}
                          </span>
                          <span className="font-bold text-[#0f2a24]">
                            {item.rawLat.toFixed(6)}, {item.rawLng.toFixed(6)}
                          </span>
                        </div>
                        <div className="font-mono-tabular text-emerald-950/75">
                          <span className="font-sans font-semibold text-emerald-950/55">
                            3D Render:{' '}
                          </span>
                          <span className="font-bold text-[#2b8fd0]">
                            {item.renderedLat.toFixed(6)},{' '}
                            {item.renderedLng.toFixed(6)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                    <span className="font-mono-tabular text-xs font-bold text-emerald-950/65">
                      Sai số:{' '}
                      {item.deviationMeters < 0.01
                        ? '0.00 m'
                        : `${item.deviationMeters.toFixed(2)} m`}
                    </span>

                    {item.isAccurate ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-[#059669]">
                        <span>✓</span>
                        <span>Chính xác</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-800">
                        <span>⚠</span>
                        <span>Lệch</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between border-t border-emerald-950/10 bg-emerald-950/[0.02] px-4 py-3 sm:px-6"
              style={{
                paddingBottom: 'calc(var(--safe-bottom) + 12px)',
              }}
            >
              <span className="text-[11px] font-semibold text-emerald-950/65">
                Toạ độ hiển thị giữ nguyên 100% độ chính xác gốc, không làm tròn và không dịch chuyển (jitter = 0).
              </span>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[38px] shrink-0 rounded-full bg-[#0f2a24] px-5 py-1.5 text-xs font-extrabold text-white hover:bg-[#0f2a24]/90 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
