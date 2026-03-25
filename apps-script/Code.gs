/**
 * Game Planner — Sheets JSON API
 * 綁定試算表：擴充功能 → Apps Script → 使用同一個 Google 試算表檔案（容器綁定）最簡單。
 * 若用獨立專案，請改 SPREADSHEET_ID。
 */
/** 容器綁定同一試算表時可改為 ''，改以 getActiveSpreadsheet() 讀取。 */
var SPREADSHEET_ID = '1FPIZbRaKGvbiFKwacDNTUh5BHQkvS3O5EJaDCcYgYMM';
var CACHE_SECONDS = 600; // 10 分鐘（需求 5–10 分鐘）

var SHEETS = {
  /** fusedHeaders：第 1 列若為「season 賽季」這類「欄位鍵 + 空白 + 說明」，只取第一段的 season（與 gviz header 一致） */
  matches: { dataStartRow: 3, skipLabelRow: true, fusedHeaders: true },
  leagues: { dataStartRow: 3, skipLabelRow: true },
  venues: { dataStartRow: 3, skipLabelRow: true },
  teams: { dataStartRow: 3, skipLabelRow: true },
  players: { dataStartRow: 3, skipLabelRow: true },
  player_team_relations: { dataStartRow: 3, skipLabelRow: true },
  matches_pending: { dataStartRow: 3, skipLabelRow: true },
  places: { dataStartRow: 3, skipLabelRow: true, fusedHeaders: true },
  /** id + label 對照（第 1 列鍵、第 2 列說明、第 3 列起資料） */
  sports: { dataStartRow: 3, skipLabelRow: true, fusedHeaders: true },
  place_types: { dataStartRow: 3, skipLabelRow: true, fusedHeaders: true }
};

function doGet(e) {
  e = e || { parameter: {} };
  var resource = (e.parameter.resource || e.parameter.r || 'help').toLowerCase();
  var callback = e.parameter.callback || e.parameter.cb;

  try {
    var payload = route_(resource, e.parameter);
    return outputJson_(payload, callback);
  } catch (err) {
    return outputJson_({ ok: false, error: String(err && err.message ? err.message : err) }, callback);
  }
}

function route_(resource, params) {
  switch (resource) {
    case 'matches':
      return { ok: true, resource: 'matches', data: getMatchesEnriched_() };
    case 'leagues':
      return { ok: true, resource: 'leagues', data: cachedRead_('leagues', function () { return readSheetObjects_('leagues'); }) };
    case 'venues':
      return { ok: true, resource: 'venues', data: cachedRead_('venues', function () { return readSheetObjects_('venues'); }) };
    case 'places':
      return { ok: true, resource: 'places', data: getPlacesEnriched_() };
    case 'sports':
      return {
        ok: true,
        resource: 'sports',
        data: cachedRead_('sports', function () {
          return readSheetObjects_('sports');
        })
      };
    case 'place_types':
      return {
        ok: true,
        resource: 'place_types',
        data: cachedRead_('place_types', function () {
          return readSheetObjects_('place_types');
        })
      };
    case 'teams':
      return { ok: true, resource: 'teams', data: cachedRead_('teams', function () { return readSheetObjects_('teams'); }) };
    case 'players':
      return { ok: true, resource: 'players', data: cachedRead_('players', function () { return readSheetObjects_('players'); }) };
    case 'relations':
    case 'player_team_relations':
      return { ok: true, resource: 'player_team_relations', data: cachedRead_('ptr', function () { return readSheetObjects_('player_team_relations'); }) };
    case 'matches_pending':
      return { ok: true, resource: 'matches_pending', data: cachedRead_('pending', function () { return readSheetObjects_('matches_pending'); }) };
    case 'help':
    default:
      return {
        ok: true,
        resource: 'help',
        usage:
          '加在網址後：?resource=matches | leagues | venues | places | sports | place_types | teams | players | relations | matches_pending',
        note:
          'GET 可搭配 JSONP（callback）。POST 至同一網址可投稿：預設為賽事待審；submit_target=places 為景點（map_url 會換算座標）。',
        postFields:
          '賽事待審：欄名依試算表第 1 列；常用 sport, league_name, home_team_name, away_team_name, venue_name, date, time, live_url（選填）, submitter, note；id／created_at／source 可留空。景點：submit_target=places 與 name, type, city, map_url（必填）, description, submitter（選填）；id／created_at／source 可留空。',
        cacheSeconds: CACHE_SECONDS
      };
  }
}

