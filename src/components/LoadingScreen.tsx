import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { APP_CONFIG } from '../config';

interface LoadingScreenProps {
  onComplete: () => void;
  farmCount: number;
  logoUrl: string;
}

const FULL_TITLE = 'ĐANG KHỞI TẠO HỆ THỐNG...';

/**
 * GIAI ĐOẠN 1: MÀN HÌNH LOADING NGẮN (TỐI ĐA ~1.8 GIÂY) VỚI LOGO THÁI VIỆT CORPORATION
 * - Logo lớn ở giữa (cao ~140px) trên khung kính trắng mờ bo tròn, hiệu ứng hiện dần
 * - Vòng radar quét xoay quanh logo
 * - Thanh tiến trình và tên "Công Ty Cổ Phần Thái Việt Corporation" bên dưới
 */
export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  onComplete,
  farmCount,
}) => {
  const [progress, setProgress] = useState(0);
  const [typedText, setTypedText] = useState('');

  useEffect(() => {
    let charIndex = 0;
    const typeInterval = setInterval(() => {
      charIndex++;
      setTypedText(FULL_TITLE.slice(0, charIndex));
      if (charIndex >= FULL_TITLE.length) {
        clearInterval(typeInterval);
      }
    }, 42);

    return () => clearInterval(typeInterval);
  }, []);

  useEffect(() => {
    const startTime = performance.now();
    const totalDuration = 1750; // Tối đa dưới 2 giây theo yêu cầu
    let animId: number;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const pct = Math.min(100, Math.round((elapsed / totalDuration) * 100));
      setProgress(pct);

      if (elapsed < totalDuration) {
        animId = requestAnimationFrame(tick);
      } else {
        setTimeout(onComplete, 160);
      }
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [onComplete]);

  const radarBlips = [
    { top: '22%', left: '68%', color: '#fb923c', delay: '0.15s' },
    { top: '74%', left: '30%', color: '#fb7185', delay: '0.5s' },
    { top: '32%', left: '24%', color: '#10b981', delay: '0.8s' },
    { top: '75%', left: '70%', color: '#2b8fd0', delay: '1.1s' },
  ];

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.03, filter: 'blur(8px)' }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-[#ecfdf5] via-[#f0f9ff] to-[#e0f2fe] px-6 text-[#0f2a24]"
    >
      {/* Lưới sinh thái nhẹ nhàng phía sau */}
      <div
        className="pointer-events-none absolute inset-0 opacity-45"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgba(43, 143, 208, 0.14) 0%, transparent 65%), linear-gradient(to right, rgba(16, 185, 129, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(16, 185, 129, 0.08) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 48px 48px, 48px 48px',
        }}
      />

      {/* Vòng Radar Quét Xoay Ở Giữa (Không hiển thị logo) */}
      <div className="relative mb-7 flex h-72 w-72 items-center justify-center rounded-full bg-white/55 shadow-[0_20px_50px_rgba(43,143,208,0.16)] backdrop-blur-xl sm:h-80 sm:w-80">
        <div className="absolute inset-0 rounded-full border-2 border-[#2b8fd0]/30" />
        <div className="absolute inset-5 rounded-full border border-dashed border-[#10b981]/35" />
        <div className="absolute inset-12 rounded-full border border-[#2b8fd0]/20" />
        <div className="absolute inset-20 rounded-full border border-dashed border-[#10b981]/25" />

        <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-[#10b981]/30 to-transparent" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-gradient-to-b from-transparent via-[#10b981]/30 to-transparent" />

        {/* Cánh quạt quét Radar */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, transparent 265deg, rgba(16, 185, 129, 0.05) 300deg, rgba(43, 143, 208, 0.28) 352deg, rgba(16, 185, 129, 0.7) 360deg)',
          }}
        />

        {/* Điểm sáng trang trại */}
        {radarBlips.map((blip, idx) => (
          <span
            key={idx}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full animate-ping"
            style={{
              top: blip.top,
              left: blip.left,
              backgroundColor: blip.color,
              boxShadow: `0 0 10px ${blip.color}`,
              animationDuration: '1.7s',
              animationDelay: blip.delay,
            }}
          />
        ))}

        {/* Tâm Radar phát sáng nhẹ */}
        <div className="relative z-10 flex items-center justify-center">
          <span className="absolute h-8 w-8 rounded-full bg-[#10b981]/20 animate-ping" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#10b981] shadow-[0_0_14px_#10b981] ring-4 ring-white/90" />
        </div>
      </div>

      {/* Tên công ty chính thức bên dưới */}
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}
        className="font-display mb-1.5 text-center text-xl font-extrabold tracking-tight text-[#0f2a24] sm:text-2xl"
      >
        {APP_CONFIG.companyName}
      </motion.h1>

      {/* Dòng chữ trạng thái gõ chữ */}
      <div className="mb-4 flex h-6 items-center justify-center">
        <p className="text-center text-xs font-bold tracking-[0.15em] text-[#2b8fd0] sm:text-sm">
          {typedText}
          <span className="ml-1 inline-block h-4 w-1.5 animate-pulse bg-[#10b981] align-middle" />
        </p>
      </div>

      {/* Thanh tiến trình bên dưới */}
      <div className="w-full max-w-md rounded-2xl border border-white/85 bg-white/75 p-4 shadow-lg backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between text-xs font-bold text-[#0f2a24]">
          <span>ĐỒNG BỘ {farmCount} TRANG TRẠI 3D</span>
          <span className="font-mono-tabular text-sm font-extrabold text-[#2b8fd0]">
            {progress}%
          </span>
        </div>
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-emerald-950/10 p-0.5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#2b8fd0] via-[#10b981] to-[#d9261c] transition-all duration-75"
            style={{
              width: `${progress}%`,
              boxShadow: '0 0 12px rgba(43, 143, 208, 0.45)',
            }}
          />
        </div>
      </div>
    </motion.div>
  );
};
