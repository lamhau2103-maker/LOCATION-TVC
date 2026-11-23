import {
  CachedDrivingEntry,
  DrivingDistanceCache,
  DrivingRouteResult,
} from '../types';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface GetDrivingDistancesOptions {
  signal?: AbortSignal;
  onBatchComplete?: (
    startIndex: number,
    batchResults: DrivingRouteResult[]
  ) => void;
  onBatchError?: (error: unknown) => void;
}

const OSRM_TABLE_BASE_URL =
  'https://router.project-osrm.org/table/v1/driving';
const MAX_DESTINATIONS_PER_BATCH = 40;
const BATCH_DELAY_MS = 500;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 15000;
const COORD_EPSILON = 1e-6;

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createCombinedSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    controller.abort(new DOMException('Timeout', 'TimeoutError'));
  }, timeoutMs);

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

interface OsrmTableResponse {
  code?: string;
  message?: string;
  distances?: Array<Array<number | null>>;
  durations?: Array<Array<number | null>>;
}

async function fetchOsrmBatch(
  origin: LatLngPoint,
  destinations: LatLngPoint[],
  externalSignal?: AbortSignal
): Promise<{ okFromServer: boolean; results: DrivingRouteResult[] }> {
  // OSRM quy định thứ tự KINH ĐỘ (lng) trước, VĨ ĐỘ (lat) sau; vị trí 0 là FEED FACTORY
  const coords = [origin, ...destinations]
    .map((p) => `${p.lng},${p.lat}`)
    .join(';');
  const url = `${OSRM_TABLE_BASE_URL}/${coords}?sources=0&annotations=distance,duration`;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (externalSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (attempt > 0) {
      await sleepWithAbort(RETRY_DELAY_MS, externalSignal);
    }

    const { signal, cleanup } = createCombinedSignal(
      REQUEST_TIMEOUT_MS,
      externalSignal
    );

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal,
      });

      if (!response.ok) {
        throw new Error(`OSRM HTTP ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as OsrmTableResponse;
      if (data.code !== 'Ok' || !Array.isArray(data.distances?.[0])) {
        console.error(
          '[OSRM] Không tính được bảng khoảng cách cho nhóm điểm:',
          data.code,
          data.message || data
        );
        return {
          okFromServer: true,
          results: destinations.map(() => ({
            distanceMeters: null,
            durationSeconds: null,
          })),
        };
      }

      const rowDistances = data.distances[0];
      const rowDurations = Array.isArray(data.durations?.[0])
        ? data.durations[0]
        : [];

      const results: DrivingRouteResult[] = destinations.map((_, idx) => {
        const rawDist = rowDistances[idx + 1];
        const rawDur = rowDurations[idx + 1];
        const distanceMeters =
          typeof rawDist === 'number' &&
          Number.isFinite(rawDist) &&
          rawDist >= 0
            ? rawDist
            : null;
        const durationSeconds =
          distanceMeters !== null &&
          typeof rawDur === 'number' &&
          Number.isFinite(rawDur) &&
          rawDur >= 0
            ? rawDur
            : null;

        return { distanceMeters, durationSeconds };
      });

      return { okFromServer: true, results };
    } catch (err) {
      if (externalSignal?.aborted) {
        throw err;
      }
      lastError = err;
      console.warn(
        `[OSRM] Thử lần ${attempt + 1}/${MAX_RETRIES + 1} thất bại:`,
        err
      );
    } finally {
      cleanup();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Lỗi kết nối dịch vụ OSRM');
}

/**
 * Hàm tách biệt để lấy quãng đường & thời gian di chuyển thực tế bằng ô tô.
 * Hiện tại dùng OSRM Table API (miễn phí, không cần API key).
 * Có thể thay thế bằng Google Routes API sau này mà không cần sửa giao diện.
 */
export async function getDrivingDistances(
  origin: LatLngPoint,
  destinations: LatLngPoint[],
  options?: GetDrivingDistancesOptions
): Promise<DrivingRouteResult[]> {
  if (destinations.length === 0) return [];

  const allResults: DrivingRouteResult[] = [];
  const totalBatches = Math.ceil(
    destinations.length / MAX_DESTINATIONS_PER_BATCH
  );
  let failedBatches = 0;
  let lastBatchError: unknown = null;

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (batchIdx > 0) {
      await sleepWithAbort(BATCH_DELAY_MS, options?.signal);
    }

    const startIndex = batchIdx * MAX_DESTINATIONS_PER_BATCH;
    const batch = destinations.slice(
      startIndex,
      startIndex + MAX_DESTINATIONS_PER_BATCH
    );

    try {
      const { results } = await fetchOsrmBatch(
        origin,
        batch,
        options?.signal
      );
      allResults.push(...results);
      options?.onBatchComplete?.(startIndex, results);
    } catch (err) {
      if (options?.signal?.aborted) {
        throw err;
      }
      failedBatches += 1;
      lastBatchError = err;
      console.error(
        `[OSRM] Nhóm ${batchIdx + 1}/${totalBatches} lỗi sau ${MAX_RETRIES} lần thử lại:`,
        err
      );
      options?.onBatchError?.(err);
      allResults.push(
        ...batch.map(() => ({
          distanceMeters: null,
          durationSeconds: null,
        }))
      );
    }
  }

  if (failedBatches === totalBatches) {
    throw lastBatchError instanceof Error
      ? lastBatchError
      : new Error('Không lấy được quãng đường từ dịch vụ OSRM');
  }

  return allResults;
}

export function isCacheEntryValid(
  entry: CachedDrivingEntry | undefined,
  origin: LatLngPoint,
  destination: LatLngPoint
): boolean {
  if (!entry) return false;
  return (
    Math.abs(entry.originLat - origin.lat) <= COORD_EPSILON &&
    Math.abs(entry.originLng - origin.lng) <= COORD_EPSILON &&
    Math.abs(entry.destLat - destination.lat) <= COORD_EPSILON &&
    Math.abs(entry.destLng - destination.lng) <= COORD_EPSILON
  );
}

export function loadDrivingDistanceCache(
  storageKey: string
): DrivingDistanceCache {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as DrivingDistanceCache;
  } catch {
    return {};
  }
}

export function saveDrivingDistanceCache(
  storageKey: string,
  cache: DrivingDistanceCache
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(cache));
  } catch {
    // ignore storage quota errors
  }
}

export function formatDrivingDistanceKm(distanceMeters: number): string {
  const km = distanceMeters / 1000;
  return `${km.toLocaleString('vi-VN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} km`;
}

export function formatDrivingDuration(durationSeconds: number): string {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return '~0 phút';
  }
  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `~${hours} giờ ${minutes} phút`;
  }
  if (hours > 0) {
    return `~${hours} giờ`;
  }
  return `~${minutes} phút`;
}
