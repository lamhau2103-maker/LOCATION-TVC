import React, { useEffect, useRef, useState } from 'react';
import { FarmCategory, FarmSubType } from '../types';
import { getFarmIconSvg } from '../utils/icons';

/**
 * Vầng sáng ấm nhẹ (Warm Sunbeam Glow) đi theo con trỏ chuột (tự tắt trên màn hình cảm ứng nhỏ)
 */
export const CursorSpotlight: React.FC<{ disabled?: boolean }> = ({
  disabled = false,
}) => {
  const [pos, setPos] = useState({ x: -500, y: -500 });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (disabled) return;
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;
    const handleMouseMove = (e: MouseEvent) => {
      setPos({ x: e.clientX, y: e.clientY });
      if (!visible) setVisible(true);
    };

    const handleMouseLeave = () => setVisible(false);

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [visible, disabled]);

  if (disabled) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-30 overflow-hidden transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
      aria-hidden="true"
    >
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: pos.x,
          top: pos.y,
          width: 360,
          height: 360,
          background:
            'radial-gradient(circle, rgba(250, 204, 21, 0.13) 0%, rgba(16, 185, 129, 0.06) 42%, transparent 72%)',
        }}
      />
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: pos.x,
          top: pos.y,
          width: 90,
          height: 90,
          background:
            'radial-gradient(circle, rgba(254, 240, 138, 0.22) 0%, transparent 72%)',
        }}
      />
    </div>
  );
};

/**
 * Hạt bụi sáng rất nhẹ trong nắng ở nền các panel kính mờ
 */
export const PanelParticles: React.FC<{
  count?: number;
  color?: string;
  disabled?: boolean;
}> = ({ count = 8, color = '#facc15', disabled = false }) => {
  const particles = useRef(
    Array.from({ length: count }).map((_, i) => ({
      id: i,
      left: `${(i * 19 + 9) % 92}%`,
      top: `${(i * 29 + 13) % 88}%`,
      size: (i % 3) + 2,
      duration: 6 + (i % 5) * 1.8,
      delay: (i % 4) * 0.8,
    }))
  ).current;

  if (disabled) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      aria-hidden="true"
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute rounded-full opacity-35 animate-pulse"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            backgroundColor: color,
            boxShadow: `0 0 6px ${color}`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
};

/**
 * Lớp Mây Trắng Mờ (SVG tự tạo) trôi chậm phía trên bản đồ
 * Tự động giảm trên điện thoại/iPad và ẩn dần khi zoom sát (zoom >= 12.5) hoặc bật Chế độ nhẹ (liteMode)
 */
export const AtmosphericCloudsOverlay: React.FC<{
  zoom: number;
  liteMode: boolean;
}> = ({ zoom, liteMode }) => {
  if (liteMode) return null;

  const isCompactDevice =
    typeof window !== 'undefined' && window.innerWidth < 1024;
  const maxOpacity = isCompactDevice ? 0.32 : 0.52;
  const cloudOpacity = Math.max(0, Math.min(maxOpacity, (13 - zoom) / 5.5));
  if (cloudOpacity <= 0.01) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden transition-opacity duration-700"
      style={{ opacity: cloudOpacity }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1200 500"
        className="absolute -top-10 -left-24 h-[50dvh] w-[135vw] opacity-70"
        style={{
          animation: 'cloud-drift 75s ease-in-out infinite',
          filter: 'blur(18px)',
        }}
      >
        <g fill="#ffffff" fillOpacity="0.65">
          <ellipse cx="260" cy="140" rx="180" ry="52" />
          <ellipse cx="340" cy="125" rx="130" ry="45" />
          <ellipse cx="860" cy="190" rx="220" ry="60" />
          <ellipse cx="960" cy="170" rx="150" ry="48" />
          <ellipse cx="580" cy="340" rx="190" ry="50" />
        </g>
      </svg>

      {!isCompactDevice && (
        <svg
          viewBox="0 0 1200 500"
          className="absolute bottom-4 -right-24 h-[44dvh] w-[130vw] opacity-55"
          style={{
            animation: 'cloud-drift 95s ease-in-out infinite reverse',
            filter: 'blur(22px)',
          }}
        >
          <g fill="#ffffff" fillOpacity="0.55">
            <ellipse cx="320" cy="260" rx="210" ry="56" />
            <ellipse cx="740" cy="150" rx="175" ry="46" />
            <ellipse cx="920" cy="320" rx="200" ry="54" />
          </g>
        </svg>
      )}
    </div>
  );
};

