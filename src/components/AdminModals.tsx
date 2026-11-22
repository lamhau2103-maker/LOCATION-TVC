import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  KeyRound,
  Layers,
  Lock,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { Farm, IconChoice } from '../types';
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
 * - Tuyệt đối không chứa mật khẩu cứng ở phía trình duyệt
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2a24]/45 p-4 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md overflow-hidden rounded-[24px] border border-white/95 bg-white/92 p-6 text-[#0f2a24] shadow-[0_24px_60px_rgba(15,42,36,0.28)] backdrop-blur-2xl"
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
                className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-950/10 bg-white/80 text-[#0f2a24] hover:border-[#d9261c] hover:text-[#d9261c] cursor-pointer"
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
                  className="rounded-full border border-emerald-950/15 bg-white px-4 py-2 text-xs font-bold text-[#0f2a24] hover:bg-emerald-950/5 cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#2b8fd0] to-[#10b981] px-5 py-2 text-xs font-extrabold text-white shadow-md hover:opacity-95 disabled:opacity-60 cursor-pointer"
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
 * - Liệt kê tất cả trang trại (tên + icon hiện tại)
 * - Có ô tìm kiếm nhanh theo tên/loại/mô tả
 * - Cho phép chọn nhanh Gà / Heo / Tự động ngay trên từng dòng hoặc áp dụng hàng loạt cho kết quả đang lọc
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2a24]/45 p-3 sm:p-5 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[26px] border border-white/95 bg-white/94 text-[#0f2a24] shadow-[0_28px_70px_rgba(15,42,36,0.3)] backdrop-blur-2xl"
          >
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-950/10 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2b8fd0]/15 text-[#2b8fd0]">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-extrabold text-[#0f2a24] sm:text-lg">
                    Chọn Icon Hàng Loạt ({farms.length} trang trại)
                  </h3>
                  <p className="text-xs font-medium text-emerald-950/65">
                    {isServerConnected
                      ? 'Mọi thay đổi được lưu trực tiếp lên Upstash Redis cho tất cả mọi người'
                      : 'Chưa kết nối máy chủ: lựa chọn chỉ lưu trên máy này'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-950/10 bg-white text-[#0f2a24] hover:border-[#d9261c] hover:text-[#d9261c] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Thanh tìm kiếm & Nút gán nhanh cho danh sách đang lọc */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-emerald-950/10 bg-emerald-950/[0.02] px-5 py-3 sm:px-6">
              <div className="relative flex-1 min-w-[210px]">
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
                  <span className="text-[11px] font-bold text-emerald-950/60 mr-1">
                    Gán cả {filteredFarms.length} trại đang hiện:
                  </span>
                  <button
                    type="button"
                    disabled={isBulkSaving}
                    onClick={() => handleApplyAllFiltered('chicken')}
                    className="inline-flex items-center gap-1 rounded-full border border-[#fb923c]/40 bg-[#fb923c]/12 px-2.5 py-1 text-[11px] font-extrabold text-[#c2410c] hover:bg-[#fb923c]/25 disabled:opacity-50 cursor-pointer"
                  >
                    <CuteCategoryIcon category="chicken" className="h-3.5 w-3.5" />
                    <span>Tất cả Gà</span>
                  </button>
                  <button
                    type="button"
                    disabled={isBulkSaving}
                    onClick={() => handleApplyAllFiltered('pig')}
                    className="inline-flex items-center gap-1 rounded-full border border-[#fb7185]/40 bg-[#fb7185]/12 px-2.5 py-1 text-[11px] font-extrabold text-[#be123c] hover:bg-[#fb7185]/25 disabled:opacity-50 cursor-pointer"
                  >
                    <CuteCategoryIcon category="pig" className="h-3.5 w-3.5" />
                    <span>Tất cả Heo</span>
                  </button>
                  <button
                    type="button"
                    disabled={isBulkSaving}
                    onClick={() => handleApplyAllFiltered('auto')}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-950/15 bg-white px-2.5 py-1 text-[11px] font-bold text-[#0f2a24] hover:bg-emerald-950/5 disabled:opacity-50 cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3 text-[#14b8a6]" />
                    <span>Tất cả Tự động</span>
                  </button>
                </div>
              )}
            </div>

            {/* Danh sách trang trại */}
            <div className="flex-1 overflow-y-auto divide-y divide-emerald-950/10 px-5 py-2 sm:px-6">
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

                  return (
                    <div
                      key={farm.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      {/* Cột trái: Icon hiện tại + Tên trang trại + Toạ độ key */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
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
                            category={farm.category}
                            className="h-7 w-7"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-extrabold text-[#0f2a24] sm:text-sm">
                            {farm.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-emerald-950/60">
                            <span>{farm.type}</span>
                            <span>·</span>
                            <span className="font-mono-tabular">{key}</span>
                            {currentChoice === 'auto' && (
                              <span className="rounded-full bg-emerald-950/5 px-2 py-0.5 text-[10px] font-bold text-[#0f766e]">
                                Tự động:{' '}
                                {autoDetected === 'chicken'
                                  ? 'Gà'
                                  : autoDetected === 'pig'
                                  ? 'Heo'
                                  : 'Nhà trại'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Cột phải: 3 nút chọn nhanh Gà / Heo / Tự động */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={isRowSaving}
                          onClick={() => handleRowClick(farm, 'chicken')}
                          className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
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
                          className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-extrabold transition-all cursor-pointer ${
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
                          className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
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
            <div className="flex items-center justify-between border-t border-emerald-950/10 bg-emerald-950/[0.02] px-5 py-3 sm:px-6">
              <span className="text-[11px] font-semibold text-emerald-950/65">
                Mẹo: Chọn "Tự động" để xoá ghi đè thủ công và tự nhận diện theo từ khoá.
              </span>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-[#0f2a24] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#0f2a24]/90 cursor-pointer"
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
