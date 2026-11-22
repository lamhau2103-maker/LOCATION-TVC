import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileCode2,
  FileSpreadsheet,
  ImagePlus,
  Link2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { APP_CONFIG } from '../config';
import { CentralHub, ParseResult } from '../types';
import {
  generateSampleKML,
  parseFarmFile,
  parseKMLContent,
} from '../utils/parsers';

interface DataImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (result: ParseResult) => void;
  onResetDefault: () => void;
  hasCustomData: boolean;
  currentFarmCount: number;
  centralHub: CentralHub;
  onUpdateCentralHub: (hub: CentralHub) => void;
  savedMyMapsLink: string;
  onSyncFromLink: (
    rawInput: string
  ) => Promise<{ ok: boolean; message: string; details?: string[] }>;
  onClearSavedLink: () => void;
  logoUrl: string;
  onUpdateCustomLogo: (base64Logo: string | null) => void;
}

/**
 * MODAL NẠP DỮ LIỆU & ĐỒNG BỘ TỪ LINK GOOGLE MY MAPS
 * - Vùng kéo-thả tệp .KML / .CSV / .GeoJSON
 * - Khối "ĐỒNG BỘ TỪ LINK GOOGLE MY MAPS" ngay dưới vùng kéo-thả
 * - Nút "Tải logo" dự phòng (lưu base64 vào localStorage)
 * - Dấu thương hiệu nhỏ mờ nhẹ ở chân panel
 */