/**
 * Bộ Icon trang trại dễ thương nét dày:
 * - chicken: Gà cam #fb923c mào đỏ
 * - pig: Heo hồng san hô #fb7185 mũi tai rõ
 * - office: Toà nhà văn phòng
 * - warehouse: Kho hàng
 * - wash: Điểm rửa xe / sát khuẩn
 * - other: Nhà trại xanh ngọc #14b8a6
 * - hub: Nhà máy trung tâm Thái Việt
 */
export const CuteCategoryIcon: React.FC<{
  category: FarmCategory | FarmSubType | 'hub';
  className?: string;
}> = ({ category, className = 'w-4 h-4' }) => {
  if (category === 'chicken') {
    return (
      <svg
        viewBox="0 0 36 36"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        <path
          d="M12.5 9.5C12.5 6.8 14.8 5.2 16.5 7.2C17.6 4.8 20.8 4.8 21.4 7.5C23.5 6.4 25.5 8.5 23.8 10.8Z"
          fill="#ef4444"
          stroke="#b91c1c"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle
          cx="17.5"
          cy="19.5"
          r="10.5"
          fill="#fb923c"
          stroke="#9a3412"
          strokeWidth="2.2"
        />
        <circle cx="13.5" cy="21.5" r="2.1" fill="#ef4444" fillOpacity="0.45" />
        <path
          d="M10.5 19.5C10.5 17 13 17 14 19.5C15 22 12 24 10.5 22Z"
          fill="#fdba74"
          stroke="#9a3412"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="20.8" cy="16.8" r="2.1" fill="#1e293b" />
        <circle cx="21.4" cy="16.1" r="0.7" fill="#ffffff" />
        <path
          d="M27.2 17.2L32.2 19.2L27.2 21.4Z"
          fill="#facc15"
          stroke="#9a3412"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M25.8 21.4C27.2 21.4 27.6 24.4 25.5 24.6C23.8 24.8 24.2 21.4 25.8 21.4Z"
          fill="#ef4444"
        />
      </svg>
    );
  }

  if (category === 'pig') {
    return (
      <svg
        viewBox="0 0 36 36"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        <path
          d="M7.5 14.5L5.2 6.5L13.5 9.2Z"
          fill="#f43f5e"
          stroke="#881337"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
        <path
          d="M28.5 14.5L30.8 6.5L22.5 9.2Z"
          fill="#f43f5e"
          stroke="#881337"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
        <circle
          cx="18"
          cy="19.5"
          r="11"
          fill="#fb7185"
          stroke="#881337"
          strokeWidth="2.2"
        />
        <circle cx="13.2" cy="16.2" r="2" fill="#1e293b" />
        <circle cx="13.7" cy="15.6" r="0.65" fill="#ffffff" />
        <circle cx="22.8" cy="16.2" r="2" fill="#1e293b" />
        <circle cx="23.3" cy="15.6" r="0.65" fill="#ffffff" />
        <rect
          x="11.8"
          y="19.5"
          width="12.4"
          height="7.6"
          rx="3.8"
          fill="#ffe4e6"
          stroke="#881337"
          strokeWidth="2"
        />
        <ellipse cx="15.6" cy="23.3" rx="1.35" ry="1.8" fill="#be123c" />
        <ellipse cx="20.4" cy="23.3" rx="1.35" ry="1.8" fill="#be123c" />
      </svg>
    );
  }

  if (category === 'office') {
    return (
      <svg
        viewBox="0 0 36 36"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        <rect
          x="8"
          y="6.5"
          width="20"
          height="23"
          rx="2.5"
          fill="#14b8a6"
          stroke="#115e59"
          strokeWidth="2.2"
        />
        <rect x="12" y="10.5" width="3.5" height="3.2" rx="0.7" fill="#ffffff" />
        <rect x="20.5" y="10.5" width="3.5" height="3.2" rx="0.7" fill="#ffffff" />
        <rect x="12" y="16" width="3.5" height="3.2" rx="0.7" fill="#ffffff" />
        <rect x="20.5" y="16" width="3.5" height="3.2" rx="0.7" fill="#ffffff" />
        <rect
          x="15"
          y="22.5"
          width="6"
          height="7"
          rx="1"
          fill="#ccfbf1"
          stroke="#115e59"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (category === 'warehouse') {
    return (
      <svg
        viewBox="0 0 36 36"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        <path
          d="M5.5 15L18 7.5L30.5 15V28.5H5.5V15Z"
          fill="#14b8a6"
          stroke="#115e59"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <rect
          x="10.5"
          y="18"
          width="15"
          height="10.5"
          rx="1.2"
          fill="#ccfbf1"
          stroke="#115e59"
          strokeWidth="1.8"
        />
        <path d="M10.5 21.5H25.5M10.5 25H25.5" stroke="#0f766e" strokeWidth="1.6" />
        <rect
          x="15.5"
          y="12"
          width="5"
          height="3"
          rx="0.8"
          fill="#ffffff"
          stroke="#115e59"
          strokeWidth="1.4"
        />
      </svg>
    );
  }

  if (category === 'wash') {
    return (
      <svg
        viewBox="0 0 36 36"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        <path
          d="M18 6C18 6 24.5 13.2 24.5 17.5C24.5 21.1 21.6 24 18 24C14.4 24 11.5 21.1 11.5 17.5C11.5 13.2 18 6 18 6Z"
          fill="#0ea5e9"
          stroke="#0369a1"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
        <circle cx="15.8" cy="18.2" r="1.6" fill="#ffffff" fillOpacity="0.85" />
        <path
          d="M7.5 27.5C10.5 25.5 14 25.5 18 27.5C22 29.5 25.5 29.5 28.5 27.5"
          stroke="#14b8a6"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (category === 'hub') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        <path
          d="M3 20V10L8.5 13.5V10L14 13.5V6H20V20H3Z"
          fill="currentColor"
          fillOpacity="0.22"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <rect x="16" y="10" width="2" height="2.5" rx="0.5" fill="currentColor" />
        <rect x="16" y="14.5" width="2" height="2.5" rx="0.5" fill="currentColor" />
      </svg>
    );
  }

  // Mặc định: Ngôi nhà trang trại xanh ngọc #14b8a6
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5 17.5L18 7L31 17.5H27.5V28.5H8.5V17.5H5Z"
        fill="#14b8a6"
        stroke="#115e59"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <rect
        x="13.2"
        y="18.2"
        width="9.6"
        height="10.3"
        rx="1.2"
        fill="#ccfbf1"
        stroke="#115e59"
        strokeWidth="1.8"
      />
      <path
        d="M13.5 18.5L22.5 28.2M22.5 18.5L13.5 28.2"
        stroke="#0f766e"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle
        cx="18"
        cy="13.5"
        r="2.1"
        fill="#ffffff"
        stroke="#115e59"
        strokeWidth="1.6"
      />
    </svg>
  );
};

/**
 * Tạo chuỗi HTML SVG icon để nhúng
 */
export function getMarkerIconSvgHtml(
  category: FarmCategory | FarmSubType | 'hub',
  size = 22
): string {
  return getFarmIconSvg(category, size);
}
