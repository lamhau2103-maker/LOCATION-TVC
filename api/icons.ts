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
const FARM_KEY_REGEX = /^-?\d{1,2}\.\d{5},-?\d{1,3}\.\d{5}$/;

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

  // 1. GET /api/icons -> Đọc toàn bộ hash "farm_icons" từ Upstash Redis
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
      const response = await fetch(
        `${redisUrl}/hgetall/${encodeURIComponent(REDIS_HASH_KEY)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${redisToken}`,
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        res.status(response.status).json({
          error: `Upstash Redis trả về mã lỗi ${response.status}.`,
        });
        return;
      }

      const data = await response.json();
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

      res.setHeader(
        'Cache-Control',
        's-maxage=30, stale-while-revalidate=120'
      );
      res.status(200).json({ ok: true, icons: iconsMap, items });
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

  // 2. POST /api/icons (bao gồm ?action=login và lưu lựa chọn icon)
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

    // Chuẩn hoá danh sách mục cần lưu: hỗ trợ { farm_key, icon }, { key, icon } hoặc { items: [...] }
    const rawItems: Array<{
      farm_key?: unknown;
      key?: unknown;
      icon?: unknown;
    }> = Array.isArray(body?.items)
      ? body.items
      : body &&
        typeof body === 'object' &&
        ('farm_key' in body || 'key' in body)
      ? [body]
      : [];

    if (rawItems.length === 0) {
      res.status(400).json({
        error: 'Thiếu dữ liệu { farm_key, icon } hoặc { items: [...] }.',
      });
      return;
    }

    if (rawItems.length > 500) {
      res.status(400).json({
        error: 'Số lượng mục cập nhật tối đa trong một lần là 500.',
      });
      return;
    }

    const hsetArgs: string[] = [];
    const hdelArgs: string[] = [];

    for (const item of rawItems) {
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
        hdelArgs.push(farmKey);
      } else {
        hsetArgs.push(farmKey, icon);
      }
    }

    try {
      // Thực thi lệnh HSET cho các mục "chicken" / "pig"
      if (hsetArgs.length > 0) {
        const hsetRes = await fetch(redisUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${redisToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(['HSET', REDIS_HASH_KEY, ...hsetArgs]),
        });

        if (!hsetRes.ok) {
          throw new Error(`Upstash HSET lỗi mã ${hsetRes.status}`);
        }
      }

      // Thực thi lệnh HDEL cho các mục đặt về "auto"
      if (hdelArgs.length > 0) {
        const hdelRes = await fetch(redisUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${redisToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(['HDEL', REDIS_HASH_KEY, ...hdelArgs]),
        });

        if (!hdelRes.ok) {
          throw new Error(`Upstash HDEL lỗi mã ${hdelRes.status}`);
        }
      }

      res.status(200).json({
        ok: true,
        updated: hsetArgs.length / 2,
        deleted: hdelArgs.length,
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
