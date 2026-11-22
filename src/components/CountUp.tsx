import React, { useEffect, useState } from 'react';

interface CountUpProps {
  end: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}

/**
 * Component hiệu ứng đếm số tăng dần mượt mà (Count-Up Animation)
 */
export const CountUp: React.FC<CountUpProps> = ({
  end,
  duration = 950,
  decimals = 0,
  suffix = '',
  prefix = '',
  className = '',
}) => {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    let animationFrameId: number;
    const startValue = 0;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const elapsed = timestamp - startTimestamp;
      const progress = Math.min(elapsed / duration, 1);

      // Easing out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (end - startValue) * eased;
      setValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        setValue(end);
      }
    };

    animationFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrameId);
  }, [end, duration]);

  const formatted =
    decimals > 0
      ? value.toLocaleString('vi-VN', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : Math.round(value).toLocaleString('vi-VN');

  return (
    <span className={`font-mono-tabular ${className}`}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};