/**
 * 投稿：預設寫入 matches_pending；參數 submit_target=places 時寫入 places（map_url 換算經緯度）。
 * 部署 Web App 後需重新發布新版本才會生效。表單 POST 或 JSON body 皆可（JSON 須 Content-Type: application/json）。
 */
function doPost(e) {
  e = e || {};
  try {
    var params = parsePostParams_(e);
    var target = String(params.submit_target || 'matches_pending').trim();
    if (target === 'places') {
      validatePlaceSubmitParams_(params);
      appendPlaceRow_(params);
      CacheService.getScriptCache().remove('gp:places_enriched');
      return htmlMessage_(
        '景點已新增',
        escapeHtml_('已成功儲存，地圖連結已換算為座標。可關閉此頁。'),
        true
      );
    }
    validatePendingParams_(params);
    appendPendingRow_(params);
    CacheService.getScriptCache().remove('gp:pending');
    return htmlMessage_(
      '投稿已收到',
      escapeHtml_('我們已收到你的資料，審核通過後會出現在賽事清單。可關閉此頁。'),
      true
    );
  } catch (err) {
    var msg = String(err && err.message ? err.message : err);
    return htmlMessage_('送出失敗', escapeHtml_(msg), false);
  }
}

function parsePostParams_(e) {
  var params = {};
  if (e.postData && e.postData.contents) {
    var type = String(e.postData.type || '').toLowerCase();
    if (type.indexOf('application/json') >= 0) {
      var raw = String(e.postData.contents).trim();
      if (!raw) {
        return params;
      }
      var obj = JSON.parse(raw);
      for (var k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          params[String(k).trim()] = obj[k];
        }
      }
      return params;
    }
  }
  var p = e.parameter || {};
  for (var key in p) {
    if (Object.prototype.hasOwnProperty.call(p, key)) {
      params[String(key).trim()] = p[key];
    }
  }
  return params;
}

function validatePendingParams_(params) {
  if (params.website && String(params.website).trim() !== '') {
    throw new Error('拒絕送出');
  }
  var required = ['sport', 'home_team_name', 'away_team_name', 'venue_name', 'date', 'time'];
  for (var i = 0; i < required.length; i++) {
    var r = required[i];
    var v = params[r];
    if (v === undefined || v === null || String(v).trim() === '') {
      throw new Error('缺少必填欄位：' + r);
    }
  }
}

function validatePlaceSubmitParams_(params) {
  if (params.website && String(params.website).trim() !== '') {
    throw new Error('拒絕送出');
  }
  var required = ['name', 'type', 'city', 'map_url'];
  for (var i = 0; i < required.length; i++) {
    var r = required[i];
    var v = params[r];
    if (v === undefined || v === null || String(v).trim() === '') {
      throw new Error('缺少必填欄位：' + r);
    }
  }
}

function appendPlaceRow_(params) {
  var mapUrl = String(params.map_url || '').trim();
  var parsed = extractLatLngFromMapUrl_(mapUrl);
  if (!parsed) {
    throw new Error('無法從地圖連結解析經緯度，請改用 Google 地圖「分享」連結（需能對應到座標或地點）。');
  }

  var merged = {};
  for (var pk in params) {
    if (!Object.prototype.hasOwnProperty.call(params, pk)) {
      continue;
    }
    var key = String(pk).trim();
    if (key === 'submit_target' || key === 'website') {
      continue;
    }
    merged[key] = params[pk];
  }
  merged.lat = parsed.lat;
  merged.lng = parsed.lng;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = getSpreadsheet_().getSheetByName('places');
    if (!sh) {
      throw new Error('找不到分頁 places');
    }
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var numCols = headers.length;
    var row = [];
    for (var c = 0; c < numCols; c++) {
      var h = String(headers[c] || '').trim();
      if (!h) {
        row.push('');
        continue;
      }
      if (h === 'lat') {
        row.push(parsed.lat);
        continue;
      }
      if (h === 'lng') {
        row.push(parsed.lng);
        continue;
      }
      var val = merged[h];
      if (val === undefined || val === null) {
        val = '';
      }
      row.push(sanitizeCell_(val));
    }

    var idCol = findHeaderIndex_(headers, 'id');
    if (idCol >= 0 && (!row[idCol] || String(row[idCol]).trim() === '')) {
      var tz = Session.getScriptTimeZone() || 'Asia/Taipei';
      row[idCol] =
        'PL' +
        Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss') +
        '-' +
        Math.random()
          .toString(36)
          .slice(2, 6);
    }

    var createdCol = findHeaderIndex_(headers, 'created_at');
    if (createdCol >= 0 && (!row[createdCol] || String(row[createdCol]).trim() === '')) {
      row[createdCol] = new Date().toISOString();
    }

    var sourceCol = findHeaderIndex_(headers, 'source');
    if (sourceCol >= 0 && (!row[sourceCol] || String(row[sourceCol]).trim() === '')) {
      row[sourceCol] = 'web';
    }

    var lastRow = Math.max(sh.getLastRow(), 1);
    sh.getRange(lastRow + 1, 1, 1, numCols).setValues([row]);
  } finally {
    lock.releaseLock();
  }
}

