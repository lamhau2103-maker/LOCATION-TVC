import { detectFarmCategory, detectFarmStatus } from '../config';
import { Farm, ParseResult } from '../types';

/**
 * Tạo ID ổn định từ tên và toạ độ trang trại để khi tự động đồng bộ từ Google My Maps
 * có thể nhận biết chính xác điểm nào mới thêm, điểm nào bị xoá hoặc điểm nào giữ nguyên.
 */
export function buildStableFarmId(
  prefix: string,
  name: string,
  lat: number,
  lng: number,
  index: number
): string {
  const slug = name
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^a-z0-9\u00C0-\u1EF9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `${prefix}-${slug || index}-${lat.toFixed(4)}-${lng.toFixed(4)}`;
}

/**
 * Trích xuất URL hình ảnh đầu tiên từ chuỗi HTML description hoặc gx_media_links của Google My Maps
 */
export function extractImageUrl(rawHtml: string): string | undefined {
  if (!rawHtml) return undefined;
  const imgMatch = rawHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && imgMatch[1]) {
    return imgMatch[1].trim();
  }
  const urlMatch = rawHtml.match(
    /(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>]*)?)/i
  );
  return urlMatch ? urlMatch[1].trim() : undefined;
}

/**
 * Làm sạch chuỗi CDATA / HTML trong thẻ <description> của Google My Maps KML
 * nhưng giữ nguyên cấu trúc xuống dòng dễ đọc.
 */
export function cleanHtmlDescription(rawHtml: string): string {
  if (!rawHtml) return '';

  const withLineBreaks = rawHtml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n');

  if (typeof window !== 'undefined' && 'DOMParser' in window) {
    const doc = new DOMParser().parseFromString(withLineBreaks, 'text/html');
    const text = doc.body.textContent || '';
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }

  return withLineBreaks.replace(/<[^>]+>/g, '').trim();
}

/**
 * PARSER KML (Google My Maps) BẰNG DOMParser
 */
