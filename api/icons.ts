/**
 * Vercel Serverless Function: /api/icons
 * Lưu trữ và đồng bộ lựa chọn icon trang trại ("chicken" | "pig") dùng chung cho mọi người
 * thông qua Upstash Redis REST API (KHÔNG cần cài thêm thư viện ngoài).
 *
 * Biến môi trường sử dụng trên server:
 * - UPSTASH_REDIS_REST_URL (hoặc KV_REST_API_URL)
 * - UPSTASH_REDIS_REST_TOKEN (hoặc KV_REST_API_TOKEN)
 * - ADMIN_PASSWORD
 */

const REDIS_HASH_KEY = 'farm_icons';
const REDIS_LABELS_HASH_KEY = 'farm_labels';
const REDIS_DISINFECTION_HASH_KEY = 'disinfection_routes';
const FARM_KEY_REGEX = /^-?\d{1,2}\.\d{5},-?\d{1,3}\.\d{5}$/;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

function getRedisCredentials() {
  const url = (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const token = (
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    ''
  ).trim();
  return { url, token };
}

export default async function handler(req: any, res: any) {
  const { url: redisUrl, token: redisToken } = getRedisCredentials();
  const adminPassword = (process.env.ADMIN_PASSWORD || 'admintvc').trim();

  // 1. GET /api/icons -> Đọc đồng thời hash "farm_icons" và "farm_labels" từ Upstash Redis
  if (req.method === 'GET') {
    if (!redisUrl || !redisToken) {
      res.status(503).json({
        error:
          'Chưa cấu hình UPSTASH_REDIS_REST_URL hoặc UPSTASH_REDIS_REST_TOKEN trên server.',
        code: 'MISSING_REDIS_ENV',
      });
      return;
    }

    try {
      const [iconsRes, labelsRes, arcColorsRes, disinfectionRes] = await Promise.all([
        fetch(`${redisUrl}/hgetall/${encodeURIComponent(REDIS_HASH_KEY)}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${redisToken}`,
            Accept: 'application/json',
          },
        }),
        fetch(
          `${redisUrl}/hgetall/${encodeURIComponent(REDIS_LABELS_HASH_KEY)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${redisToken}`,
              Accept: 'application/json',
            },
          }
        ),
        fetch(`${redisUrl}/get/arc_colors`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${redisToken}`,
            Accept: 'application/json',
          },
        }),
        fetch(
          `${redisUrl}/hgetall/${encodeURIComponent(REDIS_DISINFECTION_HASH_KEY)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${redisToken}`,
              Accept: 'application/json',
            },
          }
        ),
      ]);

      if (!iconsRes.ok) {
        res.status(iconsRes.status).json({
          error: `Upstash Redis trả về mã lỗi ${iconsRes.status}.`,
        });
        return;
      }

      const data = await iconsRes.json();
      const rawArray: unknown = data?.result;

      const items: Array<{ farm_key: string; icon: 'chicken' | 'pig' }> = [];
      const iconsMap: Record<string, 'chicken' | 'pig'> = {};

      if (Array.isArray(rawArray)) {
        for (let i = 0; i < rawArray.length; i += 2) {
          const field = String(rawArray[i] || '').trim();
          const val = String(rawArray[i + 1] || '').trim();
          if (field && (val === 'chicken' || val === 'pig')) {
            items.push({ farm_key: field, icon: val });
            iconsMap[field] = val;
          }
        }
      }

      const customLabels: Record<string, string> = {};
      if (labelsRes.ok) {
        const labelsData = await labelsRes.json();
        const rawLabels: unknown = labelsData?.result;
        if (Array.isArray(rawLabels)) {
          for (let i = 0; i < rawLabels.length; i += 2) {
            const field = String(rawLabels[i] || '').trim();
            const val = String(rawLabels[i + 1] || '').trim();
            if (field && val) {
              customLabels[field] = val;
            }
          }
        }
      }

      let arcColors = null;
      if (arcColorsRes.ok) {
        const arcData = await arcColorsRes.json();
        const rawArc = arcData?.result;
        if (typeof rawArc === 'string' && rawArc.trim()) {
          try {
            arcColors = JSON.parse(rawArc);
          } catch {}
        }
      }

      const disinfectionRoutes: Record<
        string,
        { targetFarmKeys: string[]; fromColor: string; toColor: string }
      > = {};
      if (disinfectionRes.ok) {
        const disData = await disinfectionRes.json();
        const rawDis: unknown = disData?.result;
        if (Array.isArray(rawDis)) {
          for (let i = 0; i < rawDis.length; i += 2) {
            const field = String(rawDis[i] || '').trim();
            const rawVal = String(rawDis[i + 1] || '').trim();
            if (field && rawVal) {
              try {
                const parsed = JSON.parse(rawVal);
                if (parsed && typeof parsed === 'object') {
                  const targetFarmKeys = Array.isArray(parsed.targetFarmKeys)
                    ? parsed.targetFarmKeys
                        .map((k: unknown) => String(k || '').trim())
                        .filter(Boolean)
                    : [];
                  const fromColor = HEX_COLOR_REGEX.test(
                    String(parsed.fromColor || '').trim()
                  )
                    ? String(parsed.fromColor).trim()
                    : '#0EA5E9';
                  const toColor = HEX_COLOR_REGEX.test(
                    String(parsed.toColor || '').trim()
                  )
                    ? String(parsed.toColor).trim()
                    : '#38BDF8';
                  disinfectionRoutes[field] = {
                    targetFarmKeys,
                    fromColor,
                    toColor,
                  };
                }
              } catch {
                // ignore malformed entry
              }
            }
          }
        }
      }

      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );
      res.status(200).json({
        ok: true,
        icons: iconsMap,
        items,
        customLabels,
        arcColors,
        disinfectionRoutes,
      });
      return;
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Lỗi kết nối tới Upstash Redis.',
      });
      return;
    }
  }

  // 2. POST /api/icons (bao gồm ?action=login, lưu lựa chọn icon và lưu nhãn mô tả customLabels)
  if (req.method === 'POST') {
    const providedPassword = String(
      req.headers?.['x-admin-password'] || ''
    ).trim();

    if (!providedPassword || providedPassword !== adminPassword) {
      res.status(401).json({ error: 'Sai mật khẩu quản trị.' });
      return;
    }

    // Nếu là POST /api/icons?action=login -> chỉ kiểm tra mật khẩu
    const action = req.query?.action;
    if (action === 'login') {
      res.status(200).json({
        ok: true,
        hasRedis: Boolean(redisUrl && redisToken),
      });
      return;
    }

    if (!redisUrl || !redisToken) {
      res.status(503).json({
        error:
          'Chưa cấu hình UPSTASH_REDIS_REST_URL hoặc UPSTASH_REDIS_REST_TOKEN trên server.',
        code: 'MISSING_REDIS_ENV',
      });
      return;
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ error: 'Body JSON không hợp lệ.' });
        return;
      }
    }

    // Chuẩn hoá danh sách mục icon cần lưu
    const rawIconItems: Array<{
      farm_key?: unknown;
      key?: unknown;
      icon?: unknown;
    }> = Array.isArray(body?.items)
      ? body.items
      : body &&
        typeof body === 'object' &&
        ('farm_key' in body || 'key' in body) &&
        'icon' in body
      ? [body]
      : [];

    // Chuẩn hoá danh sách mục nhãn mô tả (customLabels) cần lưu
    const rawLabelItems: Array<{
      farm_key?: unknown;
      key?: unknown;
      label?: unknown;
    }> = Array.isArray(body?.labelItems)
      ? body.labelItems
      : body &&
        typeof body === 'object' &&
        ('farm_key' in body || 'key' in body) &&
        'label' in body
      ? [body]
      : [];

    const hasArcColors = body?.arcColors && typeof body.arcColors === 'object';
    const rawDisinfectionRoute =
      body?.disinfectionRoute && typeof body.disinfectionRoute === 'object'
        ? body.disinfectionRoute
        : null;

    if (
      rawIconItems.length === 0 &&
      rawLabelItems.length === 0 &&
      !hasArcColors &&
      !rawDisinfectionRoute
    ) {
      res.status(400).json({
        error:
          'Thiếu dữ liệu { farm_key, icon }, { farm_key, label }, { arcColors: {...} }, { disinfectionRoute: {...} } hoặc các mục cập nhật.',
      });
      return;
    }

    if (rawIconItems.length > 500 || rawLabelItems.length > 500) {
      res.status(400).json({
        error: 'Số lượng mục cập nhật tối đa trong một lần là 500.',
      });
      return;
    }

    const iconHsetArgs: string[] = [];
    const iconHdelArgs: string[] = [];

    for (const item of rawIconItems) {
      const farmKey = String(item?.farm_key || item?.key || '').trim();
      const icon = String(item?.icon || '').trim();

      if (!FARM_KEY_REGEX.test(farmKey)) {
        res.status(400).json({
          error: `Định dạng farm_key "${farmKey}" không hợp lệ (cần dạng lat,lng với 5 chữ số thập phân, ví dụ "10.96540,107.01280").`,
        });
        return;
      }

      if (icon !== 'chicken' && icon !== 'pig' && icon !== 'auto') {
        res.status(400).json({
          error: `Giá trị icon "${icon}" không hợp lệ. Chỉ chấp nhận "chicken", "pig" hoặc "auto".`,
        });
        return;
      }

      if (icon === 'auto') {
        iconHdelArgs.push(farmKey);
      } else {
        iconHsetArgs.push(farmKey, icon);
      }
    }

    const labelHsetArgs: string[] = [];
    const labelHdelArgs: string[] = [];

    for (const item of rawLabelItems) {
      const farmKey = String(item?.farm_key || item?.key || '').trim();
      const rawLabel =
        item?.label === null || item?.label === undefined
          ? ''
          : String(item.label).trim();

      if (!FARM_KEY_REGEX.test(farmKey)) {
        res.status(400).json({
          error: `Định dạng farm_key "${farmKey}" không hợp lệ.`,
        });
        return;
      }

      if (!rawLabel || rawLabel.toLowerCase() === 'auto') {
        labelHdelArgs.push(farmKey);
      } else {
        labelHsetArgs.push(farmKey, rawLabel.slice(0, 60));
      }
    }

    let disinfectionPayload: {
      farmKey: string;
      config: { targetFarmKeys: string[]; fromColor: string; toColor: string };
    } | null = null;

    if (rawDisinfectionRoute) {
      const washKey = String(
        rawDisinfectionRoute.farm_key || rawDisinfectionRoute.key || ''
      ).trim();
      if (!FARM_KEY_REGEX.test(washKey)) {
        res.status(400).json({
          error: `Định dạng farm_key "${washKey}" cho điểm rửa xe không hợp lệ.`,
        });
        return;
      }
      const rawTargets = Array.isArray(rawDisinfectionRoute.targetFarmKeys)
        ? rawDisinfectionRoute.targetFarmKeys
        : [];
      if (rawTargets.length > 500) {
        res.status(400).json({
          error: 'Số lượng trại được gán tối đa là 500.',
        });
        return;
      }
      const targetFarmKeys: string[] = Array.from(
        new Set(
          rawTargets
            .map((k: unknown) => String(k || '').trim())
            .filter((s: string) => s.length > 0)
        )
      );
      const rawFrom = String(rawDisinfectionRoute.fromColor || '').trim();
      const rawTo = String(rawDisinfectionRoute.toColor || '').trim();
      const fromColor = HEX_COLOR_REGEX.test(rawFrom) ? rawFrom : '#0EA5E9';
      const toColor = HEX_COLOR_REGEX.test(rawTo) ? rawTo : '#38BDF8';

      disinfectionPayload = {
        farmKey: washKey,
        config: {
          targetFarmKeys,
          fromColor,
          toColor,
        },
      };
    }

    try {
      const execRedisCmd = async (cmd: string[]) => {
        const r = await fetch(redisUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${redisToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(cmd),
        });
        if (!r.ok) {
          throw new Error(`Upstash ${cmd[0]} lỗi mã ${r.status}`);
        }
      };

      if (iconHsetArgs.length > 0) {
        await execRedisCmd(['HSET', REDIS_HASH_KEY, ...iconHsetArgs]);
      }
      if (iconHdelArgs.length > 0) {
        await execRedisCmd(['HDEL', REDIS_HASH_KEY, ...iconHdelArgs]);
      }
      if (labelHsetArgs.length > 0) {
        await execRedisCmd(['HSET', REDIS_LABELS_HASH_KEY, ...labelHsetArgs]);
      }
      if (labelHdelArgs.length > 0) {
        await execRedisCmd(['HDEL', REDIS_LABELS_HASH_KEY, ...labelHdelArgs]);
      }
      if (body?.arcColors && typeof body.arcColors === 'object') {
        await execRedisCmd(['SET', 'arc_colors', JSON.stringify(body.arcColors)]);
      }
      if (disinfectionPayload) {
        await execRedisCmd([
          'HSET',
          REDIS_DISINFECTION_HASH_KEY,
          disinfectionPayload.farmKey,
          JSON.stringify(disinfectionPayload.config),
        ]);
      }

      res.status(200).json({
        ok: true,
        updated: iconHsetArgs.length / 2,
        deleted: iconHdelArgs.length,
        labelsUpdated: labelHsetArgs.length / 2,
        labelsDeleted: labelHdelArgs.length,
        disinfectionUpdated: disinfectionPayload ? 1 : 0,
      });
      return;
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Không thể lưu dữ liệu vào Upstash Redis.',
      });
      return;
    }
  }

  res.status(405).json({ error: 'Method Not Allowed. Chỉ hỗ trợ GET và POST.' });
}
