/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { APP_CONFIG, getAutoTimeOfDay } from './config';
import defaultFarmsData from './data/farms.json';
import {
  AppStage,
  CentralHub,
  Farm,
  FarmCategory,
  FarmCustomLabels,
  FarmIconOverrides,
  IconChoice,
  MapStyleMode,
  ParseResult,
  SyncState,
  TimeOfDay,
} from './types';
import {
  findFeedMill,
  getFarmKey,
  getLocationDisplayLabel,
  isConnectableFarm,
  resolveFarmIconType,
  resolveFarmSubType,
} from './utils/icons';
import {
  parseKMLContent,
  validateAndNormalizeLatLng,
} from './utils/parsers';
import { soundEngine } from './utils/sound';
import { CursorSpotlight } from './components/CursorSpotlight';
import { LoadingScreen } from './components/LoadingScreen';
import { TopControlHUD } from './components/TopControlHUD';
import {
  FarmDetailCard,
  HubDetailCard,
  MobileSheetSnap,
} from './components/FarmDetailCard';
import { DataImportModal } from './components/DataImportModal';
import {
  AdminLoginModal,
  BulkIconModal,
  PositionDiagnosticsModal,
} from './components/AdminModals';
import { MapScene, MapSceneHandle } from './components/MapScene';

function detectLowEndDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const isMobileScreen = window.innerWidth < 768;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const isLowMemory =
    typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
  return isMobileScreen || isLowMemory;
}