export function parseKMLContent(
  kmlText: string,
  fileName = 'Google My Maps.kml'
): ParseResult {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(kmlText, 'text/xml');

  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    throw new Error(
      'File KML không hợp lệ hoặc bị lỗi cấu trúc XML. Vui lòng kiểm tra lại file xuất từ Google My Maps.'
    );
  }

  const placemarks = Array.from(xmlDoc.getElementsByTagName('Placemark'));
  if (placemarks.length === 0) {
    throw new Error('Không tìm thấy thẻ <Placemark> nào trong dữ liệu KML này.');
  }

  const farms: Farm[] = [];
  let skippedCount = 0;
  const warnings: string[] = [];

  placemarks.forEach((pm, index) => {
    const pointEl = pm.getElementsByTagName('Point')[0];
    if (!pointEl) {
      skippedCount++;
      return;
    }

    const coordEl = pointEl.getElementsByTagName('coordinates')[0];
    if (!coordEl || !coordEl.textContent) {
      skippedCount++;
      return;
    }

    const coordText = coordEl.textContent.trim().split(/\s+/)[0];
    const parts = coordText.split(',').map((s) => parseFloat(s.trim()));
    if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
      skippedCount++;
      return;
    }

    const lng = parts[0];
    const lat = parts[1];

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      skippedCount++;
      return;
    }

    const nameEl = Array.from(pm.children).find(
      (el) => el.tagName.toLowerCase() === 'name'
    );
    const name = nameEl?.textContent?.trim() || `Trang trại #${index + 1}`;

    let folderType = '';
    let parent = pm.parentElement;
    while (parent) {
      if (parent.tagName.toLowerCase() === 'folder') {
        const folderNameEl = Array.from(parent.children).find(
          (el) => el.tagName.toLowerCase() === 'name'
        );
        if (folderNameEl?.textContent) {
          folderType = folderNameEl.textContent.trim();
        }
        break;
      }
      parent = parent.parentElement;
    }

    const extendedData: Record<string, string> = {};
    let mediaImageUrl: string | undefined;

    const extEl = pm.getElementsByTagName('ExtendedData')[0];
    if (extEl) {
      const dataEls = Array.from(extEl.getElementsByTagName('Data'));
      dataEls.forEach((d) => {
        const key = d.getAttribute('name')?.trim();
        const valEl = d.getElementsByTagName('value')[0];
        const val = valEl?.textContent?.trim() || d.textContent?.trim() || '';
        if (!key || !val) return;

        if (
          key.toLowerCase() === 'gx_media_links' ||
          key.toLowerCase() === 'image' ||
          key.toLowerCase() === 'ảnh' ||
          key.toLowerCase() === 'hình ảnh'
        ) {
          const firstUrl = val.split(/\s+/)[0];
          if (firstUrl && firstUrl.startsWith('http')) {
            mediaImageUrl = firstUrl;
          }
          return;
        }
        extendedData[key] = cleanHtmlDescription(val);
      });

      const simpleDataEls = Array.from(
        extEl.getElementsByTagName('SimpleData')
      );
      simpleDataEls.forEach((sd) => {
        const key = sd.getAttribute('name')?.trim();
        const val = sd.textContent?.trim() || '';
        if (key && val) {
          extendedData[key] = cleanHtmlDescription(val);
        }
      });
    }

    const extTypeKey = Object.keys(extendedData).find((k) =>
      ['type', 'loại', 'loai', 'nhóm', 'nhom', 'category'].includes(
        k.toLowerCase()
      )
    );
    const rawType =
      folderType ||
      (extTypeKey ? extendedData[extTypeKey] : '') ||
      'Trang trại';

    const descEl = Array.from(pm.children).find(
      (el) => el.tagName.toLowerCase() === 'description'
    );
    const rawDesc = descEl?.textContent || '';
    if (!mediaImageUrl) {
      mediaImageUrl = extractImageUrl(rawDesc);
    }
    const cleanedDesc = cleanHtmlDescription(rawDesc);

    const category = detectFarmCategory(rawType, name);
    const statusText = `${cleanedDesc} ${JSON.stringify(extendedData)}`;
    const status = detectFarmStatus(statusText);

    let displayType = rawType;
    if (rawType === 'Trang trại') {
      if (category === 'chicken') displayType = 'Trại gà';
      else if (category === 'pig') displayType = 'Trại heo';
      else displayType = 'Khác';
    }

    farms.push({
      id: buildStableFarmId('kml', name, lat, lng, index),
      name,
      type: displayType,
      category,
      status,
      lat,
      lng,
      description:
        cleanedDesc ||
        `Trang trại thuộc phân khu "${displayType}" được đồng bộ từ Google My Maps.`,
      imageUrl: mediaImageUrl,
      extendedData:
        Object.keys(extendedData).length > 0 ? extendedData : undefined,
    });
  });

  if (farms.length === 0) {
    throw new Error(
      skippedCount > 0
        ? `Dữ liệu KML có ${skippedCount} đối tượng hình học (vùng/đường) nhưng không có toạ độ điểm (<Point>) nào.`
        : 'Không đọc được toạ độ trang trại nào từ file KML.'
    );
  }

  if (skippedCount > 0) {
    warnings.push(
      `Đã bỏ qua ${skippedCount} đối tượng không phải dạng Điểm (LineString/Polygon).`
    );
  }

  return {
    farms,
    skippedCount,
    sourceName: fileName,
    warnings,
  };
}