function appendPendingRow_(params) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = getSpreadsheet_().getSheetByName('matches_pending');
    if (!sh) {
      throw new Error('找不到分頁 matches_pending');
    }
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var numCols = headers.length;
    var row = [];
    for (var c = 0; c < numCols; c++) {
      var h = String(headers[c] || '').trim();
      if (!h) {
        row.push('');
        continue;
      }
      var val = params[h];
      if (val === undefined || val === null) {
        val = '';
      }
      row.push(sanitizeCell_(val));
    }

    var idCol = findHeaderIndex_(headers, 'id');
    if (idCol >= 0 && (!row[idCol] || String(row[idCol]).trim() === '')) {
      var tz = Session.getScriptTimeZone() || 'Asia/Taipei';
      row[idCol] =
        'P' +
        Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss') +
        '-' +
        Math.random()
          .toString(36)
          .slice(2, 6);
    }

    var createdCol = findHeaderIndex_(headers, 'created_at');
    if (createdCol >= 0 && (!row[createdCol] || String(row[createdCol]).trim() === '')) {
      row[createdCol] = new Date().toISOString();
    }

    var sourceCol = findHeaderIndex_(headers, 'source');
    if (sourceCol >= 0 && (!row[sourceCol] || String(row[sourceCol]).trim() === '')) {
      row[sourceCol] = 'web';
    }

    var lastRow = Math.max(sh.getLastRow(), 2);
    sh.getRange(lastRow + 1, 1, 1, numCols).setValues([row]);
  } finally {
    lock.releaseLock();
  }
}

function findHeaderIndex_(headers, name) {
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === name) {
      return i;
    }
  }
  return -1;
}

function sanitizeCell_(v) {
  var s = String(v == null ? '' : v).trim();
  if (s.length > 2000) {
    s = s.substring(0, 2000);
  }
  return s;
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlMessage_(title, bodyHtml, ok) {
  var color = ok ? '#1a7f4c' : '#b00020';
  var html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' +
    escapeHtml_(title) +
    '</title></head><body style="font-family:sans-serif;padding:1.5rem;max-width:28rem;margin:auto;color:#222">' +
    '<h1 style="color:' +
    color +
    ';font-size:1.25rem">' +
    escapeHtml_(title) +
    '</h1><p style="line-height:1.5">' +
    bodyHtml +
    '</p></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 賽季欄位：以 season 為準；試算表若打成 seasom 或整格欄名亦相容 */
function matchSeasonFromRow_(m) {
  if (!m) {
    return '';
  }
  var keys = ['season', 'seasom', 'season 賽季', 'seasom 賽季', '賽季'];
  for (var i = 0; i < keys.length; i++) {
    var v = m[keys[i]];
    if (v != null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return '';
}

/** 試算表第 1 列標題可能為 live、Live、live 轉播、live-url 等，取第一詞並正規化後比對 */
function normMatchSheetHeaderKeyPart_(headerCell) {
  var s = String(headerCell).trim().replace(/^\uFEFF/, '');
  var space = s.indexOf(' ');
  if (space > 0) {
    s = s.substring(0, space);
  }
  return String(s).toLowerCase().replace(/-/g, '_');
}

function pickMatchRowFieldByHeader_(row, canonicalKey) {
  var want = String(canonicalKey).toLowerCase().replace(/-/g, '_');
  for (var k in row) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) {
      continue;
    }
    if (normMatchSheetHeaderKeyPart_(k) === want) {
      var v = row[k];
      if (v == null || v === '') {
        return '';
      }
      return String(v).trim();
    }
  }
  return '';
}

/** 儲存格為 =HYPERLINK("https://...","文字") 時，getDisplayValues 有時只回文字；若拿到公式字串則抽出網址 */
function extractUrlFromHyperlinkFormula_(s) {
  var t = String(s || '').trim();
  if (!/^=hyperlink/i.test(t)) {
    return '';
  }
  var m = /^=HYPERLINK\s*\(\s*"([^"]+)"/i.exec(t);
  if (m) {
    return m[1].trim();
  }
  m = /^=HYPERLINK\s*\(\s*'([^']+)'/i.exec(t);
  if (m) {
    return m[1].trim();
  }
  return '';
}