function formatTimeHHMM(date = new Date()): string {
  return date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function createFarmsSignature(list: Farm[]): string {
  return list
    .map(
      (f) =>
        `${f.id}|${f.name}|${f.type}|${f.lat.toFixed(5)}|${f.lng.toFixed(5)}|${f.description}`
    )
    .sort()
    .join(';;');
}

/**
 * Tách ID bản đồ Google My Maps từ đường link đầy đủ (chứa ?mid= hoặc &mid=)
 * hoặc chấp nhận trực tiếp nếu người dùng chỉ dán chuỗi ID.
 */
function extractMyMapsId(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const midMatch = trimmed.match(/[?&]mid=([^&#\s]+)/i);
  if (midMatch && midMatch[1]) {
    return midMatch[1].trim();
  }

  // Nếu người dùng dán trực tiếp chuỗi ID (chỉ gồm chữ, số, gạch ngang, gạch dưới, dài >= 15 ký tự)
  if (/^[a-zA-Z0-9_-]{15,80}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

class MyMapsFetchError extends Error {
  details: string[];
  hasGoogleLogin: boolean;

  constructor(details: string[], hasGoogleLogin: boolean) {
    super('ALL_SOURCES_FAILED');
    this.name = 'MyMapsFetchError';
    this.details = details;
    this.hasGoogleLogin = hasGoogleLogin;
  }
}

function inspectNonKmlPayload(text: string, contentType: string): {
  reason: string;
  isGoogleLogin: boolean;
} {
  const lower = text.toLowerCase();
  const isGoogleLogin =
    lower.includes('accounts.google.com') ||
    lower.includes('servicelogin') ||
    lower.includes('gaia_loginform') ||
    (lower.includes('<html') &&
      (lower.includes('sign in') ||
        lower.includes('đăng nhập') ||
        lower.includes('google accounts')));

  if (isGoogleLogin) {
    return {
      reason: 'Google trả về trang đăng nhập: bản đồ chưa được chia sẻ công khai',
      isGoogleLogin: true,
    };
  }

  // Nếu phản hồi là JSON lỗi từ /api/farms
  if (contentType.includes('application/json') || text.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
        return {
          reason: parsed.error.trim(),
          isGoogleLogin: false,
        };
      }
    } catch {
      // ignore
    }
  }

  return {
    reason: 'không phải KML hợp lệ',
    isGoogleLogin: false,
  };
}

/**
 * Tải nội dung KML từ ID bản đồ Google My Maps:
 * 1. Thử gọi `/api/farms?mid=ID` (hoặc `/api/farms` nếu không truyền ID)
 * 2. Nếu `/api` không hoạt động (ví dụ trong preview AI Studio), thử lần lượt qua 2 CORS proxy:
 *    - proxy 1: https://api.allorigins.win/raw?url=...
 *    - proxy 2: https://corsproxy.io/?...
 * Khi thất bại, ném MyMapsFetchError kèm chi tiết từng bước ("/api/farms: ...", "proxy 1: ...", "proxy 2: ...")
 * và ghi vào console.error.
 */
async function fetchKmlFromMyMapsId(mid?: string): Promise<string> {
  const ts = Date.now();
  const apiEndpoint = mid
    ? `/api/farms?mid=${encodeURIComponent(mid)}&t=${ts}`
    : `/api/farms?t=${ts}`;

  const details: string[] = [];
  let hasGoogleLogin = false;

  const fetchWithTimeout = async (url: string, timeoutMs = 10000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/xml, text/xml, */*',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // Bước 1: Thử gọi serverless endpoint /api/farms
  try {
    const res = await fetchWithTimeout(apiEndpoint, 10000);
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (res.ok) {
      const isHtmlFallback =
        contentType.includes('text/html') ||
        text.trim().startsWith('<!doctype html') ||
        text.trim().startsWith('<html');

      if (
        !isHtmlFallback &&
        (text.includes('<kml') || text.includes('<Placemark'))
      ) {
        return text;
      }

      const inspected = inspectNonKmlPayload(text, contentType);
      if (inspected.isGoogleLogin) hasGoogleLogin = true;
      details.push(`/api/farms: ${inspected.reason}`);
    } else {
      const inspected = inspectNonKmlPayload(text, contentType);
      if (inspected.isGoogleLogin) {
        hasGoogleLogin = true;
        details.push(`/api/farms: HTTP ${res.status} (${inspected.reason})`);
      } else if (inspected.reason !== 'không phải KML hợp lệ') {
        details.push(`/api/farms: HTTP ${res.status} - ${inspected.reason}`);
      } else {
        details.push(`/api/farms: HTTP ${res.status}`);
      }
    }
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const errMsg = isTimeout
      ? 'timeout'
      : err instanceof Error
      ? err.message
      : 'lỗi kết nối';
    details.push(`/api/farms: ${errMsg}`);
  }

  if (!mid) {
    console.error('[Đồng bộ Google My Maps thất bại]', details.join(' | '));
    throw new MyMapsFetchError(details, hasGoogleLogin);
  }

  // Bước 2: Gọi trực tiếp Google My Maps KML qua 2 CORS proxy dự phòng (kèm cache-buster t=Date.now())
  const targetKmlUrl = `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(
    mid
  )}&forcekml=1&t=${ts}`;

  const proxies = [
    {
      label: 'proxy 1',
      url: `https://api.allorigins.win/raw?url=${encodeURIComponent(
        targetKmlUrl
      )}`,
    },
    {
      label: 'proxy 2',
      url: `https://corsproxy.io/?${encodeURIComponent(targetKmlUrl)}`,
    },
  ];

  for (const proxy of proxies) {
    try {
      const res = await fetchWithTimeout(proxy.url, 10000);
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();

      if (res.ok) {
        if (text.includes('<kml') || text.includes('<Placemark')) {
          return text;
        }
        const inspected = inspectNonKmlPayload(text, contentType);
        if (inspected.isGoogleLogin) hasGoogleLogin = true;
        details.push(`${proxy.label}: ${inspected.reason}`);
      } else {
        const inspected = inspectNonKmlPayload(text, contentType);
        if (inspected.isGoogleLogin) {
          hasGoogleLogin = true;
          details.push(
            `${proxy.label}: HTTP ${res.status} (${inspected.reason})`
          );
        } else {
          details.push(`${proxy.label}: HTTP ${res.status}`);
        }
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const errMsg = isTimeout
        ? 'timeout'
        : err instanceof Error
        ? err.message
        : 'lỗi kết nối';
      details.push(`${proxy.label}: ${errMsg}`);
    }
  }

  console.error('[Đồng bộ Google My Maps thất bại]', details.join(' | '));
  throw new MyMapsFetchError(details, hasGoogleLogin);
}

export default function App() {
  // 1. Giai đoạn trải nghiệm: loading ngắn (< 2s) -> mở thẳng vào địa cầu tự xoay ('globe') -> bản đồ ('map')
  const [stage, setStage] = useState<AppStage>('loading');

  // 2. Đường dẫn Logo (ưu tiên logo tuỳ chỉnh lưu trong localStorage nếu có, mặc định "/logo.png")
  const [logoUrl, setLogoUrl] = useState<string>(() => {
    try {
      return (
        localStorage.getItem(APP_CONFIG.customLogoStorageKey) ||
        APP_CONFIG.logoUrl
      );
    } catch {
      return APP_CONFIG.logoUrl;
    }
  });

  // Cập nhật document.title và cắt phần Hoa sen phía trên (~78%) của logo làm Favicon
  useEffect(() => {
    document.title = APP_CONFIG.documentTitle;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Chỉ cắt lấy 76% phần hoa sen phía trên của ảnh logo để làm favicon rõ nét
        const sourceHeight = img.height * 0.76;
        ctx.drawImage(
          img,
          0,
          0,
          img.width,
          sourceHeight,
          4,
          4,
          56,
          56
        );

        const faviconEl = document.getElementById(
          'app-favicon'
        ) as HTMLLinkElement | null;
        if (faviconEl) {
          faviconEl.href = canvas.toDataURL('image/png');
        }
      } catch {
        // Giữ nguyên /logo.png nếu trình duyệt chặn canvas
      }
    };
    img.src = logoUrl;
  }, [logoUrl]);

  // 3. Lưu trữ Link & ID Google My Maps trong localStorage
  const [savedMyMapsId, setSavedMyMapsId] = useState<string>(() => {
    try {
      return localStorage.getItem(APP_CONFIG.myMapsIdStorageKey) || '';
    } catch {
      return '';
    }
  });

  const [savedMyMapsLink, setSavedMyMapsLink] = useState<string>(() => {
    try {
      return localStorage.getItem(APP_CONFIG.myMapsLinkStorageKey) || '';
    } catch {
      return '';
    }
  });

  // 4. Dữ liệu trang trại gốc (Thứ tự dự phòng: localStorage -> src/data/farms.json)
  const [rawFarms, setRawFarms] = useState<Farm[]>(() => {
    try {
      const saved = localStorage.getItem(APP_CONFIG.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return defaultFarmsData as unknown as Farm[];
  });

  const rawFarmsRef = useRef<Farm[]>(rawFarms);
  rawFarmsRef.current = rawFarms;

  // 4b. Bảng lựa chọn Icon thủ công đồng bộ từ Upstash Redis (/api/icons) + cache localStorage
  const [iconOverrides, setIconOverrides] = useState<FarmIconOverrides>(() => {
    try {
      const saved = localStorage.getItem(APP_CONFIG.iconOverridesStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return parsed as FarmIconOverrides;
        }
      }
    } catch {
      // ignore
    }
    return {};
  });

  // 4b-2. Bảng nhãn mô tả tùy chỉnh (Admin chỉnh sửa, đồng bộ từ Upstash Redis + cache localStorage)
  const [customLabels, setCustomLabels] = useState<FarmCustomLabels>(() => {
    try {
      const saved = localStorage.getItem(APP_CONFIG.customLabelsStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return parsed as FarmCustomLabels;
        }
      }
    } catch {
      // ignore
    }
    return {};
  });

  const [isServerIconConnected, setIsServerIconConnected] =
    useState<boolean>(true);
  const [bouncingFarmId, setBouncingFarmId] = useState<string | null>(null);

  // 4c. Chế độ Quản trị viên (Lưu mật khẩu phiên làm việc trong sessionStorage, xác thực ở server)
  const [adminPassword, setAdminPassword] = useState<string>(() => {
    try {
      return sessionStorage.getItem(APP_CONFIG.adminSessionStorageKey) || '';
    } catch {
      return '';
    }
  });
  const isAdmin = Boolean(adminPassword);
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false);
  const [isBulkIconModalOpen, setIsBulkIconModalOpen] = useState(false);
  const [isPositionDiagOpen, setIsPositionDiagOpen] = useState(false);

  // Áp dụng quy tắc kiểm tra toạ độ chính xác 100% + nhận diện tự động "Nhà Máy Cám" từ dữ liệu My Maps + phân loại Icon 3 tầng
  const farms = useMemo<Farm[]>(() => {
    const detectedFeedMill = findFeedMill(rawFarms);
    const feedMillId = detectedFeedMill?.id || null;

    const result: Farm[] = [];
    for (const f of rawFarms) {
      const checked = validateAndNormalizeLatLng(f.lat, f.lng, f.name);
      const exactLat = checked ? checked.lat : f.lat;
      const exactLng = checked ? checked.lng : f.lng;
      const key = getFarmKey(exactLat, exactLng);
      const manual = iconOverrides[key];
      const customLabel = customLabels[key];
      const isFeedMill = Boolean(feedMillId && f.id === feedMillId);

      const baseFarm: Farm = {
        ...f,
        lat: exactLat,
        lng: exactLng,
        farmKey: key,
        manualIcon: manual || 'auto',
        isFeedMill,
        customLabel: customLabel || undefined,
      };
      const resolvedCategory = isFeedMill
        ? 'other'
        : resolveFarmIconType(baseFarm, iconOverrides);
      const resolvedSubType = isFeedMill
        ? 'hub'
        : resolveFarmSubType(baseFarm, iconOverrides);
      const connectable = isFeedMill
        ? false
        : isConnectableFarm(baseFarm, iconOverrides);
      result.push({
        ...baseFarm,
        category: resolvedCategory,
        subType: resolvedSubType,
        isConnectable: connectable,
      });
    }
    return result;
  }, [rawFarms, iconOverrides, customLabels]);

  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(new Set());
  const [removingFarms, setRemovingFarms] = useState<Farm[]>([]);

  // 5. Trạng thái đồng bộ tự động Google My Maps
  const [syncState, setSyncState] = useState<SyncState>(() => {
    let savedTime: string | null = null;
    try {
      savedTime = localStorage.getItem(APP_CONFIG.lastSyncStorageKey);
    } catch {
      // ignore
    }
    return {
      isSyncing: false,
      lastSyncedTime: savedTime,
      isOfflineFallback: false,
      statusText: savedTime
        ? `Đồng bộ lúc ${savedTime}`
        : 'Đang dùng dữ liệu đã lưu',
    };
  });

  // 6. Tự động lấy "Nhà Máy Cám" trực tiếp từ dữ liệu Google My Maps làm tâm phát đốm sáng (không tạo điểm cứng giả)
  const feedMillFarm = useMemo<Farm | null>(
    () => farms.find((f) => f.isFeedMill) || null,
    [farms]
  );

  const centralHub = useMemo<CentralHub | null>(() => {
    if (!feedMillFarm) return null;
    return {
      id: feedMillFarm.id,
      farmKey: feedMillFarm.farmKey,
      name: feedMillFarm.name,
      subtitle: feedMillFarm.type || 'Nhà máy cám Thái Việt Corporation',
      lat: feedMillFarm.lat,
      lng: feedMillFarm.lng,
      address: feedMillFarm.description || '',
    };
  }, [feedMillFarm]);

  // 7. Trạng thái tương tác bản đồ, Nhà máy trung tâm (đường cung), đường cung đơn lẻ & bộ lọc
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [isHubSelected, setIsHubSelected] = useState<boolean>(false);
  const [singleArcFarmId, setSingleArcFarmId] = useState<string | null>(null);
  const [mobileSheetSnap, setMobileSheetSnap] =
    useState<MobileSheetSnap>('half');

  const selectedFarm = useMemo(
    () =>
      selectedFarmId
        ? farms.find((f) => f.id === selectedFarmId) || null
        : null,
    [farms, selectedFarmId]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategories, setActiveCategories] = useState<
    Record<FarmCategory, boolean>
  >({
    chicken: true,
    pig: true,
    other: true,
  });

  // 7b. Khôi phục & lưu các tùy chỉnh cá nhân của người dùng (nền, thời gian, chế độ nhẹ, âm thanh, bán kính) vào localStorage
  const savedUserPrefs = useMemo(() => {
    try {
      const raw = localStorage.getItem(APP_CONFIG.userPrefsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as {
            mapStyleMode?: MapStyleMode;
            timeOfDay?: TimeOfDay;
            isAutoTime?: boolean;
            liteMode?: boolean;
            soundEnabled?: boolean;
            biosecurityRadius?: number;
          };
        }
      }
    } catch {
      // ignore
    }
    return {};
  }, []);

  const [biosecurityRadius, setBiosecurityRadius] = useState<number>(() =>
    typeof savedUserPrefs.biosecurityRadius === 'number'
      ? savedUserPrefs.biosecurityRadius
      : APP_CONFIG.defaultBiosecurityRadiusMeters
  );

  // Mặc định nền Bản đồ 2D là Bản đồ Đường phố / Hành chính phẳng ('street' - nhẹ, load tức thì, không tải ảnh vệ tinh nặng trừ khi người dùng chủ động bật)
  const [mapStyleMode, setMapStyleMode] = useState<MapStyleMode>('street');
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(() =>
    savedUserPrefs.timeOfDay &&
    savedUserPrefs.timeOfDay in APP_CONFIG.timePresets
      ? savedUserPrefs.timeOfDay
      : 'day'
  );
  const [isAutoTime, setIsAutoTime] = useState<boolean>(() =>
    Boolean(savedUserPrefs.isAutoTime)
  );
  const [liteMode, setLiteMode] = useState<boolean>(() =>
    typeof savedUserPrefs.liteMode === 'boolean'
      ? savedUserPrefs.liteMode
      : detectLowEndDevice()
  );
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() =>
    Boolean(savedUserPrefs.soundEnabled)
  );
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const mapSceneRef = useRef<MapSceneHandle | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(
        APP_CONFIG.userPrefsStorageKey,
        JSON.stringify({
          mapStyleMode,
          timeOfDay,
          isAutoTime,
          liteMode,
          soundEnabled,
          biosecurityRadius,
        })
      );
    } catch {
      // ignore
    }
  }, [
    mapStyleMode,
    timeOfDay,
    isAutoTime,
    liteMode,
    soundEnabled,
    biosecurityRadius,
  ]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    if (!isAutoTime) return;
    setTimeOfDay(getAutoTimeOfDay());
    const interval = setInterval(() => {
      setTimeOfDay(getAutoTimeOfDay());
    }, 60_000);
    return () => clearInterval(interval);
  }, [isAutoTime]);

  /**
   * Đồng bộ bảng lựa chọn icon & nhãn mô tả tùy chỉnh từ máy chủ Upstash Redis (`GET /api/icons`)
   * Lưu cache vào localStorage để nếu mất mạng vẫn dùng được bản gần nhất.
   */
  const syncIconsFromServer = useCallback(async () => {
    try {
      const res = await fetch(`/api/icons?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        setIsServerIconConnected(false);
        return false;
      }

      const data = (await res.json()) as
        | {
            ok?: boolean;
            icons?: Record<string, string>;
            customLabels?: Record<string, string>;
            items?: Array<{ farm_key?: string; icon?: string }>;
          }
        | Array<{ farm_key?: string; icon?: string }>;

      const cleaned: FarmIconOverrides = {};
      if (Array.isArray(data)) {
        for (const item of data) {
          const k = String(item?.farm_key || '');
          const v = item?.icon;
          if (k && (v === 'chicken' || v === 'pig')) {
            cleaned[k] = v;
          }
        }
        setIconOverrides(cleaned);
        setIsServerIconConnected(true);
        try {
          localStorage.setItem(
            APP_CONFIG.iconOverridesStorageKey,
            JSON.stringify(cleaned)
          );
        } catch {
          // ignore
        }
        return true;
      }

      if (data && data.icons && typeof data.icons === 'object') {
        for (const [k, v] of Object.entries(data.icons)) {
          if (v === 'chicken' || v === 'pig') {
            cleaned[k] = v;
          }
        }
        setIconOverrides(cleaned);
        setIsServerIconConnected(true);
        try {
          localStorage.setItem(
            APP_CONFIG.iconOverridesStorageKey,
            JSON.stringify(cleaned)
          );
        } catch {
          // ignore
        }

        if (data.customLabels && typeof data.customLabels === 'object') {
          const cleanedLabels: FarmCustomLabels = {};
          for (const [k, v] of Object.entries(data.customLabels)) {
            if (typeof v === 'string' && v.trim()) {
              cleanedLabels[k] = v.trim();
            }
          }
          setCustomLabels(cleanedLabels);
          try {
            localStorage.setItem(
              APP_CONFIG.customLabelsStorageKey,
              JSON.stringify(cleanedLabels)
            );
          } catch {
            // ignore
          }
        }
        return true;
      }
      setIsServerIconConnected(false);
      return false;
    } catch {
      setIsServerIconConnected(false);
      return false;
    }
  }, []);

  const applySyncedFarmsWithDiff = useCallback((nextFarms: Farm[]) => {
    const currentList = rawFarmsRef.current;
    const isDifferent =
      createFarmsSignature(currentList) !== createFarmsSignature(nextFarms);

    if (isDifferent) {
      const oldIds = new Set(currentList.map((f) => f.id));
      const nextIds = new Set(nextFarms.map((f) => f.id));

      const added = new Set<string>();
      nextFarms.forEach((f) => {
        if (!oldIds.has(f.id)) {
          added.add(f.id);
        }
      });

      const removed = currentList.filter((f) => !nextIds.has(f.id));

      if (added.size > 0) {
        setNewlyAddedIds(added);
        setTimeout(() => setNewlyAddedIds(new Set()), 2200);
      }

      if (removed.length > 0) {
        setRemovingFarms(removed);
        setTimeout(() => setRemovingFarms([]), 750);
      }

      setRawFarms(nextFarms);
    }

    try {
      localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(nextFarms));
    } catch {
      // ignore
    }

    return isDifferent;
  }, []);

  /**
   * Đồng bộ tự động (Ưu tiên: ID trong localStorage -> biến môi trường MYMAPS_ID trên server -> dữ liệu dự phòng)
   * Đồng thời gọi song song `/api/farms` và `/api/icons`
   */
  const syncFromGoogleMyMaps = useCallback(
    async (isManualClick = false, customMid?: string) => {
      const targetMid =
        customMid !== undefined ? customMid : savedMyMapsId || undefined;

      setSyncState((prev) => ({
        ...prev,
        isSyncing: true,
      }));

      // Luôn tải song song bảng icon mới nhất từ Upstash Redis
      void syncIconsFromServer();

      try {
        const kmlText = await fetchKmlFromMyMapsId(targetMid);
        const parsed = parseKMLContent(kmlText, 'Google My Maps');
        const changed = applySyncedFarmsWithDiff(parsed.farms);
        const nowStr = formatTimeHHMM();

        try {
          localStorage.setItem(APP_CONFIG.lastSyncStorageKey, nowStr);
        } catch {
          // ignore
        }

        setSyncState({
          isSyncing: false,
          lastSyncedTime: nowStr,
          isOfflineFallback: false,
          statusText: `Đồng bộ lúc ${nowStr}`,
        });

        if (changed || isManualClick) {
          soundEngine.playScanSuccess(soundEnabled);
          showToast(`Đã nạp ${parsed.farms.length} trang trại từ My Maps`);
        }
        return {
          ok: true,
          count: parsed.farms.length,
        };
      } catch {
        setSyncState((prev) => ({
          isSyncing: false,
          lastSyncedTime: prev.lastSyncedTime,
          isOfflineFallback: true,
          statusText: prev.lastSyncedTime
            ? `Đồng bộ lúc ${prev.lastSyncedTime}`
            : 'Đang dùng dữ liệu đã lưu',
        }));

        if (isManualClick) {
          showToast(
            'Đã đồng bộ cấu hình icon. Để nạp mới từ My Maps, hãy bấm NẠP DỮ LIỆU để dán link My Maps.'
          );
        }
        return {
          ok: false,
          count: 0,
        };
      }
    },
    [
      applySyncedFarmsWithDiff,
      savedMyMapsId,
      showToast,
      soundEnabled,
      syncIconsFromServer,
    ]
  );

  // Tự động đồng bộ song song (/api/farms và /api/icons) khi mở app và lặp lại mỗi 5 phút khi tab đang mở
  useEffect(() => {
    syncFromGoogleMyMaps(false);

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncFromGoogleMyMaps(false);
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [syncFromGoogleMyMaps]);

  /**
   * Đăng nhập Chế độ Quản trị viên:
   * - Gửi POST /api/icons?action=login kèm header x-admin-password
   * - Nếu server trả 401 -> báo "Sai mật khẩu"
   * - Nếu đang chạy ở môi trường preview chưa có /api/icons, kiểm tra mật khẩu "admintvc"
   */
  const handleAdminLogin = useCallback(
    async (password: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch('/api/icons?action=login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': password,
            Accept: 'application/json',
          },
        });

        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');

        if (res.status === 401) {
          return { ok: false, error: 'Sai mật khẩu' };
        }

        if (res.ok && isJson) {
          setAdminPassword(password);
          setIsServerIconConnected(true);
          try {
            sessionStorage.setItem(
              APP_CONFIG.adminSessionStorageKey,
              password
            );
          } catch {
            // ignore
          }
          soundEngine.playScanSuccess(soundEnabled);
          showToast('Đã bật Chế độ Quản trị viên.');
          return { ok: true };
        }

        // Trường hợp máy chủ chưa kết nối Redis (503) hoặc môi trường preview tĩnh: kiểm tra mật khẩu admintvc
        if (password !== 'admintvc') {
          return { ok: false, error: 'Sai mật khẩu' };
        }

        setAdminPassword(password);
        setIsServerIconConnected(false);
        try {
          sessionStorage.setItem(APP_CONFIG.adminSessionStorageKey, password);
        } catch {
          // ignore
        }
        soundEngine.playScanSuccess(soundEnabled);
        showToast('Đã bật Chế độ Quản trị viên.');
        return { ok: true };
      } catch {
        if (password !== 'admintvc') {
          return { ok: false, error: 'Sai mật khẩu' };
        }

        setAdminPassword(password);
        setIsServerIconConnected(false);
        try {
          sessionStorage.setItem(APP_CONFIG.adminSessionStorageKey, password);
        } catch {
          // ignore
        }
        soundEngine.playScanSuccess(soundEnabled);
        showToast('Đã bật Chế độ Quản trị viên.');
        return { ok: true };
      }
    },
    [showToast, soundEnabled]
  );

  const handleLogoutAdmin = useCallback(() => {
    setAdminPassword('');
    setIsBulkIconModalOpen(false);
    try {
      sessionStorage.removeItem(APP_CONFIG.adminSessionStorageKey);
    } catch {
      // ignore
    }
    showToast('Đã thoát Chế độ Quản trị.');
  }, [showToast]);

  /**
   * Quản trị viên chọn icon (Gà / Heo / Tự động) cho 1 trang trại:
   * - Cập nhật giao diện ngay lập tức (marker nảy nhẹ, mái chuồng 3D đổi màu, thống kê cập nhật)
   * - Gửi POST /api/icons lên Upstash Redis
   * - Nếu server trả lỗi xác thực (401/500), hoàn tác lại và báo lỗi
   */
  const handleSelectFarmIcon = useCallback(
    async (farm: Farm, choice: IconChoice) => {
      const key = farm.farmKey || getFarmKey(farm.lat, farm.lng);
      const prevOverrides = iconOverrides;

      const nextOverrides: FarmIconOverrides = { ...prevOverrides };
      if (choice === 'auto') {
        delete nextOverrides[key];
      } else {
        nextOverrides[key] = choice;
      }

      // Cập nhật lạc quan (optimistic UI) + hiệu ứng nảy marker
      setIconOverrides(nextOverrides);
      setBouncingFarmId(farm.id);
      setTimeout(() => {
        setBouncingFarmId((cur) => (cur === farm.id ? null : cur));
      }, 950);
      soundEngine.playPing(soundEnabled);

      try {
        localStorage.setItem(
          APP_CONFIG.iconOverridesStorageKey,
          JSON.stringify(nextOverrides)
        );
      } catch {
        // ignore
      }

      try {
        const res = await fetch('/api/icons', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': adminPassword,
            Accept: 'application/json',
          },
          body: JSON.stringify({ key, icon: choice }),
        });

        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');

        if (res.status === 401) {
          // Sai mật khẩu -> hoàn tác
          setIconOverrides(prevOverrides);
          showToast('Sai mật khẩu quản trị, đã hoàn tác thay đổi.');
          return;
        }

        if (res.ok && isJson) {
          setIsServerIconConnected(true);
          showToast('Đã lưu cho mọi người');
          return;
        }

        if (res.status === 503 || !isJson) {
          setIsServerIconConnected(false);
          showToast('Chưa kết nối máy chủ: lựa chọn chỉ lưu trên máy này');
          return;
        }

        // Lỗi server khác -> hoàn tác
        setIconOverrides(prevOverrides);
        showToast('Lỗi máy chủ khi lưu icon, đã hoàn tác.');
      } catch {
        setIsServerIconConnected(false);
        showToast('Chưa kết nối máy chủ: lựa chọn chỉ lưu trên máy này');
      }
    },
    [adminPassword, iconOverrides, showToast, soundEnabled]
  );

  /**
   * Quản trị viên chọn icon hàng loạt cho nhiều trang trại cùng lúc (tối đa 500 mục mỗi lần gọi)
   */
  const handleBulkSelectFarmsIcon = useCallback(
    async (targetFarms: Farm[], choice: IconChoice) => {
      if (targetFarms.length === 0) return;
      const prevOverrides = iconOverrides;
      const nextOverrides: FarmIconOverrides = { ...prevOverrides };

      const items = targetFarms.slice(0, 500).map((f) => {
        const key = f.farmKey || getFarmKey(f.lat, f.lng);
        if (choice === 'auto') {
          delete nextOverrides[key];
        } else {
          nextOverrides[key] = choice;
        }
        return { key, icon: choice };
      });

      setIconOverrides(nextOverrides);
      soundEngine.playScanSuccess(soundEnabled);

      try {
        localStorage.setItem(
          APP_CONFIG.iconOverridesStorageKey,
          JSON.stringify(nextOverrides)
        );
      } catch {
        // ignore
      }

      try {
        const res = await fetch('/api/icons', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': adminPassword,
            Accept: 'application/json',
          },
          body: JSON.stringify({ items }),
        });

        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');

        if (res.status === 401) {
          setIconOverrides(prevOverrides);
          showToast('Sai mật khẩu quản trị, đã hoàn tác thay đổi.');
          return;
        }

        if (res.ok && isJson) {
          setIsServerIconConnected(true);
          showToast('Đã lưu cho mọi người');
          return;
        }

        if (res.status === 503 || !isJson) {
          setIsServerIconConnected(false);
          showToast('Chưa kết nối máy chủ: lựa chọn chỉ lưu trên máy này');
          return;
        }

        setIconOverrides(prevOverrides);
        showToast('Lỗi máy chủ khi lưu hàng loạt, đã hoàn tác.');
      } catch {
        setIsServerIconConnected(false);
        showToast('Chưa kết nối máy chủ: lựa chọn chỉ lưu trên máy này');
      }
    },
    [adminPassword, iconOverrides, showToast, soundEnabled]
  );

  /**
   * Quản trị viên chỉnh sửa nhãn mô tả hiển thị (Trụ sở chính, Văn phòng, Nhà máy cám, Kho trung tâm, Trại heo, Trại gà...)
   * Lưu vào Upstash Redis (hash `farm_labels`) qua POST /api/icons để mọi người dùng đều nhìn thấy ngay.
   * Truyền chuỗi rỗng '' để khôi phục nhãn mặc định.
   */
  const handleSaveCustomLabel = useCallback(
    async (farm: Farm, nextLabel: string) => {
      const key = farm.farmKey || getFarmKey(farm.lat, farm.lng);
      const trimmed = nextLabel.trim();
      const prevLabels = customLabels;
      const nextLabels: FarmCustomLabels = { ...prevLabels };
      if (!trimmed) {
        delete nextLabels[key];
      } else {
        nextLabels[key] = trimmed;
      }

      setCustomLabels(nextLabels);
      soundEngine.playPing(soundEnabled);

      try {
        localStorage.setItem(
          APP_CONFIG.customLabelsStorageKey,
          JSON.stringify(nextLabels)
        );
      } catch {
        // ignore
      }

      try {
        const res = await fetch('/api/icons', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': adminPassword,
            Accept: 'application/json',
          },
          body: JSON.stringify({ key, label: trimmed }),
        });

        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');

        if (res.status === 401) {
          setCustomLabels(prevLabels);
          showToast('Sai mật khẩu quản trị, đã hoàn tác thay đổi nhãn.');
          return;
        }

        if (res.ok && isJson) {
          setIsServerIconConnected(true);
          showToast(
            trimmed
              ? `Đã lưu nhãn "${trimmed}" cho mọi người`
              : 'Đã khôi phục nhãn mặc định cho mọi người'
          );
          return;
        }

        if (res.status === 503 || !isJson) {
          setIsServerIconConnected(false);
          showToast('Chưa kết nối máy chủ: nhãn mô tả chỉ lưu trên máy này');
          return;
        }

        setCustomLabels(prevLabels);
        showToast('Lỗi máy chủ khi lưu nhãn mô tả, đã hoàn tác.');
      } catch {
        setIsServerIconConnected(false);
        showToast('Chưa kết nối máy chủ: nhãn mô tả chỉ lưu trên máy này');
      }
    },
    [adminPassword, customLabels, showToast, soundEnabled]
  );

  /**
   * Xử lý khi người dùng dán link Google My Maps trong panel NẠP DỮ LIỆU và bấm "Đồng bộ"
   */
  const handleSyncFromLinkInput = async (
    rawInput: string
  ): Promise<{ ok: boolean; message: string; details?: string[] }> => {
    const mid = extractMyMapsId(rawInput);
    if (!mid) {
      return {
        ok: false,
        message: 'Link chưa đúng, hãy dùng link đầy đủ có chứa mid=...',
      };
    }

    try {
      void syncIconsFromServer();
      const kmlText = await fetchKmlFromMyMapsId(mid);
      const parsed = parseKMLContent(kmlText, 'Google My Maps');
      applySyncedFarmsWithDiff(parsed.farms);

      const nowStr = formatTimeHHMM();
      setSavedMyMapsId(mid);
      setSavedMyMapsLink(rawInput.trim());

      try {
        localStorage.setItem(APP_CONFIG.myMapsIdStorageKey, mid);
        localStorage.setItem(
          APP_CONFIG.myMapsLinkStorageKey,
          rawInput.trim()
        );
        localStorage.setItem(APP_CONFIG.lastSyncStorageKey, nowStr);
      } catch {
        // ignore
      }

      setSyncState({
        isSyncing: false,
        lastSyncedTime: nowStr,
        isOfflineFallback: false,
        statusText: `Đồng bộ lúc ${nowStr}`,
      });

      soundEngine.playScanSuccess(soundEnabled);
      const msg = `Đã nạp ${parsed.farms.length} trang trại từ My Maps`;
      showToast(msg);

      return {
        ok: true,
        message: msg,
      };
    } catch (err) {
      const details =
        err instanceof MyMapsFetchError && err.details.length > 0
          ? err.details
          : undefined;
      const hasGoogleLogin =
        err instanceof MyMapsFetchError && err.hasGoogleLogin;

      return {
        ok: false,
        message: hasGoogleLogin
          ? 'Google trả về trang đăng nhập: bản đồ chưa được chia sẻ công khai'
          : "Không đọc được bản đồ. Hãy kiểm tra bản đồ đã chia sẻ 'Bất kỳ ai có đường liên kết đều có thể xem' chưa.",
        details,
      };
    }
  };

  const handleClearSavedLink = () => {
    setSavedMyMapsId('');
    setSavedMyMapsLink('');
    try {
      localStorage.removeItem(APP_CONFIG.myMapsIdStorageKey);
      localStorage.removeItem(APP_CONFIG.myMapsLinkStorageKey);
    } catch {
      // ignore
    }
    showToast('Đã xoá link Google My Maps đã lưu.');
  };

  const handleUpdateCustomLogo = (base64Logo: string | null) => {
    if (base64Logo) {
      setLogoUrl(base64Logo);
      try {
        localStorage.setItem(APP_CONFIG.customLogoStorageKey, base64Logo);
      } catch {
        // ignore
      }
      showToast('Đã cập nhật logo thương hiệu mới.');
    } else {
      setLogoUrl(APP_CONFIG.logoUrl);
      try {
        localStorage.removeItem(APP_CONFIG.customLogoStorageKey);
      } catch {
        // ignore
      }
    }
  };

  const filteredFarms = useMemo(
    () => farms.filter((f) => activeCategories[f.category]),
    [farms, activeCategories]
  );

  // Bỏ chọn trang trại & nhà máy trung tâm (thu hồi đường cung về nhà máy và xoá hoàn toàn ArcLayer)
  const handleClearSelection = useCallback(() => {
    setSelectedFarmId(null);
    setIsHubSelected(false);
    setSingleArcFarmId(null);
    mapSceneRef.current?.clearCameraPadding();
  }, []);

  /**
   * Nút "Trở về ban đầu":
   * 1. Đóng toàn bộ card thông tin trang trại/nhà máy đang mở và xóa text trong ô chọn điểm.
   * 2. Tắt trạng thái chọn Nhà máy trung tâm (tắt các đường cung & đốm sáng độ phủ nếu đang bật).
   * 3. Bật lại cả 3 chip lọc (Trại gà = true, Trại heo = true, Khác = true) để hiển thị đầy đủ tất cả các điểm.
   * 4. Đưa người dùng quay lại góc nhìn Quả địa cầu 3D ban đầu (stage = 'globe') hướng về khu vực Việt Nam / Đông Nam Á.
   */
  const handleResetToInitialView = useCallback(() => {
    setSelectedFarmId(null);
    setIsHubSelected(false);
    setSingleArcFarmId(null);
    setSearchQuery('');
    setActiveCategories({
      chicken: true,
      pig: true,
      other: true,
    });
    setStage('globe');
    soundEngine.playWhoosh(soundEnabled, 1.5);
    mapSceneRef.current?.resetToInitialView('globe');
  }, [soundEnabled]);

  // Nhấn phím Esc để đóng card thông tin / bỏ chọn Nhà máy trung tâm và thu hồi đường kết nối
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedFarmId || isHubSelected || singleArcFarmId) {
          handleClearSelection();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClearSelection, isHubSelected, selectedFarmId, singleArcFarmId]);

  // Bấm vào Icon Nhà Máy Cám (điểm thật từ My Maps) -> bắn các đường cung từ Nhà Máy Cám tới các Trại gà & Trại heo
  const handleSelectHub = useCallback(() => {
    if (!centralHub) return;
    setSelectedFarmId(null);
    setSingleArcFarmId(null);
    setIsHubSelected(true);
    setMobileSheetSnap('half');
    soundEngine.playPing(soundEnabled);
    soundEngine.playWhoosh(soundEnabled, 1.5);
    mapSceneRef.current?.flyToConnectedOverview();
  }, [centralHub, soundEnabled]);

  // Cách vào bản đồ (e): Bấm nút tròn nhỏ "Xem bản đồ chi tiết" ở góc dưới địa cầu hoặc nút la bàn
  const handleEnterMapOverview = useCallback(() => {
    setSelectedFarmId(null);
    setIsHubSelected(false);
    setSingleArcFarmId(null);
    setStage('map');
    soundEngine.playWhoosh(soundEnabled, 1.8);
    mapSceneRef.current?.flyToOverview(1800, 0);
  }, [soundEnabled]);

  // Cách vào bản đồ (a): Bấm vào một điểm trang trại trên địa cầu (hoặc trên bản đồ) -> bay tới và mở card
  const handleSelectFarm = useCallback(
    (farm: Farm) => {
      // Nếu người dùng chọn đúng "Nhà Máy Cám" -> bật luôn mạng lưới cung ứng & thẻ Nhà Máy Cám
      if (farm.isFeedMill || (centralHub?.id && farm.id === centralHub.id)) {
        handleSelectHub();
        return;
      }
      if (stage === 'globe') {
        setStage('map');
      }
      setIsHubSelected(false);
      setSingleArcFarmId((prev) => (prev === farm.id ? prev : null));
      setSelectedFarmId(farm.id);
      setMobileSheetSnap('half');
      soundEngine.playPing(soundEnabled);
      soundEngine.playWhoosh(soundEnabled, 1.3);
      mapSceneRef.current?.flyToFarm(farm, 15.8);
    },
    [centralHub, handleSelectHub, stage, soundEnabled]
  );

  // Cách vào bản đồ (b): Gõ tìm kiếm rồi nhấn Enter -> bay tới điểm khớp đầu tiên
  const handleSearchSubmit = () => {
    const q = searchQuery.trim().toLowerCase().normalize('NFC');
    if (!q) return;

    const firstMatch = farms.find((f) => {
      const label = getLocationDisplayLabel(f, customLabels)
        .toLowerCase()
        .normalize('NFC');
      return (
        f.name.toLowerCase().normalize('NFC').includes(q) ||
        f.type.toLowerCase().normalize('NFC').includes(q) ||
        label.includes(q) ||
        f.description.toLowerCase().normalize('NFC').includes(q)
      );
    });

    if (firstMatch) {
      handleSelectFarm(firstMatch);
    } else {
      showToast(`Không tìm thấy địa điểm nào khớp với "${searchQuery}"`);
    }
  };

  // Cách (d): Bấm chip loại -> bật/tắt nhóm đó ngay lập tức trên cả địa cầu lẫn bản đồ chi tiết
  const handleToggleCategory = (cat: FarmCategory) => {
    setActiveCategories((prev) => {
      const nextState = !prev[cat];
      const next = { ...prev, [cat]: nextState };

      // Nếu người dùng tắt một nhóm mà trại đang chọn hoặc đường nối đơn lẻ thuộc nhóm đó, ẩn luôn đường nối tới nhóm bị tắt
      if (!nextState) {
        if (selectedFarm && selectedFarm.category === cat) {
          setSelectedFarmId(null);
        }
        if (singleArcFarmId) {
          const arcFarm = farms.find((f) => f.id === singleArcFarmId);
          if (arcFarm && arcFarm.category === cat) {
            setSingleArcFarmId(null);
          }
        }
      }

      return next;
    });
  };

  const handlePrevFarm = () => {
    if (!selectedFarm || filteredFarms.length === 0) return;
    const idx = filteredFarms.findIndex((f) => f.id === selectedFarm.id);
    const prevIdx = idx <= 0 ? filteredFarms.length - 1 : idx - 1;
    handleSelectFarm(filteredFarms[prevIdx]);
  };

  const handleNextFarm = () => {
    if (!selectedFarm || filteredFarms.length === 0) return;
    const idx = filteredFarms.findIndex((f) => f.id === selectedFarm.id);
    const nextIdx = idx >= filteredFarms.length - 1 ? 0 : idx + 1;
    handleSelectFarm(filteredFarms[nextIdx]);
  };

  // Xử lý sau khi nạp file KML / CSV / GeoJSON thủ công (không tự chuyển cảnh, địa cầu vẫn xoay)
  const handleImportSuccess = (result: ParseResult) => {
    applySyncedFarmsWithDiff(result.farms);
    setSelectedFarmId(null);
    setActiveCategories({ chicken: true, pig: true, other: true });

    const nowStr = formatTimeHHMM();
    setSyncState({
      isSyncing: false,
      lastSyncedTime: nowStr,
      isOfflineFallback: false,
      statusText: `Đồng bộ lúc ${nowStr}`,
    });

    soundEngine.playScanSuccess(soundEnabled);

    const warnSuffix =
      result.warnings.length > 0 ? ` (${result.warnings[0]})` : '';
    showToast(
      `Đã nạp ${result.farms.length} trang trại từ "${result.sourceName}"${warnSuffix}`
    );

    if (stage === 'map') {
      setTimeout(() => {
        mapSceneRef.current?.flyToOverview(3200, 60);
      }, 200);
    }
  };

  const handleToggleMapStyle = () => {
    setMapStyleMode((prev) => {
      const next = prev === 'satellite' ? 'street' : 'satellite';
      showToast(
        next === 'satellite'
          ? 'Đã chuyển sang nền Ảnh Vệ Tinh (Esri World Imagery)'
          : 'Đã chuyển sang nền Bản đồ Đường phố 2D (OpenStreetMap)'
      );
      return next;
    });
  };

  const handleSelectTimeOfDay = (t: TimeOfDay) => {
    setIsAutoTime(false);
    setTimeOfDay(t);
    showToast(`Chế độ ánh sáng: ${APP_CONFIG.timePresets[t].label}`);
  };

  const handleToggleAutoTime = () => {
    setIsAutoTime((prev) => {
      const next = !prev;
      if (next) {
        const autoT = getAutoTimeOfDay();
        setTimeOfDay(autoT);
        showToast(
          `Đã bật Tự động theo giờ (${APP_CONFIG.timePresets[autoT].label})`
        );
      } else {
        showToast('Đã tắt Tự động theo giờ');
      }
      return next;
    });
  };

  const handleToggleLiteMode = () => {
    setLiteMode((prev) => {
      const next = !prev;
      showToast(
        next
          ? 'Đã BẬT Chế độ nhẹ (Giảm độ phân giải render, tắt mây để tối ưu FPS)'
          : 'Đã TẮT Chế độ nhẹ (Hiển thị đầy đủ hiệu ứng 3D & khí quyển)'
      );
      return next;
    });
  };

  const handleToggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      if (next) {
        soundEngine.playPing(true);
        showToast('Đã BẬT hiệu ứng âm thanh (Web Audio API)');
      } else {
        showToast('Đã TẮT hiệu ứng âm thanh');
      }
      return next;
    });
  };

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-[#e6f4f1] select-none">
      {/* Vầng sáng ấm nhẹ đi theo con trỏ chuột */}
      <CursorSpotlight disabled={liteMode} />

      {/* Bản đồ Địa cầu 3D tự xoay & Bản đồ 2D phẳng nhẹ */}
      <MapScene
        ref={mapSceneRef}
        stage={stage}
        logoUrl={logoUrl}
        farms={farms}
        newlyAddedIds={newlyAddedIds}
        removingFarms={removingFarms}
        bouncingFarmId={bouncingFarmId}
        centralHub={centralHub}
        customLabels={customLabels}
        selectedFarm={selectedFarm}
        isHubSelected={isHubSelected}
        singleArcFarmId={singleArcFarmId}
        mobileSheetSnap={mobileSheetSnap}
        onSelectFarm={handleSelectFarm}
        onSelectHub={handleSelectHub}
        onClearSelection={handleClearSelection}
        onEnterMapOverview={handleEnterMapOverview}
        activeCategories={activeCategories}
        searchQuery={searchQuery}
        biosecurityRadius={biosecurityRadius}
        mapStyleMode={mapStyleMode}
        timeOfDay={timeOfDay}
        liteMode={liteMode}
        onSatelliteFallbackToStreet={() => {
          setMapStyleMode((prev) => {
            if (prev === 'street') return prev;
            showToast(
              'Ảnh vệ tinh khu vực này chưa đầy đủ, đã chuyển sang bản đồ đường phố'
            );
            return 'street';
          });
        }}
      />

      {/* GIAI ĐOẠN 1: Màn hình Loading ngắn (< 2s) */}
      <AnimatePresence>
        {stage === 'loading' && (
          <LoadingScreen
            farmCount={farms.length}
            logoUrl={logoUrl}
            onComplete={() => setStage('globe')}
          />
        )}
      </AnimatePresence>

      {/* Bảng thống kê & Thanh điều khiển (Đáp ứng mọi thiết bị) */}
      <AnimatePresence>
        {stage !== 'loading' && (
          <TopControlHUD
            stage={stage}
            companyName={APP_CONFIG.companyName}
            logoUrl={logoUrl}
            farms={farms}
            centralHub={centralHub}
            customLabels={customLabels}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSearchSubmit={handleSearchSubmit}
            onSelectFarm={handleSelectFarm}
            activeCategories={activeCategories}
            onToggleCategory={handleToggleCategory}
            biosecurityRadius={biosecurityRadius}
            onRadiusChange={setBiosecurityRadius}
            onResetToInitial={handleResetToInitialView}
            mapStyleMode={mapStyleMode}
            onToggleMapStyle={handleToggleMapStyle}
            timeOfDay={timeOfDay}
            isAutoTime={isAutoTime}
            onSelectTimeOfDay={handleSelectTimeOfDay}
            onToggleAutoTime={handleToggleAutoTime}
            liteMode={liteMode}
            onToggleLiteMode={handleToggleLiteMode}
            syncState={syncState}
            onSyncNow={() => syncFromGoogleMyMaps(true)}
            soundEnabled={soundEnabled}
            onToggleSound={handleToggleSound}
            onOpenImport={() => setIsImportModalOpen(true)}
            onFlyOverview={handleEnterMapOverview}
            onBackToGlobe={() => {
              handleClearSelection();
              setStage('globe');
              soundEngine.playWhoosh(soundEnabled, 2.0);
              mapSceneRef.current?.flyToGlobe();
            }}
            onFlyToHub={handleSelectHub}
            isAdmin={isAdmin}
            isServerIconConnected={isServerIconConnected}
            onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
            onLogoutAdmin={handleLogoutAdmin}
            onOpenBulkIconModal={() => setIsBulkIconModalOpen(true)}
            onOpenPositionDiagnostics={() => setIsPositionDiagOpen(true)}
            hasActiveCard={Boolean(selectedFarm || isHubSelected)}
          />
        )}
      </AnimatePresence>

      {/* Card thông tin Trang trại (Kính trắng mờ / Bottom-Sheet 3 nấc trên điện thoại) */}
      <AnimatePresence>
        {stage !== 'loading' && selectedFarm && (
          <FarmDetailCard
            farm={selectedFarm}
            centralHub={centralHub}
            customLabels={customLabels}
            biosecurityRadius={biosecurityRadius}
            logoUrl={logoUrl}
            onClose={handleClearSelection}
            onPrevFarm={filteredFarms.length > 1 ? handlePrevFarm : undefined}
            onNextFarm={filteredFarms.length > 1 ? handleNextFarm : undefined}
            liteMode={liteMode}
            isAdmin={isAdmin}
            onSelectFarmIcon={handleSelectFarmIcon}
            onSaveCustomLabel={handleSaveCustomLabel}
            isSingleArcActive={singleArcFarmId === selectedFarm.id}
            onToggleSingleArc={() => {
              setSingleArcFarmId((prev) =>
                prev === selectedFarm.id ? null : selectedFarm.id
              );
              soundEngine.playPing(soundEnabled);
            }}
            mobileSheetSnap={mobileSheetSnap}
            onChangeMobileSheetSnap={setMobileSheetSnap}
          />
        )}
      </AnimatePresence>

      {/* Card thông tin Nhà Máy Cám (Khi bấm vào điểm Nhà Máy Cám thật từ My Maps) */}
      <AnimatePresence>
        {stage !== 'loading' && centralHub && isHubSelected && !selectedFarm && (
          <HubDetailCard
            centralHub={centralHub}
            feedMillFarm={feedMillFarm}
            customLabels={customLabels}
            farms={farms}
            activeCategories={activeCategories}
            logoUrl={logoUrl}
            onClose={handleClearSelection}
            onSelectFarm={handleSelectFarm}
            liteMode={liteMode}
            isAdmin={isAdmin}
            onSaveCustomLabel={handleSaveCustomLabel}
            mobileSheetSnap={mobileSheetSnap}
            onChangeMobileSheetSnap={setMobileSheetSnap}
          />
        )}
      </AnimatePresence>

      {/* Modal Nạp dữ liệu & Đồng bộ từ link Google My Maps */}
      <DataImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportSuccess={handleImportSuccess}
        currentFarmCount={farms.length}
        centralHub={centralHub}
        savedMyMapsLink={savedMyMapsLink}
        onSyncFromLink={handleSyncFromLinkInput}
        onClearSavedLink={handleClearSavedLink}
        logoUrl={logoUrl}
        onUpdateCustomLogo={handleUpdateCustomLogo}
      />

      {/* Hộp thoại Đăng nhập Quản trị viên */}
      <AdminLoginModal
        isOpen={isAdminLoginOpen}
        onClose={() => setIsAdminLoginOpen(false)}
        onSubmitPassword={handleAdminLogin}
      />

      {/* Hộp thoại Chọn icon & nhãn mô tả hàng loạt cho Quản trị viên */}
      <BulkIconModal
        isOpen={isBulkIconModalOpen}
        onClose={() => setIsBulkIconModalOpen(false)}
        farms={farms}
        customLabels={customLabels}
        isServerConnected={isServerIconConnected}
        onSelectFarmIcon={handleSelectFarmIcon}
        onBulkSelectFarmsIcon={handleBulkSelectFarmsIcon}
        onSaveCustomLabel={handleSaveCustomLabel}
      />

      {/* Hộp thoại Kiểm tra vị trí toạ độ 3D cho Quản trị viên */}
      <PositionDiagnosticsModal
        isOpen={isPositionDiagOpen}
        onClose={() => setIsPositionDiagOpen(false)}
        getDiagnostics={() =>
          mapSceneRef.current?.getPositionDiagnostics() || []
        }
        onFlyToPoint={(_lat, _lng, id) => {
          const found = farms.find((f) => f.id === id);
          if (found?.isFeedMill || (centralHub?.id && id === centralHub.id)) {
            handleSelectHub();
          } else if (found) {
            handleSelectFarm(found);
          }
        }}
      />

      {/* Thông báo Toast sáng tươi mới ở góc dưới màn hình */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            className="glass-panel pointer-events-none fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-full px-5 py-2.5 text-xs font-bold text-[#0f2a24] sm:bottom-16 sm:text-sm"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2b8fd0]" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gợi ý thao tác nhanh ở góc phải dưới khi đang ở Bản đồ */}
      {stage === 'map' && !selectedFarm && !isHubSelected && (
        <div className="glass-panel pointer-events-none fixed right-4 bottom-3 z-20 hidden items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] font-semibold text-[#0f2a24]/80 lg:flex">
          <Sparkles className="h-3.5 w-3.5 text-[#2b8fd0]" />
          <span>
            Bấm vào Nhà Máy Cám để hiện đường kết nối · Bấm Ghim trang trại để xem chi tiết
          </span>
        </div>
      )}
    </div>
  );
}