function parseCSVRows(csvText: string): string[][] {
  const cleaned = csvText.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return [];

  const firstLine = cleaned.split(/\r?\n/)[0] || '';
  let delimiter = ',';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  if (semiCount > commaCount && semiCount >= tabCount) delimiter = ';';
  else if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const nextChar = cleaned[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * PARSER CSV (Hỗ trợ tự nhận diện cột tiếng Việt và tiếng Anh)
 */
export function parseCSVContent(
  csvText: string,
  fileName = 'farms.csv'
): ParseResult {
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) {
    throw new Error(
      'File CSV phải có ít nhất 1 dòng tiêu đề cột và 1 dòng dữ liệu trang trại.'
    );
  }

  const headers = rows[0].map((h) => h.trim());
  const normalizedHeaders = headers.map((h) =>
    h.toLowerCase().normalize('NFC')
  );

  const findColIndex = (candidates: string[]) =>
    normalizedHeaders.findIndex((h) =>
      candidates.some((c) => h === c || h.includes(c))
    );

  const nameIdx = findColIndex([
    'name',
    'tên',
    'ten',
    'trang trại',
    'trang trai',
    'title',
  ]);
  const latIdx = findColIndex(['lat', 'latitude', 'vĩ độ', 'vi do', 'vĩ']);
  const lngIdx = findColIndex([
    'lng',
    'lon',
    'long',
    'longitude',
    'kinh độ',
    'kinh do',
    'kinh',
  ]);
  const typeIdx = findColIndex([
    'type',
    'loại',
    'loai',
    'nhóm',
    'nhom',
    'category',
    'layer',
    'folder',
  ]);
  const descIdx = findColIndex([
    'description',
    'desc',
    'mô tả',
    'mo ta',
    'ghi chú',
    'ghi chu',
    'note',
  ]);
  const imgIdx = findColIndex([
    'image',
    'img',
    'photo',
    'ảnh',
    'hình ảnh',
    'hinh anh',
  ]);

  if (latIdx === -1 || lngIdx === -1) {
    throw new Error(
      'Không tìm thấy cột Toạ độ trong file CSV. Vui lòng đặt tên cột là "lat, lng" hoặc "vĩ độ, kinh độ".'
    );
  }

  const farms: Farm[] = [];
  let skippedCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const latRaw = (row[latIdx] || '').replace(',', '.');
    const lngRaw = (row[lngIdx] || '').replace(',', '.');
    const lat = parseFloat(latRaw);
    const lng = parseFloat(lngRaw);

    if (
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      skippedCount++;
      continue;
    }

    const name =
      (nameIdx !== -1 ? row[nameIdx] : '') || `Trang trại CSV #${i}`;
    const rawType = (typeIdx !== -1 ? row[typeIdx] : '') || 'Trang trại';
    const description =
      (descIdx !== -1 ? row[descIdx] : '') ||
      `Trang trại chăn nuôi được nạp từ bảng dữ liệu CSV (${fileName}).`;
    const imageUrl =
      imgIdx !== -1 && row[imgIdx]?.startsWith('http')
        ? row[imgIdx]
        : undefined;

    const extendedData: Record<string, string> = {};
    headers.forEach((headerName, colIdx) => {
      if (
        colIdx !== nameIdx &&
        colIdx !== latIdx &&
        colIdx !== lngIdx &&
        colIdx !== typeIdx &&
        colIdx !== descIdx &&
        colIdx !== imgIdx &&
        row[colIdx]
      ) {
        extendedData[headerName] = row[colIdx];
      }
    });

    const category = detectFarmCategory(rawType, name);
    const status = detectFarmStatus(
      `${description} ${JSON.stringify(extendedData)}`
    );

    let displayType = rawType;
    if (rawType === 'Trang trại') {
      if (category === 'chicken') displayType = 'Trại gà';
      else if (category === 'pig') displayType = 'Trại heo';
      else displayType = 'Khác';
    }

    farms.push({
      id: buildStableFarmId('csv', name, lat, lng, i),
      name,
      type: displayType,
      category,
      status,
      lat,
      lng,
      description,
      imageUrl,
      extendedData:
        Object.keys(extendedData).length > 0 ? extendedData : undefined,
    });
  }

  if (farms.length === 0) {
    throw new Error(
      'Không có dòng dữ liệu nào trong file CSV có toạ độ vĩ độ / kinh độ hợp lệ.'
    );
  }

  return {
    farms,
    skippedCount,
    sourceName: fileName,
    warnings:
      skippedCount > 0
        ? [`Đã bỏ qua ${skippedCount} dòng thiếu toạ độ hoặc sai định dạng số.`]
        : [],
  };
}

/**
 * PARSER GEOJSON / JSON
 */