function matchLiveFieldsFromRow_(m) {
  var live = pickMatchRowFieldByHeader_(m, 'live');
  var liveUrl = pickMatchRowFieldByHeader_(m, 'live_url');
  if (!liveUrl) {
    liveUrl = pickMatchRowFieldByHeader_(m, 'liveurl');
  }
  var urlFromFormula = extractUrlFromHyperlinkFormula_(liveUrl);
  if (urlFromFormula) {
    liveUrl = urlFromFormula;
  }
  if (!live && m.live != null && String(m.live).trim() !== '') {
    live = String(m.live).trim();
  }
  if (!liveUrl && m.live_url != null && String(m.live_url).trim() !== '') {
    var rawU = String(m.live_url).trim();
    liveUrl = extractUrlFromHyperlinkFormula_(rawU) || rawU;
  }
  return { live: live, live_url: liveUrl };
}

/** 依對照表 id → label；無則回傳 id 字串 */
function displayLabelFromLookup_(mapById, idVal) {
  if (idVal === '' || idVal == null) {
    return '';
  }
  var sid = String(idVal).trim();
  var row = mapById[sid] || {};
  var lab = row.label;
  if (lab != null && String(lab).trim() !== '') {
    return String(lab).trim();
  }
  return sid;
}

function getPlacesEnriched_() {
  return cachedRead_('places_enriched', function () {
    var places = readSheetObjects_('places');
    var typesMap = {};
    try {
      typesMap = indexById_(readSheetObjects_('place_types'), 'id');
    } catch (err) {
      typesMap = {};
    }
    return places.map(function (p) {
      var tid = p.type != null ? String(p.type).trim() : '';
      var typeLabel = displayLabelFromLookup_(typesMap, tid);
      return Object.assign({}, p, { type_label: typeLabel });
    });
  });
}

function getMatchesEnriched_() {
  return cachedRead_('matches_enriched_v2', function () {
    var matches = readSheetObjects_('matches');
    var leagues = indexById_(readSheetObjects_('leagues'), 'id');
    var teams = indexById_(readSheetObjects_('teams'), 'id');
    var venues = indexById_(readSheetObjects_('venues'), 'id');
    var sportsMap = {};
    try {
      sportsMap = indexById_(readSheetObjects_('sports'), 'id');
    } catch (err) {
      sportsMap = {};
    }

    return matches.map(function (m) {
      var league = leagues[m.league_id] || {};
      var home = teams[m.home_team_id] || {};
      var away = teams[m.away_team_id] || {};
      var v = venues[m.venue_id] || {};
      var homeName = home.name || m.home_team_id || '';
      var awayName = away.name || m.away_team_id || '';
      var sportId = m.sport != null ? String(m.sport).trim() : '';
      var sportLabel = displayLabelFromLookup_(sportsMap, sportId);
      var tv = matchLiveFieldsFromRow_(m);
      return {
        id: m.id,
        sport: m.sport,
        sport_label: sportLabel,
        league_id: m.league_id,
        league_name: league.name || '',
        season: matchSeasonFromRow_(m),
        home_team_id: m.home_team_id,
        away_team_id: m.away_team_id,
        venue_id: m.venue_id,
        start_time: formatSheetDatetimeForJson_(m.start_time),
        original_time: formatSheetDatetimeForJson_(m.original_time),
        status: m.status,
        verification: m.verification,
        last_updated: formatSheetDatetimeForJson_(m.last_updated),
        source: m.source,
        note: m.note,
        live: tv.live,
        live_url: tv.live_url,
        home_team_name: homeName,
        away_team_name: awayName,
        venue_name: v.name || '',
        venue_city: v.city || '',
        title: (homeName && awayName) ? (homeName + ' vs ' + awayName) : (m.note || m.id || '')
      };
    });
  });
}