export const DataImportModal: React.FC<DataImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
  onResetDefault,
  hasCustomData,
  currentFarmCount,
  centralHub,
  onUpdateCentralHub,
  savedMyMapsLink,
  onSyncFromLink,
  onClearSavedLink,
  logoUrl,
  onUpdateCustomLogo,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // State khối Đồng bộ từ link Google My Maps
  const [linkInput, setLinkInput] = useState(savedMyMapsLink);
  const [isSyncingLink, setIsSyncingLink] = useState(false);

  // State chỉnh sửa nhanh Nhà máy Trung tâm
  const [hubName, setHubName] = useState(centralHub.name);
  const [hubLat, setHubLat] = useState(String(centralHub.lat));
  const [hubLng, setHubLng] = useState(String(centralHub.lng));
  const [hubSavedMsg, setHubSavedMsg] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setLinkInput(savedMyMapsLink);
  }, [savedMyMapsLink, isOpen]);

  useEffect(() => {
    setHubName(centralHub.name);
    setHubLat(String(centralHub.lat));
    setHubLng(String(centralHub.lng));
  }, [centralHub]);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    setErrorMsg(null);
    setErrorDetails([]);
    setIsProcessing(true);
    try {
      const result = await parseFarmFile(file);
      onImportSuccess(result);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể đọc file dữ liệu. Vui lòng kiểm tra định dạng .kml, .csv hoặc .geojson.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  // Xử lý bấm nút "Đồng bộ" trong khối ĐỒNG BỘ TỪ LINK GOOGLE MY MAPS
  const handleSyncLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setErrorDetails([]);
    setIsSyncingLink(true);
    try {
      const res = await onSyncFromLink(linkInput);
      if (res.ok) {
        onClose();
      } else {
        setErrorMsg(res.message);
        setErrorDetails(res.details || []);
      }
    } finally {
      setIsSyncingLink(false);
    }
  };

  const handleLoadSampleKML = () => {
    setErrorMsg(null);
    try {
      const sampleXml = generateSampleKML();
      const result = parseKMLContent(
        sampleXml,
        'ThaiViet_My_Maps_8_Trang_Trai.kml'
      );
      onImportSuccess(result);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Lỗi nạp dữ liệu mẫu KML.'
      );
    }
  };

  const handleDownloadSampleKML = () => {
    const sampleXml = generateSampleKML();
    const blob = new Blob([sampleXml], {
      type: 'application/vnd.google-earth.kml+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'thaiviet_google_my_maps_sample.kml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Xử lý tải logo tuỳ chỉnh (chuyển thành Base64 lưu localStorage)
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpdateCustomLogo(reader.result);
        setLogoError(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveHub = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(hubLat);
    const lng = parseFloat(hubLng);
    if (
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      setErrorMsg('Toạ độ Nhà máy Trung tâm không hợp lệ.');
      return;
    }
    onUpdateCentralHub({
      ...centralHub,
      name: hubName.trim() || centralHub.name,
      lat,
      lng,
    });
    setHubSavedMsg(true);
    setTimeout(() => setHubSavedMsg(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2a24]/35 p-4 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 12 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[28px] border border-white/95 bg-white/90 p-6 text-[#0f2a24] shadow-[0_28px_70px_rgba(15,42,36,0.25)] backdrop-blur-2xl sm:p-7"
      >
        {/* Header Modal */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-extrabold tracking-tight text-[#0f2a24] sm:text-xl">
              NẠP DỮ LIỆU GOOGLE MY MAPS (DỰ PHÒNG)
            </h2>
            <p className="mt-1 text-xs font-medium text-[#0f2a24]/75 sm:text-sm">
              Kéo-thả trực tiếp tệp{' '}
              <span className="font-bold text-[#2b8fd0]">.KML</span>,{' '}
              <span className="font-bold text-[#10b981]">.CSV</span>,{' '}
              <span className="font-bold text-[#ea580c]">.GeoJSON</span> hoặc
              dán trực tiếp đường dẫn Google My Maps của bạn.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-950/10 bg-white text-[#0f2a24] transition-colors hover:border-[#d9261c] hover:bg-rose-50 hover:text-[#d9261c] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Vùng Kéo - Thả File */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`group relative mb-4 flex cursor-pointer flex-col items-center justify-center rounded-[22px] border-2 border-dashed p-5 text-center transition-all ${
            isDragging
              ? 'border-[#2b8fd0] bg-sky-50/80 shadow-md'
              : 'border-emerald-950/20 bg-white/65 hover:border-[#2b8fd0] hover:bg-sky-50/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".kml,.csv,.geojson,.json,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          <div className="mb-2.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b8fd0]/15 text-[#2b8fd0] ring-1 ring-[#2b8fd0]/30 transition-transform group-hover:scale-110">
            <Upload className="h-6 w-6" />
          </div>

          <p className="mb-1 text-sm font-extrabold text-[#0f2a24]">
            {isProcessing
              ? 'Đang phân tích cấu trúc toạ độ...'
              : 'Kéo & thả file vào đây hoặc bấm để chọn file'}
          </p>
          <p className="text-xs font-medium text-[#0f2a24]/70">
            Tự động đọc thẻ &lt;Placemark&gt;, tên &lt;Folder&gt; làm loại trang
            trại, &lt;ExtendedData&gt; và dựng cụm chuồng 3D
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[11px] font-bold">
            <span className="flex items-center gap-1 text-[#2b8fd0]">
              <FileCode2 className="h-3.5 w-3.5" />
              Google My Maps (.kml)
            </span>
            <span aria-hidden="true" className="text-emerald-950/30">
              ·
            </span>
            <span className="flex items-center gap-1 text-[#d9261c]">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Bảng tính (.csv)
            </span>
            <span aria-hidden="true" className="text-emerald-950/30">
              ·
            </span>
            <span className="flex items-center gap-1 text-[#ea580c]">
              <FileCode2 className="h-3.5 w-3.5" />
              Bản đồ (.geojson)
            </span>
          </div>
        </div>

        {/* KHỐI MỚI: ĐỒNG BỘ TỪ LINK GOOGLE MY MAPS NGAY DƯỚI VÙNG KÉO-THẢ */}
        <form
          onSubmit={handleSyncLinkSubmit}
          className="mb-4 rounded-[22px] border border-[#2b8fd0]/30 bg-gradient-to-br from-sky-50/90 to-emerald-50/60 p-4 shadow-xs"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-[#2b8fd0] uppercase">
              <Link2 className="h-4 w-4" />
              <span>ĐỒNG BỘ TỪ LINK GOOGLE MY MAPS</span>
            </div>
            {savedMyMapsLink && (
              <button
                type="button"
                onClick={() => {
                  onClearSavedLink();
                  setLinkInput('');
                }}
                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-[#d9261c] transition-colors hover:bg-rose-50 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
                <span>Xoá link</span>
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="Dán link Google My Maps vào đây..."
              className="flex-1 rounded-xl border border-[#2b8fd0]/30 bg-white px-3.5 py-2 text-xs font-medium text-[#0f2a24] placeholder-emerald-950/40 focus:border-[#2b8fd0] focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSyncingLink}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#2b8fd0] px-4 py-2 text-xs font-extrabold text-white shadow-sm transition-colors hover:bg-[#1e74ad] disabled:opacity-60 cursor-pointer shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isSyncingLink ? 'animate-spin' : ''}`}
              />
              <span>{isSyncingLink ? 'Đang tải...' : 'Đồng bộ'}</span>
            </button>
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-[#0f2a24]/65">
            Tự động tách <code className="font-mono font-bold">mid=...</code>,
            lưu vào trình duyệt và tự động đồng bộ lại mỗi 5 phút.
          </p>
        </form>

        {/* Thông báo lỗi nếu có */}
        {errorMsg && (
          <div className="mb-4 rounded-2xl border border-[#d9261c]/30 bg-rose-50 p-3.5 text-xs font-semibold text-[#d9261c]">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-[#d9261c] shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
            {errorDetails.length > 0 && (
              <div className="mt-2 space-y-0.5 border-t border-[#d9261c]/15 pt-2 pl-6 font-mono text-[11px] font-medium text-[#d9261c]/85">
                {errorDetails.map((detail, idx) => (
                  <div key={idx}>{detail}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Cụm nút dùng thử KML mẫu, Tải logo & Xoá dữ liệu localStorage */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-950/10 bg-emerald-950/[0.03] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleLoadSampleKML}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#10b981] px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#059669] cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Nạp thử KML mẫu (8 trại)
            </button>

            <button
              type="button"
              onClick={handleDownloadSampleKML}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-950/15 bg-white px-3 py-1.5 text-xs font-bold text-[#0f2a24] transition-colors hover:border-[#2b8fd0] cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#2b8fd0]" />
              Tải file .KML mẫu
            </button>

            {/* Nút "Tải logo" dự phòng (chuyển ảnh sang Base64 lưu localStorage) */}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoUpload}
            />
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-950/15 bg-white px-3 py-1.5 text-xs font-bold text-[#0f2a24] transition-colors hover:border-[#2b8fd0] cursor-pointer"
            >
              <ImagePlus className="h-3.5 w-3.5 text-[#2b8fd0]" />
              Tải logo
            </button>
          </div>

          {hasCustomData ? (
            <button
              type="button"
              onClick={() => {
                onResetDefault();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-[#d9261c] transition-colors hover:bg-rose-100 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Xoá dữ liệu ({currentFarmCount})
            </button>
          ) : (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[#0f2a24]/60">
              <RotateCcw className="h-3 w-3" />
              Đang dùng 5 trại mặc định
            </span>
          )}
        </div>

        {/* Cấu hình nhanh Nhà Máy Trung Tâm */}
        <form
          onSubmit={handleSaveHub}
          className="rounded-2xl border border-[#2b8fd0]/20 bg-sky-50/50 p-3.5"
        >
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-extrabold tracking-wider text-[#2b8fd0] uppercase">
              Toạ độ Nhà máy Trung tâm (Điểm gốc đường cung ArcLayer)
            </span>
            {hubSavedMsg && (
              <span className="flex items-center gap-1 text-xs font-bold text-[#059669]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Đã cập nhật
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-[11px] font-bold text-[#0f2a24]/70">
                Tên nhà máy
              </label>
              <input
                type="text"
                value={hubName}
                onChange={(e) => setHubName(e.target.value)}
                className="w-full rounded-xl border border-emerald-950/15 bg-white px-3 py-1.5 text-xs font-semibold text-[#0f2a24] focus:border-[#2b8fd0] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#0f2a24]/70">
                Vĩ độ (Lat)
              </label>
              <input
                type="text"
                value={hubLat}
                onChange={(e) => setHubLat(e.target.value)}
                className="font-mono-tabular w-full rounded-xl border border-emerald-950/15 bg-white px-3 py-1.5 text-xs font-semibold text-[#0f2a24] focus:border-[#2b8fd0] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#0f2a24]/70">
                Kinh độ (Lng)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={hubLng}
                  onChange={(e) => setHubLng(e.target.value)}
                  className="font-mono-tabular w-full rounded-xl border border-emerald-950/15 bg-white px-3 py-1.5 text-xs font-semibold text-[#0f2a24] focus:border-[#2b8fd0] focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-[#2b8fd0] px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#1e74ad] cursor-pointer shrink-0"
                >
                  Lưu
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Dấu thương hiệu nhỏ mờ nhẹ ở chân Panel nạp dữ liệu */}
        <div className="mt-4 flex items-center justify-center gap-2 border-t border-emerald-950/10 pt-3 opacity-65">
          {!logoError && (
            <img
              src={logoUrl}
              alt={APP_CONFIG.companyName}
              onError={() => setLogoError(true)}
              className="h-5 w-auto object-contain select-none"
            />
          )}
          <span className="text-[11px] font-bold tracking-wide text-[#0f2a24]">
            {APP_CONFIG.companyName}
          </span>
        </div>
      </motion.div>
    </div>
  );
};