export function parseGeoJSONContent(
  jsonText: string,
  fileName = 'farms.geojson'
): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('File JSON/GeoJSON không đúng cú pháp JSON hợp lệ.');
  }

  const farms: Farm[] = [];
  let skippedCount = 0;

  if (Array.isArray(parsed)) {
    parsed.forEach((item, idx) => {
      const lat = parseFloat(item.lat ?? item.latitude ?? item['vĩ độ']);
      const lng = parseFloat(
        item.lng ?? item.lon ?? item.longitude ?? item['kinh độ']
      );
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        skippedCount++;
        return;
      }
      const name = item.name || item.ten || `Trang trại #${idx + 1}`;
      const rawType = item.type || item.loai || 'Trang trại';
      const category = item.category || detectFarmCategory(rawType, name);
      const status =
        item.status || detectFarmStatus(item.description || '');

      farms.push({
        id: item.id || buildStableFarmId('json', name, lat, lng, idx),
        name,
        type: rawType,
        category,
        status,
        lat,
        lng,
        description:
          item.description || 'Trang trại được nạp từ dữ liệu JSON.',
        imageUrl: item.imageUrl || item.image,
        extendedData: item.extendedData,
      });
    });
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    'features' in parsed &&
    Array.isArray((parsed as { features: unknown[] }).features)
  ) {
    const features = (
      parsed as {
        features: Array<{
          geometry?: { type?: string; coordinates?: number[] };
          properties?: Record<string, unknown>;
        }>;
      }
    ).features;

    features.forEach((feat, idx) => {
      if (
        !feat.geometry ||
        feat.geometry.type !== 'Point' ||
        !Array.isArray(feat.geometry.coordinates)
      ) {
        skippedCount++;
        return;
      }

      const [lng, lat] = feat.geometry.coordinates;
      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        Number.isNaN(lat) ||
        Number.isNaN(lng)
      ) {
        skippedCount++;
        return;
      }

      const props = feat.properties || {};
      const name = String(
        props.name || props.Name || props.ten || `Trang trại #${idx + 1}`
      );
      const rawType = String(
        props.type || props.Type || props.folder || props.layer || 'Trang trại'
      );
      const rawDesc = String(
        props.description || props.Description || props.mo_ta || ''
      );
      const imageUrl =
        typeof props.image === 'string'
          ? props.image
          : extractImageUrl(rawDesc);
      const cleanedDesc = cleanHtmlDescription(rawDesc);

      const extendedData: Record<string, string> = {};
      Object.entries(props).forEach(([k, v]) => {
        if (
          ![
            'name',
            'Name',
            'type',
            'Type',
            'description',
            'Description',
            'image',
          ].includes(k) &&
          v !== null &&
          v !== undefined &&
          String(v).trim() !== ''
        ) {
          extendedData[k] = String(v);
        }
      });

      const category = detectFarmCategory(rawType, name);
      const status = detectFarmStatus(
        `${cleanedDesc} ${JSON.stringify(extendedData)}`
      );

      farms.push({
        id: buildStableFarmId('geojson', name, lat, lng, idx),
        name,
        type: rawType,
        category,
        status,
        lat,
        lng,
        description:
          cleanedDesc || 'Trang trại đồng bộ từ tệp bản đồ GeoJSON.',
        imageUrl,
        extendedData:
          Object.keys(extendedData).length > 0 ? extendedData : undefined,
      });
    });
  } else {
    throw new Error(
      'Cấu trúc JSON không được hỗ trợ. Vui lòng dùng chuẩn GeoJSON FeatureCollection hoặc mảng trang trại.'
    );
  }

  if (farms.length === 0) {
    throw new Error('Không tìm thấy điểm toạ độ trang trại nào trong file.');
  }

  return {
    farms,
    skippedCount,
    sourceName: fileName,
    warnings:
      skippedCount > 0
        ? [`Đã bỏ qua ${skippedCount} đối tượng không phải toạ độ Điểm.`]
        : [],
  };
}

export async function parseFarmFile(file: File): Promise<ParseResult> {
  const text = await file.text();
  const lowerName = file.name.toLowerCase();

  if (
    lowerName.endsWith('.kml') ||
    text.trim().startsWith('<?xml') ||
    text.includes('<kml')
  ) {
    return parseKMLContent(text, file.name);
  }

  if (
    lowerName.endsWith('.geojson') ||
    lowerName.endsWith('.json') ||
    text.trim().startsWith('{') ||
    text.trim().startsWith('[')
  ) {
    return parseGeoJSONContent(text, file.name);
  }

  if (lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
    return parseCSVContent(text, file.name);
  }

  throw new Error(
    `Định dạng file "${file.name}" chưa được hỗ trợ. Vui lòng chọn file .kml (Google My Maps), .csv hoặc .geojson.`
  );
}

/**
 * Tạo nội dung file KML mẫu chuẩn Google My Maps (có nhiều Folder layer & ExtendedData)
 */