function cachedRead_(key, fn) {
  var cache = CacheService.getScriptCache();
  var ckey = 'gp:' + key;
  var hit = cache.get(ckey);
  if (hit) {
    try {
      return JSON.parse(hit);
    } catch (e) {
      // fall through
    }
  }
  var data = fn();
  cache.put(ckey, JSON.stringify(data), CACHE_SECONDS);
  return data;
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** 與試算表儲存格顯示一致之 yyyy-MM-dd HH:mm:ss，供 JSON 給前端（避免 Date ISO 與使用者時區解讀落差） */
function formatSheetDatetimeForJson_(v) {
  if (v === '' || v == null) {
    return '';
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) {
      return '';
    }
    var tz = getSpreadsheet_().getSpreadsheetTimeZone();
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
  }
  return String(v);
}

function cellHasValue_(v) {
  if (v === null || v === undefined) {
    return false;
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return !isNaN(v.getTime());
  }
  return String(v).trim() !== '';
}

/** id 為空時，若列上仍有賽事欄位，仍視為一筆資料（試算表常漏填 id） */
function rowHasMatchLikeData_(obj) {
  return (
    cellHasValue_(obj.sport) ||
    cellHasValue_(obj.venue_id) ||
    cellHasValue_(obj.start_time) ||
    cellHasValue_(obj.home_team_id) ||
    cellHasValue_(obj.away_team_id)
  );
}

function rowHasPendingLikeData_(obj) {
  return (
    cellHasValue_(obj.sport) ||
    cellHasValue_(obj.venue_name) ||
    cellHasValue_(obj.home_team_name) ||
    cellHasValue_(obj.away_team_name) ||
    cellHasValue_(obj.date) ||
    cellHasValue_(obj.time)
  );
}

function readSheetObjects_(sheetName) {
  var cfg = SHEETS[sheetName];
  if (!cfg) {
    throw new Error('Unknown sheet config: ' + sheetName);
  }
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    throw new Error('找不到分頁：' + sheetName);
  }
  var range = sh.getDataRange();
  var values = range.getValues();
  if (!values.length) {
    return [];
  }
  var headers = values[0].map(function (h) {
    return cfg.fusedHeaders ? normalizeFusedHeader_(h) : String(h).trim();
  });
  var start = cfg.dataStartRow - 1;
  var out = [];
  for (var r = start; r < values.length; r++) {
    var row = values[r];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = headers[c];
      if (!key) {
        continue;
      }
      var cell = row[c];
      obj[key] = cell === '' || cell === null ? '' : cell;
    }
    var sheetRow1 = r + 1;
    var idVal = obj.id != null && obj.id !== '' ? String(obj.id).trim() : '';
    if (!idVal) {
      if (sheetName === 'matches' && rowHasMatchLikeData_(obj)) {
        obj.id = 'AUTO_R' + sheetRow1;
        idVal = obj.id;
      } else if (sheetName === 'matches_pending' && rowHasPendingLikeData_(obj)) {
        obj.id = 'PEND_R' + sheetRow1;
        idVal = obj.id;
      }
    }
    if (idVal) {
      out.push(obj);
    }
  }
  return out;
}

function normalizeFusedHeader_(cell) {
  var s = String(cell).trim();
  var space = s.indexOf(' ');
  if (space > 0) {
    return s.substring(0, space).trim();
  }
  return s;
}

function indexById_(rows, idKey) {
  var map = {};
  idKey = idKey || 'id';
  for (var i = 0; i < rows.length; i++) {
    var id = rows[i][idKey];
    if (id !== '' && id != null) {
      map[String(id)] = rows[i];
    }
  }
  return map;
}