export function generateSampleKML(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Bản Đồ Hệ Thống Trang Trại Chăn Nuôi BioSphere (Google My Maps)</name>
    <Folder>
      <name>Trại gà công nghệ cao</name>
      <Placemark>
        <name>Trại Gà Giống Công Nghệ Cao Long Khánh</name>
        <description><![CDATA[Tổ hợp chuồng lạnh tự động hóa 100%.<br/>Áp dụng hệ thống khử khuẩn tia cực tím và cảm biến NH3 thời gian thực.]]></description>
        <ExtendedData>
          <Data name="Quy mô đàn"><value>180.000 con</value></Data>
          <Data name="Chỉ số ATSH"><value>99/100</value></Data>
          <Data name="Quản lý"><value>KS. Vũ Đình Trọng</value></Data>
        </ExtendedData>
        <Point>
          <coordinates>107.2428,10.9452,0</coordinates>
        </Point>
      </Placemark>
      <Placemark>
        <name>Trại Gà Đẻ Trứng Tự Động Trảng Bom</name>
        <description><![CDATA[Chuyên cung cấp trứng gà sạch đóng hộp đạt chuẩn xuất khẩu.<br/>Hệ thống thu gom trứng tự động bằng robot quang học.]]></description>
        <ExtendedData>
          <Data name="Quy mô đàn"><value>250.000 con</value></Data>
          <Data name="Sản lượng"><value>210.000 quả/ngày</value></Data>
        </ExtendedData>
        <Point>
          <coordinates>107.0185,10.9582,0</coordinates>
        </Point>
      </Placemark>
      <Placemark>
        <name>Trại Gà Thịt Hữu Cơ Cẩm Mỹ</name>
        <description><![CDATA[Khu chăn nuôi gà thảo mộc an toàn sinh học cao.<br/>Đang trong đợt kiểm tra định kỳ hàng quý (Cảnh báo nhẹ).]]></description>
        <ExtendedData>
          <Data name="Quy mô đàn"><value>130.000 con</value></Data>
          <Data name="Trạng thái"><value>Cảnh báo kiểm tra định kỳ</value></Data>
        </ExtendedData>
        <Point>
          <coordinates>107.2451,10.7894,0</coordinates>
        </Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>Trại heo giống &amp; thương phẩm</name>
      <Placemark>
        <name>Trại Heo Nái Hạt Nhân Tân Uyên</name>
        <description><![CDATA[Trung tâm giống heo cụ kỵ GGP nhập khẩu trực tiếp.<br/>Vành đai cách ly sinh học 3 lớp nghiêm ngặt.]]></description>
        <ExtendedData>
          <Data name="Quy mô đàn"><value>18.000 heo nái</value></Data>
          <Data name="Công nghệ"><value>Cho ăn lỏng chip RFID</value></Data>
        </ExtendedData>
        <Point>
          <coordinates>106.8012,11.0845,0</coordinates>
        </Point>
      </Placemark>
      <Placemark>
        <name>Tổ Hợp Heo Thương Phẩm Đồng Phú</name>
        <description><![CDATA[Trang trại heo thịt quy mô lớn kết nối chuỗi lạnh khép kín.<br/>Tích hợp hầm Biogas phát điện 1.5MW.]]></description>
        <ExtendedData>
          <Data name="Quy mô đàn"><value>45.000 con</value></Data>
          <Data name="Năng lượng sạch"><value>1.5 MW Biogas</value></Data>
        </ExtendedData>
        <Point>
          <coordinates>106.9125,11.4512,0</coordinates>
        </Point>
      </Placemark>
      <Placemark>
        <name>Trại Heo Hậu Bị Xuyên Mộc</name>
        <description><![CDATA[Khu nuôi heo hậu bị cách ly ven biển, thoáng khí tự nhiên.<br/>Đang kích hoạt chế độ cách ly dự phòng 14 ngày.]]></description>
        <ExtendedData>
          <Data name="Quy mô đàn"><value>12.500 con</value></Data>
          <Data name="Trạng thái"><value>Đang cách ly dự phòng</value></Data>
        </ExtendedData>
        <Point>
          <coordinates>107.4562,10.5812,0</coordinates>
        </Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>Khác (Bò sữa &amp; Trung tâm Nghiên cứu)</name>
      <Placemark>
        <name>Trang Trại Bò Sữa Cao Nguyên Đơn Dương</name>
        <description><![CDATA[Đàn bò sữa A2 thuần chủng chăn nuôi trên đồng cỏ hữu cơ Lâm Đồng.<br/>Hệ thống vắt sữa xoay tròn tự động 80 vị trí.]]></description>
        <ExtendedData>
          <Data name="Quy mô đàn"><value>9.200 bò sữa</value></Data>
          <Data name="Độ cao"><value>1.020 m</value></Data>
        </ExtendedData>
        <Point>
          <coordinates>108.4812,11.8124,0</coordinates>
        </Point>
      </Placemark>
      <Placemark>
        <name>Trung Tâm Thủy Cầm Sinh Thái Hồ Trị An</name>
        <description><![CDATA[Khu bảo tồn và nhân giống vịt giống an toàn sinh học khép kín trên bán đảo.]]></description>
        <ExtendedData>
          <Data name="Quy mô đàn"><value>65.000 con</value></Data>
          <Data name="Môi trường"><value>Bán đảo sinh thái khép kín</value></Data>
        </ExtendedData>
        <Point>
          <coordinates>107.1456,11.1582,0</coordinates>
        </Point>
      </Placemark>
    </Folder>
  </Document>
</kml>`;
}