function outputJson_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    var safe = String(callback).replace(/[^\w$.]/g, '');
    if (!safe) {
      safe = 'callback';
    }
    return ContentService.createTextOutput(safe + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ====== 地圖座標工具（map_url -> lat/lng）======
 * Apps Script 執行下拉可直接執行：
 * - fillVenuesLatLngFromMapUrl()
 * - fillPlacesLatLngFromMapUrl()
 * - fillAllLatLngFromMapUrl()
 */
function fillVenuesLatLngFromMapUrl() {
  return fillLatLngFromMapUrlBySheet_('venues');
}

function fillPlacesLatLngFromMapUrl() {
  return fillLatLngFromMapUrlBySheet_('places');
}

function fillAllLatLngFromMapUrl() {
  return {
    ok: true,
    venues: fillVenuesLatLngFromMapUrl(),
    places: fillPlacesLatLngFromMapUrl()
  };
}

function fillLatLngFromMapUrlBySheet_(sheetName) {
  var cfg = SHEETS[sheetName];
  if (!cfg) {
    throw new Error('Unknown sheet config: ' + sheetName);
  }
  var sh = getSpreadsheet_().getSheetByName(sheetName);
  if (!sh) {
    throw new Error('找不到分頁：' + sheetName);
  }
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    return { ok: true, sheet: sheetName, scanned: 0, updated: 0, failed: 0 };
  }

  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });
  var mapUrlCol = findHeaderIndex_(headers, 'map_url');
  var latCol = findHeaderIndex_(headers, 'lat');
  var lngCol = findHeaderIndex_(headers, 'lng');
  if (mapUrlCol < 0 || latCol < 0 || lngCol < 0) {
    throw new Error(
      '分頁 ' +
        sheetName +
        ' 缺少必要欄位（需要 map_url / lat / lng），目前欄位：' +
        headers.join(', ')
    );
  }

  var startRow = (cfg.dataStartRow || 2);
  if (lastRow < startRow) {
    return { ok: true, sheet: sheetName, scanned: 0, updated: 0, failed: 0 };
  }

  var rowCount = lastRow - startRow + 1;
  var values = sh.getRange(startRow, 1, rowCount, lastCol).getValues();
  // map_url 欄可能是「超連結文字」：getValues() 只會拿到顯示文字，需用 RichText 取真正 URL
  var mapRich = sh.getRange(startRow, mapUrlCol + 1, rowCount, 1).getRichTextValues();
  var scanned = 0;
  var updated = 0;
  var failed = 0;
  var failRows = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var mapUrl = String(row[mapUrlCol] || '').trim();
    if (!/^https?:\/\//i.test(mapUrl)) {
      var rich = mapRich[i] && mapRich[i][0] ? mapRich[i][0] : null;
      if (rich && rich.getLinkUrl()) {
        mapUrl = String(rich.getLinkUrl() || '').trim();
      }
    }
    if (!mapUrl) {
      continue;
    }
    scanned++;

    var latVal = String(row[latCol] || '').trim();
    var lngVal = String(row[lngCol] || '').trim();
    if (latVal && lngVal) {
      continue; // 已有座標，不覆寫
    }

    var parsed = extractLatLngFromMapUrl_(mapUrl);
    if (!parsed) {
      failed++;
      failRows.push(startRow + i);
      continue;
    }

    sh.getRange(startRow + i, latCol + 1).setValue(parsed.lat);
    sh.getRange(startRow + i, lngCol + 1).setValue(parsed.lng);
    updated++;
  }

  var result = {
    ok: true,
    sheet: sheetName,
    scanned: scanned,
    updated: updated,
    failed: failed,
    failedRows: failRows
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function extractLatLngFromMapUrl_(rawUrl) {
  var url = normalizeMapUrl_(rawUrl);
  if (!url) {
    return null;
  }

  // 1) 先直接從原始 URL 抓
  var direct = parseLatLngFromText_(url);
  if (direct) {
    return direct;
  }

  // 2) maps.app.goo.gl / goo.gl/maps：嘗試展開 redirect
  var expanded = resolveRedirectUrl_(url, 6);
  if (expanded) {
    var fromExpanded = parseLatLngFromText_(expanded);
    if (fromExpanded) {
      return fromExpanded;
    }
  }

  // 3) 嘗試抓頁面內容（有些短網址頁會內嵌真正 maps 連結）
  try {
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    var html = String(resp.getContentText() || '');
    // 某些回應會把最終 URL 放在 window/location 或 canonical 裡
    var hintedUrl = extractEmbeddedGoogleMapsUrl_(html);
    if (hintedUrl) {
      var fromHinted = parseLatLngFromText_(hintedUrl);
      if (fromHinted) {
        return fromHinted;
      }
      var hintedExpanded = resolveRedirectUrl_(hintedUrl, 3);
      var fromHintedExpanded = parseLatLngFromText_(hintedExpanded);
      if (fromHintedExpanded) {
        return fromHintedExpanded;
      }
    }
    var embeddedUrl = hintedUrl;
    if (embeddedUrl) {
      var fromEmbeddedUrl = parseLatLngFromText_(embeddedUrl);
      if (fromEmbeddedUrl) {
        return fromEmbeddedUrl;
      }
    }
    var fromHtml = parseLatLngFromText_(html);
    if (fromHtml) {
      return fromHtml;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function resolveRedirectUrl_(url, maxHops) {
  var cur = String(url || '').trim();
  var hops = Math.max(0, maxHops || 0);
  for (var i = 0; i < hops; i++) {
    try {
      var resp = UrlFetchApp.fetch(cur, {
        muteHttpExceptions: true,
        followRedirects: false,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      var code = resp.getResponseCode();
      if (code < 300 || code >= 400) {
        return cur;
      }
      var headers = resp.getAllHeaders();
      var location = headers.Location || headers.location;
      if (Object.prototype.toString.call(location) === '[object Array]') {
        location = location.length ? location[0] : '';
      }
      if (!location) {
        return cur;
      }
      cur = toAbsoluteUrl_(cur, String(location));
    } catch (e) {
      return cur;
    }
  }
  return cur;
}

function toAbsoluteUrl_(baseUrl, nextUrl) {
  if (/^https?:\/\//i.test(nextUrl)) {
    return nextUrl;
  }
  var m = String(baseUrl).match(/^(https?:\/\/[^/]+)/i);
  if (!m) {
    return nextUrl;
  }
  if (nextUrl.indexOf('/') === 0) {
    return m[1] + nextUrl;
  }
  return m[1] + '/' + nextUrl;
}

function extractEmbeddedGoogleMapsUrl_(html) {
  if (!html) {
    return '';
  }
  var s = String(html);
  // 先抓常見的 maps 長網址
  var m = s.match(/https:\/\/www\.google\.com\/maps\/[^"'\\s<]+/i);
  if (m && m[0]) {
    return decodeHtmlEntities_(m[0]);
  }
  // 次選：短網址字串本身若被包在 HTML
  m = s.match(/https:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9_-]+/i);
  if (m && m[0]) {
    return decodeHtmlEntities_(m[0]);
  }
  return '';
}

function decodeHtmlEntities_(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/\\u003d/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/%3D/gi, '=')
    .replace(/%26/gi, '&');
}

function normalizeMapUrl_(raw) {
  var s = String(raw || '');
  // 去除前後空白、全形空白、零寬字元與中間誤插入空白
  s = s
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u3000/g, ' ')
    .trim()
    .replace(/\s+/g, '');
  // 常見貼上情境：末尾夾雜中文標點
  s = s.replace(/[，。；、]+$/g, '');
  return s;
}

function parseLatLngFromText_(text) {
  if (!text) {
    return null;
  }
  var s = String(text);
  var m;

  // 優先地標 pin：...!3d25.0496413!4d121.5517379...
  m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) {
    return normalizeLatLng_(m[1], m[2]);
  }
  // 有些連結順序相反：!4d{lng}!3d{lat}
  m = s.match(/!4d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/);
  if (m) {
    return normalizeLatLng_(m[2], m[1]);
  }

  // 視角：.../@25.0496413,121.549163,17z...
  m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|%2C)/);
  if (m) {
    return normalizeLatLng_(m[1], m[2]);
  }

  // query/q：...?query=25.033,121.564 或 ?q=...
  m = s.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) {
    return normalizeLatLng_(m[1], m[2]);
  }

  // URL encode 情境（%2C）
  m = s.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?)%2C(-?\d+(?:\.\d+)?)/i);
  if (m) {
    return normalizeLatLng_(m[1], m[2]);
  }

  return null;
}

function normalizeLatLng_(latRaw, lngRaw) {
  var lat = parseFloat(latRaw);
  var lng = parseFloat(lngRaw);
  if (isNaN(lat) || isNaN(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat: lat, lng: lng };
}
