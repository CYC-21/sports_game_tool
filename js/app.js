import { API_BASE } from './config.js';
import {
  fetchResource,
  loadVenues,
  loadPlaces,
  loadTeams,
  loadLeagues,
  loadSports,
  loadPlaceTypes,
  loadMatchesPreferComplete
} from './api.js';
import { enrichPlacesWithTypeLabels, getMatchBroadcastFields } from './enrich.js';
import { matchStatusMeta } from './status.js';

var expectingPendingResponse = false;
var lastSubmittedFormId = null;
var placesSubmitTypeOutsideCloseBound = false;

var state = {
  mode: 'location',
  city: '',
  sport: '',
  leagueId: '',
  venueId: '',
  teamQuery: '',
  filterYear: '',
  filterMonth: '',
  filterSeason: '',
  filterStatus: 'future',
  matches: [],
  venues: [],
  places: [],
  teams: [],
  leagues: [],
  sports: [],
  placeTypes: [],
  matchDataSource: '',
  loading: true,
  error: null,
  userPos: null,
  geoError: null
};

function $(sel) {
  return document.querySelector(sel);
}

function uniqNonEmptyStrings_(arr) {
  var seen = {};
  var out = [];
  (arr || []).forEach(function (x) {
    if (x == null) {
      return;
    }
    // 去除「完全空白」而已；其餘大小寫／空白／符號皆視為不同字串
    var raw = String(x);
    if (!raw.trim()) {
      return;
    }
    if (seen[raw]) {
      return;
    }
    seen[raw] = true;
    out.push(raw);
  });
  return out;
}

/** Google Material Symbols（ligature 名稱須與 index.html icon_names 一致） */
function msIcon(name, extraClass) {
  var cls = 'material-symbols-outlined';
  if (extraClass) {
    cls += ' ' + extraClass;
  }
  return '<span class="' + cls + '" aria-hidden="true">' + name + '</span>';
}

/** 依 places.type 粗估對應 Material Symbol（未命中則 place） */
function placeTypeToMaterialIcon(typeRaw) {
  var raw = String(typeRaw || '').trim();
  if (!raw) {
    return 'place';
  }
  var t = raw.toLowerCase();

  // place_types 代碼優先（對外固定）
  if (t === 'food' || t === '餐飲') {
    return 'restaurant';
  }
  if (t === 'cafe' || t === '咖啡') {
    return 'local_cafe';
  }
  if (t === 'sightseeing' || t === '景點') {
    return 'photo_camera';
  }
  if (t === 'bar' || t === '酒吧') {
    return 'local_bar';
  }
  if (t === 'shopping' || t === '購物') {
    return 'store_mall_directory';
  }
  if (t === 'store' || t === '便利超商') {
    // 目前 icon_names 未含 storefront，先用商場圖示代表
    return 'store_mall_directory';
  }
  if (t === 'hike' || t === '登山') {
    return 'hiking';
  }
  if (t === 'swim' || t === '海邊') {
    return 'beach_access';
  }
  if (t === 'sports' || t === '其他運動場館') {
    return 'stadium';
  }
  if (t === 'movie' || t === '電影院') {
    // 目前 icon_names 未含 movie，先用景點/相機圖示代表
    return 'photo_camera';
  }

  if (/restaurant|dining|food|eatery|bistro/.test(t)) {
    return 'restaurant';
  }
  if (/cafe|coffee|bakery|tearoom|tea_shop/.test(t)) {
    return 'local_cafe';
  }
  if (/hotel|hostel|bnb|motel|lodg/.test(t)) {
    return 'hotel';
  }
  if (/\bpark\b|garden|green_space/.test(t)) {
    return 'park';
  }
  if (/museum|gallery|exhibit/.test(t)) {
    return 'museum';
  }
  if (/mall|shopping|retail|boutique|department_store/.test(t)) {
    return 'store_mall_directory';
  }
  if (/bar|pub|brewery|nightclub|winery/.test(t)) {
    return 'local_bar';
  }
  if (/station|transit|metro|subway|mrt|\btrain\b|\bbus\b|high_speed_rail/.test(t)) {
    return 'train';
  }
  if (/beach|coast|seaside|shore/.test(t)) {
    return 'beach_access';
  }
  if (/hike|trail|trek|nature|forest|camp/.test(t)) {
    return 'hiking';
  }
  if (/temple|shrine|church|mosque|cathedral|worship/.test(t)) {
    return 'temple_buddhist';
  }
  if (/landmark|monument|scenic|viewpoint|tower|attraction/.test(t)) {
    return 'photo_camera';
  }

  if (/餐廳|美食|小吃|餐飲|拉麵|火鍋|夜市/.test(raw)) {
    return 'restaurant';
  }
  if (/咖啡|甜點|麵包|茶館|下午茶|手搖/.test(raw)) {
    return 'local_cafe';
  }
  if (/飯店|旅館|酒店|民宿|商旅|青旅|汽車旅館/.test(raw)) {
    return 'hotel';
  }
  if (/公園|綠地|廣場|花園/.test(raw)) {
    return 'park';
  }
  if (/博物館|美術館|展覽|紀念館|科博館|Gallery/i.test(raw)) {
    return 'museum';
  }
  if (/購物|商場|百貨|專櫃|市集|商圈|Outlet/i.test(raw)) {
    return 'store_mall_directory';
  }
  if (/酒吧|夜店|餐酒|調酒/.test(raw)) {
    return 'local_bar';
  }
  if (/車站|捷運|火車|高鐵|客運|轉運|地鐵|輕軌/.test(raw)) {
    return 'train';
  }
  if (/海灘|沙灘|海岸|海景/.test(raw)) {
    return 'beach_access';
  }
  if (/步道|登山|健行|郊山|百岳|森林遊樂|National Park/i.test(raw)) {
    return 'hiking';
  }
  if (/廟|寺|教堂|清真寺/.test(raw)) {
    return 'temple_buddhist';
  }
  if (/景點|地標|打卡|觀景/.test(raw)) {
    return 'photo_camera';
  }

  return 'place';
}

/** 僅類型圖示（不含文字）；類型名放在 title / aria-label 供提示與無障礙 */
function placeTypeIconHtml(typeRaw, displayLabel) {
  var has = typeRaw && String(typeRaw).trim();
  var label =
    displayLabel != null && String(displayLabel).trim() !== ''
      ? String(displayLabel).trim()
      : has
      ? String(typeRaw).trim()
      : '未分類';
  var iconName = placeTypeToMaterialIcon(displayLabel || typeRaw);
  var safeLabel = escapeHtml(label);
  return (
    '<span class="place-type-icon-wrap" title="' +
    safeLabel +
    '" aria-label="' +
    safeLabel +
    '">' +
    msIcon(iconName, 'place-type-icon') +
    '</span>'
  );
}

function displaySportLabel(m) {
  if (!m) {
    return '';
  }
  var lab = m.sport_label != null ? String(m.sport_label).trim() : '';
  if (lab) {
    return lab;
  }
  if (m.sport != null && String(m.sport).trim() !== '') {
    return sportLabelById(String(m.sport).trim());
  }
  return '';
}

function sportLabelById(sportId) {
  var sid = sportId != null ? String(sportId).trim() : '';
  if (!sid) {
    return '';
  }
  var hit = (state.sports || []).filter(function (r) {
    return String(r.id) === sid;
  })[0];
  if (hit && hit.label != null && String(hit.label).trim() !== '') {
    return String(hit.label).trim();
  }
  return sid;
}

function placeTypeLabelById(typeId) {
  var tid = typeId != null ? String(typeId).trim() : '';
  if (!tid) {
    return '';
  }
  var hit = (state.placeTypes || []).filter(function (r) {
    return String(r.id) === tid;
  })[0];
  if (hit && hit.label != null && String(hit.label).trim() !== '') {
    return String(hit.label).trim();
  }
  return tid;
}

function displayPlaceTypeLabel(p) {
  if (!p) {
    return '';
  }
  var lab = p.type_label != null ? String(p.type_label).trim() : '';
  if (lab) {
    return lab;
  }
  return placeTypeLabelById(p.type);
}

function displayMatchTitle(m) {
  if (m && m.title) {
    return String(m.title);
  }
  if (m && m.home_team_name && m.away_team_name) {
    return String(m.home_team_name) + ' vs ' + String(m.away_team_name);
  }
  return '未命名賽事';
}

function displayVenueName(v, fallbackName) {
  if (v && v.name) {
    return String(v.name);
  }
  if (fallbackName) {
    return String(fallbackName);
  }
  return '未命名場館';
}

function normalizeHttpUrl(url) {
  var s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) {
    return '';
  }
  return s;
}

function normalizePlaceMapUrlForDupWarn_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) {
    return '';
  }
  s = s.replace(/\/+$/, '');
  return s;
}

/** 場館／景點「同城」比對：臺→台、去空白、剝除尾端市／縣（含簡體「县」），例：台北市、台北、台北縣 → 台北 */
function normalizeCityKeyForVenuePlaces(raw) {
  if (raw == null) {
    return '';
  }
  var t = String(raw).trim();
  if (!t) {
    return '';
  }
  t = t.replace(/\u81fa/g, '\u53f0');
  t = t.replace(/\s+/g, '');
  while (t.length > 0) {
    var c = t.charAt(t.length - 1);
    if (c === '\u5e02' || c === '\u7e23' || c === '\u53bf') {
      t = t.slice(0, -1);
      continue;
    }
    break;
  }
  return t;
}

/**
 * 場館與景點「模糊同城」：雙方 city 正規化後皆非空且相同。
 * 與「直線距離 ≤ VENUE_NEARBY_PLACES_MAX_KM」為 OR 並行（聯集），互不取代。
 */
function venuePlaceSameCityNormalized(venueCity, placeCity) {
  var vk = normalizeCityKeyForVenuePlaces(venueCity);
  var pk = normalizeCityKeyForVenuePlaces(placeCity);
  return vk !== '' && pk !== '' && pk === vk;
}

var VENUE_NEARBY_PLACES_MAX_KM = 20;

function venueLatLng(v) {
  if (!v) {
    return null;
  }
  return latLngFromRow_(v.lat, v.lng);
}

function venueMapOpenUrl(v) {
  var direct = normalizeHttpUrl(v && v.map_url);
  if (direct) {
    return direct;
  }
  var ll = venueLatLng(v);
  if (ll) {
    return (
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(ll.lat + ',' + ll.lng)
    );
  }
  var q = [v && v.name, v && v.city, v && v.country]
    .filter(function (x) {
      return x && String(x).trim() !== '';
    })
    .join(' ');
  if (q) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }
  return '';
}

function venueMapEmbedUrl(v) {
  var ll = venueLatLng(v);
  if (ll) {
    return 'https://www.google.com/maps?q=' + encodeURIComponent(ll.lat + ',' + ll.lng) + '&z=16&output=embed';
  }
  var q = [v && v.name, v && v.city, v && v.country]
    .filter(function (x) {
      return x && String(x).trim() !== '';
    })
    .join(' ');
  if (q) {
    return 'https://www.google.com/maps?q=' + encodeURIComponent(q) + '&z=16&output=embed';
  }
  return '';
}

function leagueNameById(id) {
  if (id == null || id === '') {
    return '';
  }
  var target = String(id);
  var hit = (state.leagues || []).filter(function (l) {
    return String(l.id || '') === target;
  })[0];
  return hit && hit.name ? String(hit.name) : '';
}

function displayLeagueName(m) {
  if (m && m.league_name) {
    return String(m.league_name);
  }
  var byId = leagueNameById(m && m.league_id);
  if (byId) {
    return byId;
  }
  return '未提供';
}

function parseHash() {
  var h = (location.hash || '#/').replace(/^#/, '') || '/';
  var parts = h.split('/').filter(Boolean);
  return { parts: parts };
}

function setHash(path) {
  location.hash = path.startsWith('#') ? path : '#' + path;
}

function venueById(id) {
  var v = state.venues.filter(function (x) {
    return String(x.id) === String(id);
  })[0];
  return v || null;
}

/**
 * 解析賽事時間：ISO、試算表 yyyy-MM-dd HH:mm:ss、gviz 字串 Date(y,m,d,h,mi,s)（月為 0-based，與 JS 一致）
 */
function parseMatchDatetime(raw) {
  if (raw == null || raw === '') {
    return null;
  }
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    return isNaN(raw.getTime()) ? null : raw;
  }
  var s = String(raw).trim();
  if (!s) {
    return null;
  }
  var md = s.match(/^Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)$/);
  if (md) {
    var dGviz = new Date(
      parseInt(md[1], 10),
      parseInt(md[2], 10),
      parseInt(md[3], 10),
      parseInt(md[4], 10),
      parseInt(md[5], 10),
      parseInt(md[6], 10)
    );
    return isNaN(dGviz.getTime()) ? null : dGviz;
  }
  var m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (m) {
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10) - 1;
    var day = parseInt(m[3], 10);
    var hh = m[4] != null ? parseInt(m[4], 10) : 0;
    var mi = m[5] != null ? parseInt(m[5], 10) : 0;
    var sec = m[6] != null ? parseInt(m[6], 10) : 0;
    var dLocal = new Date(y, mo, day, hh, mi, sec);
    return isNaN(dLocal.getTime()) ? null : dLocal;
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** 開賽時間由近到遠（早的在前）；無有效時間者排在最後 */
function compareMatchStartTime(a, b) {
  var ta = matchEffectiveInstant(a);
  var tb = matchEffectiveInstant(b);
  var na = ta && !isNaN(ta.getTime()) ? ta.getTime() : Number.POSITIVE_INFINITY;
  var nb = tb && !isNaN(tb.getTime()) ? tb.getTime() : Number.POSITIVE_INFINITY;
  if (na !== nb) {
    return na - nb;
  }
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function formatTime(iso) {
  if (!iso) {
    return '—';
  }
  var d = parseMatchDatetime(iso);
  if (!d) {
    return String(iso);
  }
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  var hh = String(d.getHours()).padStart(2, '0');
  var mi = String(d.getMinutes()).padStart(2, '0');
  return mm + '/' + dd + ' ' + hh + ':' + mi;
}

function formatDay(iso) {
  if (!iso) {
    return '—';
  }
  var d = parseMatchDatetime(iso);
  if (!d) {
    return String(iso);
  }
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  var w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return mm + '/' + dd + '（' + w + '）';
}

/** 賽事 start_time 對應的本機日曆日，轉成可比較整數 YYYYMMDD；無效則 null */
function matchLocalYmdNumber(iso) {
  if (!iso) {
    return null;
  }
  var d = parseMatchDatetime(iso);
  if (!d) {
    return null;
  }
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function todayLocalYmdNumber() {
  var d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** 開賽日是否已早於「今天」（本機日曆）；僅供是否為已結束賽事之參考 */
function inferPastMatchDate(m) {
  var ymd = matchLocalYmdNumber(m.start_time);
  if (ymd == null) {
    return false;
  }
  return ymd < todayLocalYmdNumber();
}

function isCancelledStatus(m) {
  var s = String(m.status || '').trim().toLowerCase();
  return s === 'cancelled' || s === 'canceled';
}

function isPostponedStatus(m) {
  return String(m.status || '').trim().toLowerCase() === 'postponed';
}

/**
 * 牌卡外觀：延期／取消／未確認優先；其次日期已過且狀態為空或 scheduled 視為已結束；
 * 試算表若填其他 status 文字則保留為狀態說明（不強制已結束）。completed／finished／final 亦顯示已結束樣式.
 */
function matchCardPresentation(m) {
  var raw = String(m.status || '').trim();
  var s = raw.toLowerCase();
  if (s === 'postponed') {
    return {
      modifier: 'match-card--postponed',
      meta: matchStatusMeta(m.status)
    };
  }
  if (s === 'cancelled' || s === 'canceled') {
    return {
      modifier: 'match-card--cancelled',
      meta: matchStatusMeta(m.status)
    };
  }
  if (s === 'tentative' || s === 'unconfirmed') {
    return {
      modifier: 'match-card--tentative',
      meta: matchStatusMeta(m.status)
    };
  }
  if (s === 'completed' || s === 'finished' || s === 'final') {
    return {
      modifier: 'match-card--ended',
      meta: {
        label: '已結束',
        dotClass: 'dot-ended',
        rowClass: 'status-ended'
      }
    };
  }
  if (inferPastMatchDate(m) && (!raw || s === 'scheduled')) {
    return {
      modifier: 'match-card--ended',
      meta: {
        label: '已結束',
        dotClass: 'dot-ended',
        rowClass: 'status-ended'
      }
    };
  }
  if (raw && s !== 'scheduled') {
    return {
      modifier: 'match-card--scheduled',
      meta: {
        label: raw,
        dotClass: 'dot-status-note',
        rowClass: 'status-note'
      }
    };
  }
  return {
    modifier: 'match-card--scheduled',
    meta: matchStatusMeta(m.status)
  };
}

/** 版型示意：中央 MMDD / 時間分欄 */
function splitMatchDisplayTime(iso) {
  if (!iso) {
    return { date: '—', time: '' };
  }
  var d = parseMatchDatetime(iso);
  if (!d) {
    return { date: String(iso), time: '' };
  }
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  var hh = String(d.getHours()).padStart(2, '0');
  var mi = String(d.getMinutes()).padStart(2, '0');
  return { date: mm + '/' + dd, time: hh + ':' + mi };
}

/** 延期且「新開賽時間尚未確認」（與 matchEffectiveInstant 擇時邏輯一致） */
function isPostponedTimeUndetermined(m) {
  if (!isPostponedStatus(m)) {
    return false;
  }
  var st = parseMatchDatetime(m.start_time);
  var stEmpty = !m.start_time || !String(m.start_time).trim();
  var stInvalid = !st;
  if (stEmpty || stInvalid) {
    return true;
  }
  if (/時間待定|日期待定|開賽未定|延期未定|改期未定|tbd/i.test(String(m.note || ''))) {
    return true;
  }
  var parts = splitMatchDisplayTime(m.start_time);
  if (!parts.time) {
    return true;
  }
  return false;
}

/**
 * 排序／時間軸分組／年月篩選：非延期＝start_time；
 * 延期且新時間未定時用 original_time；延期且已確認新時間用 start_time。
 */
function matchEffectiveInstant(m) {
  var s = String(m.status || '').trim().toLowerCase();
  var st = parseMatchDatetime(m.start_time);
  var ot = parseMatchDatetime(m.original_time);
  if (s !== 'postponed') {
    return st || ot || null;
  }
  if (ot && isPostponedTimeUndetermined(m)) {
    return ot;
  }
  return st || ot || null;
}

/**
 * 狀態篩選：未來／過往／延期（僅未定新時間）／取消（見 renderYearMonthSeasonStatusFilters 選項文案）
 */
function matchPassesStatusFilterKey(m, key) {
  if (!key || !String(key).trim()) {
    return true;
  }
  if (key === 'cancelled') {
    return isCancelledStatus(m);
  }
  if (key === 'postponed') {
    return isPostponedTimeUndetermined(m);
  }
  if (key === 'past') {
    return (
      !isCancelledStatus(m) &&
      !isPostponedTimeUndetermined(m) &&
      inferPastMatchDate(m)
    );
  }
  if (key === 'future') {
    return (
      !isCancelledStatus(m) &&
      (isPostponedTimeUndetermined(m) || !inferPastMatchDate(m))
    );
  }
  return true;
}

/** 與 enrich／Code.gs 一致：season 欄或試算表打成 seasom 皆可 */
function matchSeasonValue(m) {
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

function matchPassesYmSeasonStatus(m) {
  var yf = state.filterYear && String(state.filterYear).trim();
  var mf = state.filterMonth && String(state.filterMonth).trim();
  if (yf || mf) {
    var d = matchEffectiveInstant(m);
    if (!d || isNaN(d.getTime())) {
      return false;
    }
    if (yf && d.getFullYear() !== parseInt(yf, 10)) {
      return false;
    }
    if (mf && d.getMonth() + 1 !== parseInt(mf, 10)) {
      return false;
    }
  }
  var se = state.filterSeason && String(state.filterSeason).trim();
  if (se && matchSeasonValue(m) !== se) {
    return false;
  }
  return matchPassesStatusFilterKey(m, state.filterStatus);
}

/** 卡片隊名用：區分全形（漢字・假名・全形英數等）與半形（ASCII 等） */
function matchCardCharScriptClass(ch) {
  var cp = ch.codePointAt(0);
  if (cp >= 0xff65 && cp <= 0xff9f) {
    return 'half';
  }
  if (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0x31f0 && cp <= 0x31ff) ||
    (cp >= 0x3000 && cp <= 0x303f) ||
    (cp >= 0xff01 && cp <= 0xff5e) ||
    cp === 0xffe5 ||
    cp === 0xffe6
  ) {
    return 'full';
  }
  return 'half';
}

/**
 * 全形／半形並存且全形 ≥4、半形 ≥2 時，拆成兩行（例：「臺北熊讚 Play One」→ 臺北熊讚 / Play One）。
 * @returns {{ full: string, half: string }|null}
 */
function buildMatchCardStackedTeamName(raw) {
  var s = raw == null ? '' : String(raw);
  if (!String(s).trim()) {
    return null;
  }
  var fullCount = 0;
  var halfCount = 0;
  var ch;
  for (ch of s) {
    if (matchCardCharScriptClass(ch) === 'full') {
      fullCount++;
    } else {
      halfCount++;
    }
  }
  if (!(fullCount >= 4 && halfCount >= 2)) {
    return null;
  }
  var runs = [];
  var curType = null;
  var buf = '';
  for (ch of s) {
    var t = matchCardCharScriptClass(ch);
    if (curType === null) {
      curType = t;
      buf = ch;
    } else if (t === curType) {
      buf += ch;
    } else {
      runs.push({ type: curType, text: buf });
      curType = t;
      buf = ch;
    }
  }
  if (buf) {
    runs.push({ type: curType, text: buf });
  }
  var fullParts = [];
  var halfParts = [];
  for (var r = 0; r < runs.length; r++) {
    if (runs[r].type === 'full') {
      fullParts.push(runs[r].text);
    } else {
      halfParts.push(runs[r].text);
    }
  }
  var fullLine = fullParts.join('');
  var halfLine = halfParts
    .map(function (p) {
      return p.replace(/\s+/g, ' ').trim();
    })
    .filter(function (p) {
      return p.length;
    })
    .join(' ')
    .trim();
  if (!fullLine || !halfLine) {
    return null;
  }
  return { full: fullLine, half: halfLine };
}

function matchCardTeamNameHtml(raw) {
  var stacked = buildMatchCardStackedTeamName(raw);
  if (!stacked) {
    return escapeHtml(raw == null ? '' : String(raw));
  }
  return (
    '<span class="match-card__name match-card__name--stacked">' +
    '<span class="match-card__name-line match-card__name-line--full">' +
    escapeHtml(stacked.full) +
    '</span>' +
    '<span class="match-card__name-line match-card__name-line--half">' +
    escapeHtml(stacked.half) +
    '</span></span>'
  );
}

function matchCardCenterHtml(m, meta) {
  var iso =
    meta.rowClass === 'status-postponed'
      ? m.original_time || m.start_time
      : m.start_time;
  var parts = splitMatchDisplayTime(iso);
  if (meta.rowClass === 'status-postponed') {
    return (
      '<div class="match-card__center">' +
      '<span class="match-card__postponed-label">延期</span>' +
      '<span class="match-card__date">' +
      escapeHtml(parts.date) +
      '</span>' +
      (parts.time
        ? '<span class="match-card__time">' + escapeHtml(parts.time) + '</span>'
        : '') +
      '</div>'
    );
  }
  if (meta.rowClass === 'status-ended') {
    return (
      '<div class="match-card__center">' +
      '<span class="match-card__date">' +
      escapeHtml(parts.date) +
      '</span>' +
      (parts.time
        ? '<span class="match-card__time">' + escapeHtml(parts.time) + '</span>'
        : '') +
      '</div>'
    );
  }
  return (
    '<div class="match-card__center">' +
    '<span class="match-card__date">' +
    escapeHtml(parts.date) +
    '</span>' +
    (parts.time
      ? '<span class="match-card__time">' + escapeHtml(parts.time) + '</span>'
      : '<span class="match-card__time match-card__time--tbd">時間待定</span>') +
    '</div>'
  );
}

/**
 * 單場賽事卡片（地點／時間／附近共用）
 * @param {string[]|null} metaExtras — 附在狀態後的純文字片段（會 escape）
 */
function matchCardLiHtml(m, metaExtras) {
  var pres = matchCardPresentation(m);
  var meta = pres.meta;
  var bc = getMatchBroadcastFields(m);
  var hasLive = bc && bc.live_url != null && String(bc.live_url).trim() !== '';
  var leagueLabel = displayLeagueName(m);
  var homeHas = m.home_team_name != null && String(m.home_team_name).trim() !== '';
  var awayHas = m.away_team_name != null && String(m.away_team_name).trim() !== '';
  var homeN = homeHas ? matchCardTeamNameHtml(m.home_team_name) : '';
  var awayN = awayHas ? matchCardTeamNameHtml(m.away_team_name) : '';
  if (!homeN && !awayN) {
    homeN = matchCardTeamNameHtml(displayMatchTitle(m));
    awayN = escapeHtml('—');
  } else {
    if (!homeN) {
      homeN = escapeHtml('—');
    }
    if (!awayN) {
      awayN = escapeHtml('—');
    }
  }
  var extra = '';
  if (metaExtras && metaExtras.length) {
    var joined = metaExtras
      .filter(function (s) {
        return s != null && String(s).trim() !== '';
      })
      .map(function (s) {
        return escapeHtml(String(s));
      })
      .join(' · ');
    if (joined) {
      extra =
        '<span class="match-card__meta-sep" aria-hidden="true"> · </span>' +
        '<span class="match-card__meta-extra">' +
        joined +
        '</span>';
    }
  }
  var leagueHtml =
    leagueLabel && String(leagueLabel).trim() !== ''
      ? '<div class="match-card__league">' + escapeHtml(String(leagueLabel)) + '</div>'
      : '';
  // NOTE: cannot nest <button> inside <a>; use focusable span for corner actions.
  var shareBadgeHtml =
    '<span role="button" tabindex="0" class="match-card__corner-btn match-card__share-indicator" data-match-share="' +
    escapeHtml(String(m.id)) +
    '" aria-label="分享賽事" title="分享賽事">' +
    msIcon('share', 'match-card__share-indicator-icon') +
    '<span class="match-card__share-indicator-text">SHARE</span>' +
    '</span>';
  var liveBadgeHtml = hasLive
    ? '<span role="button" tabindex="0" class="match-card__corner-btn match-card__live-indicator" data-match-live="' +
      escapeHtml(String(m.id)) +
      '" aria-label="開啟直播" title="開啟直播">' +
      msIcon('live_tv', 'match-card__live-indicator-icon') +
      '<span class="match-card__live-indicator-text">LIVE</span>' +
      '</span>'
    : '';
  return (
    '<li class="match-list__item">' +
    '<a class="match-card ' +
    pres.modifier +
    '" href="#/matches/' +
    encodeURIComponent(m.id) +
    '">' +
    shareBadgeHtml +
    liveBadgeHtml +
    leagueHtml +
    '<div class="match-card__grid">' +
    '<div class="match-card__team match-card__team--home">' +
    '<span class="match-card__name">' +
    homeN +
    '</span></div>' +
    matchCardCenterHtml(m, meta) +
    '<div class="match-card__team match-card__team--away">' +
    '<span class="match-card__name">' +
    awayN +
    '</span></div>' +
    '</div>' +
    '<div class="match-card__meta">' +
    '<span class="status-dot ' +
    meta.dotClass +
    '" aria-hidden="true"></span>' +
    '<span class="match-card__status-label">' +
    escapeHtml(meta.label) +
    '</span>' +
    extra +
    '</div></a></li>'
  );
}

/**
 * @param {object} [opts]
 * @param {string} [opts.venueId] — 若指定，僅保留該場館（覆寫首頁的 state.venueId）
 */
function filteredMatches(opts) {
  opts = opts || {};
  var lockVenue =
    Object.prototype.hasOwnProperty.call(opts, 'venueId') && opts.venueId != null
      ? String(opts.venueId)
      : null;
  return state.matches.filter(function (m) {
    if (lockVenue != null) {
      if (String(m.venue_id) !== lockVenue) {
        return false;
      }
    } else if (state.venueId && String(m.venue_id) !== state.venueId) {
      return false;
    }
    if (state.sport && String(m.sport) !== state.sport) {
      return false;
    }
    if (state.leagueId && String(m.league_id || '') !== state.leagueId) {
      return false;
    }
    if (state.city) {
      var v = venueById(m.venue_id);
      var c = v && v.city ? String(v.city) : String(m.venue_city || '');
      if (c !== state.city) {
        return false;
      }
    }
    if (state.teamQuery) {
      var q = state.teamQuery.toLowerCase();
      var t = (m.title || '') + (m.home_team_name || '') + (m.away_team_name || '');
      if (t.toLowerCase().indexOf(q) < 0) {
        return false;
      }
    }
    if (!matchPassesYmSeasonStatus(m)) {
      return false;
    }
    return true;
  });
}

function groupMatchesByVenue(list) {
  var map = {};
  list.forEach(function (m) {
    var vid = m.venue_id || '_unknown';
    if (!map[vid]) {
      map[vid] = [];
    }
    map[vid].push(m);
  });
  Object.keys(map).forEach(function (k) {
    map[k].sort(compareMatchStartTime);
  });
  return map;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var toRad = function (x) {
    return (x * Math.PI) / 180;
  };
  var dLat = toRad(lat2 - lat1);
  var dLon = toRad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** 台灣本島／常用範圍粗判（用於過濾明顯錯誤座標） */
var TW_ROUGH_BOUNDS = { latMin: 21.7, latMax: 26.5, lngMin: 118.2, lngMax: 123.8 };

function pointInRoughTaiwan_(ll) {
  if (!ll) {
    return false;
  }
  return (
    ll.lat >= TW_ROUGH_BOUNDS.latMin &&
    ll.lat <= TW_ROUGH_BOUNDS.latMax &&
    ll.lng >= TW_ROUGH_BOUNDS.lngMin &&
    ll.lng <= TW_ROUGH_BOUNDS.lngMax
  );
}

/**
 * 從試算表 lat/lng 欄位還原 WGS84；修正常見「經緯對調」、忽略 (0,0)。
 */
function latLngFromRow_(latRaw, lngRaw) {
  var a = parseFloat(latRaw);
  var b = parseFloat(lngRaw);
  if (isNaN(a) || isNaN(b)) {
    return null;
  }
  if (Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9) {
    return null;
  }
  if (a >= -90 && a <= 90 && b >= -180 && b <= 180) {
    return { lat: a, lng: b };
  }
  if (b >= -90 && b <= 90 && a >= -180 && a <= 180) {
    return { lat: b, lng: a };
  }
  return null;
}

/**
 * 場館—景點直線距離；若「同城」卻出現離譜公里數（多為欄位錯／海外座標），改為不顯示數字以免誤導。
 */
function placeDistanceKmFromVenue_(venueCity, placeCity, venuePt, placePt) {
  if (!venuePt || !placePt) {
    return null;
  }
  var km = haversineKm(venuePt.lat, venuePt.lng, placePt.lat, placePt.lng);
  if (
    km > 500 &&
    venuePlaceSameCityNormalized(venueCity, placeCity) &&
    pointInRoughTaiwan_(venuePt) &&
    !pointInRoughTaiwan_(placePt)
  ) {
    return null;
  }
  return km;
}

function renderHeaderCities() {
  var sel = $('#city-select');
  if (!sel) {
    return;
  }
  var cities = {};
  state.venues.forEach(function (v) {
    if (v.city) {
      cities[String(v.city)] = true;
    }
  });
  var list = Object.keys(cities).sort();
  var cur = state.city;
  sel.innerHTML =
    '<option value="">全部地區</option>' +
    list
      .map(function (c) {
        return (
          '<option value="' +
          escapeHtml(c) +
          '"' +
          (c === cur ? ' selected' : '') +
          '>' +
          escapeHtml(c) +
          '</option>'
        );
      })
      .join('');
}

function matchesSourceForFilterScope(venueScopeId) {
  if (venueScopeId == null || venueScopeId === '') {
    return state.matches;
  }
  return state.matches.filter(function (m) {
    return String(m.venue_id) === String(venueScopeId);
  });
}

/** 場館頁「賽事」區塊：可收合篩選（與首頁同層級 UI，預設收合） */
function buildVenueMatchFilterBarHtml() {
  return (
    '<div class="filter-panel filter-panel--venue is-collapsed" id="venue-filter-panel">' +
    '<button type="button" class="filter-panel__toggle" id="venue-filter-panel-toggle" aria-expanded="false" aria-controls="venue-filter-panel-body">' +
    '<span class="filter-panel__toggle-label">' +
    '<span class="material-symbols-outlined filter-panel__toggle-icon" aria-hidden="true">tune</span>' +
    '篩選條件' +
    '</span>' +
    '<span class="material-symbols-outlined filter-panel__chevron" aria-hidden="true">expand_more</span>' +
    '</button>' +
    '<div id="venue-filter-panel-body" class="filter-panel__body" role="region" aria-label="場館賽事篩選">' +
    '<div class="filter-bar filter-bar--venue">' +
    '<label class="filter-item">' +
    '<span class="material-symbols-outlined filter-icon" aria-hidden="true">sports_soccer</span>' +
    '<select id="vfilter-sport" aria-label="運動"></select>' +
    '</label>' +
    '<label class="filter-item">' +
    '<span class="material-symbols-outlined filter-icon" aria-hidden="true">emoji_events</span>' +
    '<select id="vfilter-league" aria-label="聯盟"></select>' +
    '</label>' +
    '<label class="filter-item">' +
    '<span class="material-symbols-outlined filter-icon" aria-hidden="true">calendar_month</span>' +
    '<select id="vfilter-year" aria-label="年份"></select>' +
    '</label>' +
    '<label class="filter-item">' +
    '<span class="material-symbols-outlined filter-icon" aria-hidden="true">calendar_view_month</span>' +
    '<select id="vfilter-month" aria-label="月份"></select>' +
    '</label>' +
    '<label class="filter-item">' +
    '<span class="material-symbols-outlined filter-icon" aria-hidden="true">trophy</span>' +
    '<select id="vfilter-season" aria-label="賽季"></select>' +
    '</label>' +
    '<label class="filter-item">' +
    '<span class="material-symbols-outlined filter-icon" aria-hidden="true">hourglass_top</span>' +
    '<select id="vfilter-status" aria-label="狀態"></select>' +
    '</label>' +
    '<label class="filter-item filter-grow">' +
    '<span class="material-symbols-outlined filter-icon" aria-hidden="true">groups</span>' +
    '<input type="search" id="vfilter-team" placeholder="搜尋隊名或標題…" autocomplete="off" aria-label="搜尋隊名" />' +
    '</label>' +
    '</div></div></div>'
  );
}

function syncVenueMatchesList(venueId) {
  var wrap = document.getElementById('venue-matches-content');
  if (!wrap) {
    return;
  }
  var ms = filteredMatches({ venueId: venueId })
    .slice()
    .sort(compareMatchStartTime);
  if (!ms.length) {
    wrap.innerHTML = '<p class="empty">沒有符合篩選的賽事。</p>';
    return;
  }
  wrap.innerHTML =
    '<ul class="match-list">' +
    ms
      .map(function (m) {
        return matchCardLiHtml(m, null);
      })
      .join('') +
    '</ul>';
}

function wireVenuePageMatchFilters(venueId) {
  function onChange() {
    syncVenueMatchesList(venueId);
  }
  var sport = document.getElementById('vfilter-sport');
  if (sport) {
    sport.addEventListener('change', function () {
      state.sport = this.value;
      onChange();
    });
  }
  var league = document.getElementById('vfilter-league');
  if (league) {
    league.addEventListener('change', function () {
      state.leagueId = this.value;
      onChange();
    });
  }
  var fy = document.getElementById('vfilter-year');
  if (fy) {
    fy.addEventListener('change', function () {
      state.filterYear = this.value;
      onChange();
    });
  }
  var fm = document.getElementById('vfilter-month');
  if (fm) {
    fm.addEventListener('change', function () {
      state.filterMonth = this.value;
      onChange();
    });
  }
  var fs = document.getElementById('vfilter-season');
  if (fs) {
    fs.addEventListener('change', function () {
      state.filterSeason = this.value;
      onChange();
    });
  }
  var fst = document.getElementById('vfilter-status');
  if (fst) {
    fst.addEventListener('change', function () {
      state.filterStatus = this.value;
      onChange();
    });
  }
  var team = document.getElementById('vfilter-team');
  if (team) {
    team.addEventListener('input', function () {
      state.teamQuery = this.value.trim();
      onChange();
    });
  }
  var vPanel = document.getElementById('venue-filter-panel');
  var vToggle = document.getElementById('venue-filter-panel-toggle');
  if (vPanel && vToggle) {
    vToggle.addEventListener('click', function () {
      vPanel.classList.toggle('is-collapsed');
      var open = !vPanel.classList.contains('is-collapsed');
      vToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
}

function populateVenuePageMatchFilters(venueId) {
  renderSportFilter('vfilter-sport', venueId);
  renderLeagueFilter('vfilter-league', venueId);
  renderYearMonthSeasonStatusFilters(
    {
      year: 'vfilter-year',
      month: 'vfilter-month',
      season: 'vfilter-season',
      status: 'vfilter-status'
    },
    venueId
  );
  var teamEl = document.getElementById('vfilter-team');
  if (teamEl) {
    teamEl.value = state.teamQuery || '';
  }
}

function renderVenueFilter() {
  var sel = $('#venue-select');
  if (!sel) {
    return;
  }
  var list = state.venues.slice().sort(function (a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  var cur = state.venueId;
  sel.innerHTML =
    '<option value="">全部球場</option>' +
    list
      .map(function (v) {
        var id = String(v.id);
        return (
          '<option value="' +
          escapeHtml(id) +
          '"' +
          (id === cur ? ' selected' : '') +
          '>' +
          escapeHtml(displayVenueName(v)) +
          '</option>'
        );
      })
      .join('');
}

function renderSportFilter(selectId, venueScopeId) {
  var sel = selectId ? document.getElementById(selectId) : $('#sport-select');
  if (!sel) {
    return;
  }
  var sports = {};
  matchesSourceForFilterScope(venueScopeId).forEach(function (m) {
    if (m.sport) {
      sports[String(m.sport)] = true;
    }
  });
  var list = Object.keys(sports).sort();
  var cur = state.sport;
  sel.innerHTML =
    '<option value="">全部運動</option>' +
    list
      .map(function (s) {
        var text = sportLabelById(s);
        return (
          '<option value="' +
          escapeHtml(s) +
          '"' +
          (s === cur ? ' selected' : '') +
          '>' +
          escapeHtml(text) +
          '</option>'
        );
      })
      .join('');
}

function renderYearMonthSeasonStatusFilters(idsOpts, venueScopeId) {
  idsOpts = idsOpts || {};
  var idY = idsOpts.year || 'filter-year';
  var idM = idsOpts.month || 'filter-month';
  var idS = idsOpts.season || 'filter-season';
  var idSt = idsOpts.status || 'filter-status';
  var selY = document.getElementById(idY);
  var selM = document.getElementById(idM);
  var selS = document.getElementById(idS);
  var selSt = document.getElementById(idSt);
  if (!selY || !selM || !selS || !selSt) {
    return;
  }
  var src = matchesSourceForFilterScope(venueScopeId);
  var years = {};
  src.forEach(function (m) {
    var d = matchEffectiveInstant(m);
    if (d && !isNaN(d.getTime())) {
      years[String(d.getFullYear())] = true;
    }
  });
  var yearList = Object.keys(years).sort(function (a, b) {
    return parseInt(b, 10) - parseInt(a, 10);
  });
  var curY = state.filterYear;
  selY.innerHTML =
    '<option value="">全年</option>' +
    yearList
      .map(function (y) {
        return (
          '<option value="' +
          escapeHtml(y) +
          '"' +
          (y === curY ? ' selected' : '') +
          '>' +
          escapeHtml(y) +
          ' 年</option>'
        );
      })
      .join('');

  var curM = state.filterMonth;
  var monthOpts = '<option value="">全月</option>';
  for (var mix = 1; mix <= 12; mix++) {
    var selAttr = String(mix) === String(curM) ? ' selected' : '';
    monthOpts +=
      '<option value="' +
      mix +
      '"' +
      selAttr +
      '>' +
      mix +
      ' 月</option>';
  }
  selM.innerHTML = monthOpts;

  var seasons = {};
  src.forEach(function (m) {
    var se = matchSeasonValue(m);
    if (se) {
      seasons[se] = true;
    }
  });
  var seasonList = Object.keys(seasons).sort(function (a, b) {
    return a.localeCompare(b, 'zh-Hant');
  });
  var curSe = state.filterSeason;
  selS.innerHTML =
    '<option value="">全部賽季</option>' +
    seasonList
      .map(function (se) {
        return (
          '<option value="' +
          escapeHtml(se) +
          '"' +
          (se === curSe ? ' selected' : '') +
          '>' +
          escapeHtml(se) +
          '</option>'
        );
      })
      .join('');

  var statusRows = [
    { v: '', t: '全部狀態' },
    { v: 'future', t: '未來賽事' },
    { v: 'past', t: '過往賽事' },
    { v: 'postponed', t: '延期賽事' },
    { v: 'cancelled', t: '取消賽事' }
  ];
  var curSt = state.filterStatus;
  selSt.innerHTML = statusRows
    .map(function (r) {
      return (
        '<option value="' +
        escapeHtml(r.v) +
        '"' +
        (r.v === curSt ? ' selected' : '') +
        '>' +
        escapeHtml(r.t) +
        '</option>'
      );
    })
    .join('');
}

function renderLeagueFilter(selectId, venueScopeId) {
  var sel = selectId ? document.getElementById(selectId) : $('#league-select');
  if (!sel) {
    return;
  }
  var usedIds = {};
  matchesSourceForFilterScope(venueScopeId).forEach(function (m) {
    if (m && m.league_id) {
      usedIds[String(m.league_id)] = true;
    }
  });
  var list = (state.leagues || [])
    .filter(function (l) {
      return l && l.id && usedIds[String(l.id)];
    })
    .slice()
    .sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  var cur = state.leagueId;
  sel.innerHTML =
    '<option value="">全部賽事</option>' +
    list
      .map(function (l) {
        var id = String(l.id);
        var label = l.name ? String(l.name) : '未命名賽事';
        return (
          '<option value="' +
          escapeHtml(id) +
          '"' +
          (id === cur ? ' selected' : '') +
          '>' +
          escapeHtml(label) +
          '</option>'
        );
      })
      .join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function submitTypeNavHtml(activePlaces) {
  return (
    '<nav class="submit-type-nav" aria-label="投稿類型">' +
    '<a href="#/submit" class="submit-type-nav__link' +
    (activePlaces ? '' : ' submit-type-nav__link--active') +
    '">賽事</a>' +
    '<a href="#/submit/places" class="submit-type-nav__link' +
    (activePlaces ? ' submit-type-nav__link--active' : '') +
    '">景點</a>' +
    '</nav>'
  );
}

function placeSubmitTypeRowLabel(r) {
  if (r.label != null && String(r.label).trim() !== '') {
    return String(r.label).trim();
  }
  if (r.name != null && String(r.name).trim() !== '') {
    return String(r.name).trim();
  }
  return '';
}

/** 景點投稿：類型自訂下拉（icon + label），POST 仍送 type=id */
function placeSubmitTypeFieldHtml() {
  var rows = (state.placeTypes || [])
    .map(function (r) {
      var id = r.id != null ? String(r.id).trim() : '';
      if (!id) {
        return null;
      }
      var lab = placeSubmitTypeRowLabel(r) || id;
      // 先用穩定代碼 id 對應；未命中再回退到顯示 label（避免 "海邊 swim" 這類拼接字串誤判）
      var iconName = placeTypeToMaterialIcon(id);
      if (iconName === 'place') {
        iconName = placeTypeToMaterialIcon(lab);
      }
      return { id: id, lab: lab, iconName: iconName };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return a.lab.localeCompare(b.lab, 'zh-Hant');
    });
  if (!rows.length) {
    return (
      '<input type="text" name="type" required placeholder="類型代碼" maxlength="80" autocomplete="off" />'
    );
  }
  var lis = rows
    .map(function (x) {
      return (
        '<li class="place-submit-type-option" role="option" tabindex="-1" data-value="' +
        escapeHtml(x.id) +
        '" data-icon="' +
        escapeHtml(x.iconName) +
        '" data-label="' +
        escapeHtml(x.lab) +
        '">' +
        '<span class="place-submit-type-option__icon" aria-hidden="true">' +
        msIcon(x.iconName, 'place-submit-type-option__ms') +
        '</span>' +
        '<span class="place-submit-type-option__lab">' +
        escapeHtml(x.lab) +
        '</span>' +
        '</li>'
      );
    })
    .join('');
  return (
    '<div class="place-submit-type-combo" data-places-type-combo="1">' +
    '<input type="hidden" name="type" value="" required id="places-type-hidden" />' +
    '<button type="button" class="place-submit-type-trigger" aria-haspopup="listbox" aria-expanded="false" id="places-type-trigger">' +
    '<span class="place-submit-type-trigger__icon" aria-hidden="true">' +
    msIcon('place', 'place-submit-type-trigger__ms') +
    '</span>' +
    '<span class="place-submit-type-trigger__lab" id="places-type-trigger-lab">請選擇類型</span>' +
    msIcon('expand_more', 'place-submit-type-trigger__chev') +
    '</button>' +
    '<ul class="place-submit-type-list" role="listbox" id="places-type-list" hidden>' +
    lis +
    '</ul>' +
    '</div>'
  );
}

function wirePlacesSubmitTypeSelect(root) {
  var combo = root.querySelector('[data-places-type-combo]');
  if (!combo) {
    return;
  }
  var trigger = combo.querySelector('.place-submit-type-trigger');
  var list = combo.querySelector('.place-submit-type-list');
  var hidden = combo.querySelector('input[name="type"]');
  var iconSlot = combo.querySelector('.place-submit-type-trigger__icon');
  var labSlot = combo.querySelector('.place-submit-type-trigger__lab');
  var form = root.querySelector('#places-form');
  if (!trigger || !list || !hidden || !iconSlot || !labSlot) {
    return;
  }

  function closeList() {
    combo.classList.remove('is-open');
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function openList() {
    combo.classList.add('is-open');
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }

  function resetTrigger() {
    hidden.value = '';
    combo.classList.remove('has-value');
    iconSlot.innerHTML = msIcon('place', 'place-submit-type-trigger__ms');
    labSlot.textContent = '請選擇類型';
    closeList();
  }

  function selectOption(li) {
    if (!li) {
      return;
    }
    var v = li.getAttribute('data-value') || '';
    var ic = li.getAttribute('data-icon') || 'place';
    var lb = li.getAttribute('data-label') || v;
    hidden.value = v;
    combo.classList.add('has-value');
    iconSlot.innerHTML = msIcon(ic, 'place-submit-type-trigger__ms');
    labSlot.textContent = lb;
    closeList();
  }

  trigger.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (combo.classList.contains('is-open')) {
      closeList();
    } else {
      openList();
    }
  });

  list.addEventListener('click', function (e) {
    var li = e.target.closest('.place-submit-type-option');
    if (li && list.contains(li)) {
      selectOption(li);
    }
  });

  if (form) {
    form.addEventListener('reset', function () {
      resetTrigger();
    });
  }

  if (!placesSubmitTypeOutsideCloseBound) {
    placesSubmitTypeOutsideCloseBound = true;
    document.addEventListener(
      'mousedown',
      function (e) {
        document.querySelectorAll('.place-submit-type-combo.is-open').forEach(function (cmb) {
          if (!cmb.contains(e.target)) {
            cmb.classList.remove('is-open');
            var l = cmb.querySelector('.place-submit-type-list');
            var t = cmb.querySelector('.place-submit-type-trigger');
            if (l) {
              l.hidden = true;
            }
            if (t) {
              t.setAttribute('aria-expanded', 'false');
            }
          }
        });
      },
      true
    );
  }
}

function renderLocationView(container) {
  var list = filteredMatches().slice().sort(compareMatchStartTime);
  var groups = groupMatchesByVenue(list);
  var venueIds = Object.keys(groups).sort(function (a, b) {
    var ta = matchEffectiveInstant(groups[a][0]);
    var tb = matchEffectiveInstant(groups[b][0]);
    var na = ta && !isNaN(ta.getTime()) ? ta.getTime() : Number.POSITIVE_INFINITY;
    var nb = tb && !isNaN(tb.getTime()) ? tb.getTime() : Number.POSITIVE_INFINITY;
    if (na !== nb) {
      return na - nb;
    }
    var na2 = (venueById(a) && venueById(a).name) || a;
    var nb2 = (venueById(b) && venueById(b).name) || b;
    return String(na2).localeCompare(String(nb2));
  });

  if (!venueIds.length) {
    container.innerHTML = '<p class="empty">目前沒有符合條件的賽事。</p>';
    return;
  }

  container.innerHTML = venueIds
    .map(function (vid) {
      var v = venueById(vid);
      var name = displayVenueName(v, groups[vid][0].venue_name);
      var rows = groups[vid]
        .map(function (m) {
          return matchCardLiHtml(m, null);
        })
        .join('');

      return (
        '<section class="venue-section">' +
        '<h2 class="venue-heading"><span class="venue-heading__label">場館</span>' +
        '<span class="venue-heading__name">' +
        escapeHtml(name) +
        '</span></h2>' +
        '<ul class="match-list">' +
        rows +
        '</ul>' +
        '<a class="venue-cta" href="#/venues/' +
        encodeURIComponent(vid) +
        '">查看球場</a>' +
        '</section>'
      );
    })
    .join('');
}

function renderTimelineView(container) {
  var list = filteredMatches().slice().sort(compareMatchStartTime);
  if (!list.length) {
    container.innerHTML = '<p class="empty">目前沒有符合條件的賽事。</p>';
    return;
  }
  var byDay = {};
  list.forEach(function (m) {
    var d = matchEffectiveInstant(m);
    var key =
      d && !isNaN(d.getTime())
        ? d.getFullYear() +
          '-' +
          String(d.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(d.getDate()).padStart(2, '0')
        : '_nodate';
    if (!byDay[key]) {
      byDay[key] = [];
    }
    byDay[key].push(m);
  });
  var keys = Object.keys(byDay).sort();
  container.innerHTML = keys
    .map(function (key) {
      var label =
        key === '_nodate'
          ? '日期待定'
          : formatDay(key + 'T12:00:00');
      var lines = byDay[key]
        .map(function (m) {
          var vname = displayVenueName(venueById(m.venue_id), m.venue_name);
          return matchCardLiHtml(m, vname ? [String(vname)] : null);
        })
        .join('');
      return (
        '<section class="day-block day-block--cards"><h3 class="day-title">' +
        escapeHtml(label) +
        '</h3><ul class="match-list">' +
        lines +
        '</ul></section>'
      );
    })
    .join('');
}

function renderNearbyView(container) {
  if (state.geoError) {
    container.innerHTML =
      '<p class="empty">' + escapeHtml(state.geoError) + '</p>';
    return;
  }
  if (!state.userPos) {
    container.innerHTML =
      '<p class="empty">正在取得你的位置…</p>';
    return;
  }
  var list = filteredMatches().slice().sort(compareMatchStartTime);
  var withDist = [];
  list.forEach(function (m) {
    var v = venueById(m.venue_id);
    var vll = latLngFromRow_(v && v.lat, v && v.lng);
    if (!v || !vll) {
      return;
    }
    var km = haversineKm(state.userPos.lat, state.userPos.lng, vll.lat, vll.lng);
    withDist.push({ match: m, km: km, venue: v });
  });
  if (!withDist.length) {
    container.innerHTML =
      '<p class="empty">目前篩選結果中的場館沒有位置資料，無法依距離排序。</p>';
    return;
  }
  function nearbyCardLi(x) {
    var m = x.match;
    var extras = [];
    var vn = displayVenueName(x.venue, m.venue_name);
    if (vn) {
      extras.push(String(vn));
    }
    extras.push('約 ' + x.km.toFixed(1) + ' km');
    return matchCardLiHtml(m, extras);
  }

  // 簡化：用距離 km 分桶（10km 內 ≈ 20 分鐘假設、30km 內 ≈ 1 小時假設，僅示意）
  var b1 = withDist.filter(function (x) {
    return x.km <= 10;
  });
  var b2 = withDist.filter(function (x) {
    return x.km > 10 && x.km <= 30;
  });
  var b3 = withDist.filter(function (x) {
    return x.km > 30;
  });

  function nearbyBucket(title, arr, sliceLimit) {
    var list = typeof sliceLimit === 'number' ? arr.slice(0, sliceLimit) : arr;
    var more =
      typeof sliceLimit === 'number' && arr.length > sliceLimit
        ? '<p class="nearby-more">…尚有更多 ' + (arr.length - sliceLimit) + ' 場</p>'
        : '';
    return (
      '<section class="nearby-section nearby-section--cards"><h3 class="nearby-bucket-heading">' +
      title +
      '</h3>' +
      (list.length
        ? '<ul class="match-list">' + list.map(nearbyCardLi).join('') + '</ul>'
        : '<p class="empty empty--tight">無</p>') +
      more +
      '</section>'
    );
  }

  container.innerHTML =
    '<p class="nearby-loc"><span>已依你的大致位置排序</span></p>' +
    nearbyBucket('<span>約 20 分鐘內（≤10 km）</span>', b1) +
    nearbyBucket('<span>約 1 小時內（10–30 km）</span>', b2) +
    nearbyBucket('<span>其他（&gt;30 km）</span>', b3, 15);
}

function renderExplore() {
  var main = $('#view-explore');
  if (!main) {
    return;
  }
  var content = $('#explore-content');
  if (state.loading) {
    content.innerHTML = '<p class="empty"><span class="loading-text">載入中</span></p>';
    return;
  }
  if (state.error) {
    content.innerHTML =
      '<p class="error">無法載入資料：' + escapeHtml(state.error) + '</p>';
    return;
  }
  document.querySelectorAll('.mode-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.mode === state.mode);
  });
  if (state.mode === 'timeline') {
    renderTimelineView(content);
  } else if (state.mode === 'nearby') {
    renderNearbyView(content);
  } else {
    renderLocationView(content);
  }
  renderMatchSourceNote();
}

function renderMatchSourceNote() {
  var el = $('#match-source-note');
  if (el) {
    el.textContent = '';
  }
}

function renderMatchDetail(id) {
  var main = $('#view-match');
  var m = state.matches.filter(function (x) {
    return String(x.id) === String(id);
  })[0];
  if (!m) {
    main.innerHTML =
      '<p class="empty">找不到這場賽事。</p><p><a href="#/" class="back">' +
      msIcon('arrow_back', 'back__icon') +
      '回首頁</a></p>';
    return;
  }
  var pres = matchCardPresentation(m);
  var meta = pres.meta;
  var v = venueById(m.venue_id);
  var homeNm = m.home_team_name ? String(m.home_team_name) : '';
  var awayNm = m.away_team_name ? String(m.away_team_name) : '';
  if (!homeNm && !awayNm) {
    homeNm = displayMatchTitle(m);
    awayNm = '—';
  } else {
    if (!homeNm) {
      homeNm = '—';
    }
    if (!awayNm) {
      awayNm = '—';
    }
  }
  var matchupTitle = homeNm + ' vs. ' + awayNm;
  var headerActions = matchDetailHeaderActionsHtml(m, v);
  var shareBtnHtml =
    '<button type="button" class="btn-secondary btn-secondary--header btn-inline-action btn-inline-action--share detail-panel__action-share" data-share-match="1">' +
    msIcon('share', 'btn-inline-action__icon') +
    '<span>分享賽事</span></button>';
  main.innerHTML =
    '<header class="detail-header detail-header--match">' +
    '<a href="#/" class="back">' +
    msIcon('arrow_back', 'back__icon') +
    '返回</a>' +
    '</header>' +
    '<section class="match-detail-overview" aria-label="賽事摘要">' +
    '<div class="match-detail-overview__main">' +
    '<h1 class="match-detail-overview__title">' +
    escapeHtml(matchupTitle) +
    '</h1>' +
    '</div>' +
    '<div class="match-detail-overview__bar">' +
    '<div class="match-detail-overview__meta">' +
    '<span class="match-detail-overview__meta-item">' +
    escapeHtml(formatTime(m.start_time)) +
    '</span>' +
    '<span class="match-detail-overview__meta-item">' +
    escapeHtml(displaySportLabel(m)) +
    '</span>' +
    '<span class="match-detail-overview__meta-item"><span class="status-dot ' +
    meta.dotClass +
    '"></span>' +
    escapeHtml(meta.label) +
    '</span>' +
    '</div>' +
    headerActions +
    '</div>' +
    '</section>' +
    '<section class="detail-panel" aria-labelledby="match-detail-info-heading">' +
    '<h2 id="match-detail-info-heading" class="detail-panel__title">賽事資訊</h2>' +
    '<dl class="detail-dl">' +
    detailRow('場館', displayVenueName(v, m.venue_name)) +
    detailRow('城市', (v && v.city) || m.venue_city || '') +
    detailRow('聯盟', displayLeagueName(m)) +
    detailLiveRow(m) +
    detailRow('備註', m.note || '') +
    '</dl></section>' +
    '<div class="match-detail-section-actions" aria-label="賽事資訊操作">' +
    shareBtnHtml +
    '</div>';

  wireMatchShareUi_(main, m, v, meta);
}

function ensureShareModalHtml_(host) {
  var existing = host.querySelector('[data-share-modal="1"]');
  if (existing) {
    return existing;
  }
  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div class="share-modal" data-share-modal="1" hidden>' +
    '<div class="share-modal__backdrop" data-share-close="1" aria-hidden="true"></div>' +
    '<div class="share-modal__panel" role="dialog" aria-modal="true" aria-label="分享賽事">' +
    '<header class="share-modal__head">' +
    '<h2 class="share-modal__title">分享賽事</h2>' +
    '<button type="button" class="share-modal__close" data-share-close="1" aria-label="關閉">' +
    msIcon('close', 'share-modal__close-icon') +
    '</button>' +
    '</header>' +
    '<div class="share-modal__body">' +
    '<div class="share-preview">' +
    '<canvas id="share-canvas" width="1080" height="1080"></canvas>' +
    '</div>' +
    '<div class="share-form">' +
    '<div class="share-form__row share-templates" role="group" aria-label="版型">' +
    '<button type="button" class="share-tpl is-active" data-share-template="A1" aria-pressed="true">' +
    '<span class="share-tpl__lab">資訊</span></button>' +
    '<button type="button" class="share-tpl" data-share-template="A2" aria-pressed="false">' +
    '<span class="share-tpl__lab">比數</span></button>' +
    '<button type="button" class="share-tpl" data-share-template="B1" aria-pressed="false">' +
    '<span class="share-tpl__lab">照片資訊</span></button>' +
    '<button type="button" class="share-tpl" data-share-template="B2" aria-pressed="false">' +
    '<span class="share-tpl__lab">照片比數</span></button>' +
    '</div>' +
    '<div class="share-form__row share-photo" hidden>' +
    '<label class="share-field share-field--file"><span class="share-field__lab">照片</span><input id="share-photo-file" type="file" accept="image/*" /></label>' +
    '</div>' +
    '<div class="share-form__row share-score-tag" hidden>' +
    '<label class="share-field"><span class="share-field__lab">HT/FT/無</span>' +
    '<select id="share-score-tag">' +
    '<option value=\"\">無</option>' +
    '<option value=\"HT\">HT</option>' +
    '<option value=\"FT\">FT</option>' +
    '</select></label>' +
    '</div>' +
    '<div class="share-form__row share-score-fields" hidden>' +
    '<label class="share-field"><span class="share-field__lab">主隊比數</span><input id="share-score-home" inputmode="numeric" maxlength="3" placeholder="-" /></label>' +
    '<label class="share-field"><span class="share-field__lab">客隊比數</span><input id="share-score-away" inputmode="numeric" maxlength="3" placeholder="-" /></label>' +
    '</div>' +
    '<div class="share-form__row share-actions">' +
    '<button type="button" class="btn-secondary share-download" id="share-download" disabled>下載 PNG</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
  host.appendChild(wrap.firstChild);
  return host.querySelector('[data-share-modal="1"]');
}

function loadImageFromFile_(file) {
  return new Promise(function (resolve, reject) {
    if (!file) {
      resolve(null);
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      reject(new Error('Failed to read file'));
    };
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error('Failed to decode image'));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

var shareModalController_ = null;

function getShareModalController_() {
  if (shareModalController_) return shareModalController_;

  var host = document.body;
  var modal = ensureShareModalHtml_(host);
  if (!modal) return null;

  var closeEls = modal.querySelectorAll('[data-share-close="1"]');
  var tplBtns = modal.querySelectorAll('[data-share-template]');
  var scoreTagRow = modal.querySelector('.share-score-tag');
  var scoreFieldsRow = modal.querySelector('.share-score-fields');
  var photoRow = modal.querySelector('.share-photo');
  var scoreTag = modal.querySelector('#share-score-tag');
  var scoreHome = modal.querySelector('#share-score-home');
  var scoreAway = modal.querySelector('#share-score-away');
  var fileInput = modal.querySelector('#share-photo-file');
  var btnDl = modal.querySelector('#share-download');
  var canvas = modal.querySelector('#share-canvas');

  var ctxState = { m: null, v: null, meta: null };
  var shareState = { template: 'A1', photoImg: null };
  var lastDrawOk = false;

  function withScore_() {
    return shareState.template === 'A2' || shareState.template === 'B2';
  }
  function withPhoto_() {
    return shareState.template === 'B1' || shareState.template === 'B2';
  }
  function syncForm_() {
    if (scoreTagRow) scoreTagRow.hidden = !withScore_();
    if (scoreFieldsRow) scoreFieldsRow.hidden = !withScore_();
    if (photoRow) photoRow.hidden = !withPhoto_();
  }
  function setCanvasSize_() {
    if (!canvas) return;
    if (shareState.template === 'A1' || shareState.template === 'A2') {
      if (canvas.width !== 1080 || canvas.height !== 1080) {
        canvas.width = 1080;
        canvas.height = 1080;
      }
    } else {
      if (canvas.width !== 1080 || canvas.height !== 1350) {
        canvas.width = 1080;
        canvas.height = 1350;
      }
    }
  }
  function setActiveTpl_(t) {
    shareState.template = t;
    tplBtns.forEach(function (b) {
      var on = b.getAttribute('data-share-template') === t;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    syncForm_();
  }

  tplBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      setActiveTpl_(b.getAttribute('data-share-template') || 'A1');
      redrawAll_();
    });
  });

  async function redrawAll_() {
    if (!ctxState.m) return;
    syncForm_();
    setCanvasSize_();
    var m = ctxState.m;
    var v = ctxState.v;
    var meta = ctxState.meta;
    var common = {
      title: (m.home_team_name || '—') + ' vs. ' + (m.away_team_name || '—'),
      homeName: m.home_team_name || '—',
      awayName: m.away_team_name || '—',
      isoStart: m.start_time,
      timeText: formatTime(m.start_time),
      sportText: displaySportLabel(m),
      statusText: meta && meta.label ? String(meta.label) : '',
      venueText: displayVenueName(v, m.venue_name),
      cityText: (v && v.city) || m.venue_city || '',
      scoreTag: scoreTag ? String(scoreTag.value || '') : '',
      homeScore: scoreHome ? String(scoreHome.value || '').trim() : '',
      awayScore: scoreAway ? String(scoreAway.value || '').trim() : ''
    };
    var res = await drawShareImage_(
      Object.assign({}, common, {
        canvas: canvas,
        template: shareState.template,
        photoImg: shareState.photoImg
      })
    );
    lastDrawOk = !!(res && res.ok);
    if (btnDl) btnDl.disabled = !lastDrawOk;
  }

  function openForMatch_(m, v, meta) {
    ctxState.m = m;
    ctxState.v = v;
    ctxState.meta = meta;
    modal.hidden = false;
    lastDrawOk = false;
    if (btnDl) btnDl.disabled = true;
    redrawAll_();
  }

  function close_() {
    modal.hidden = true;
  }

  closeEls.forEach(function (el) {
    el.addEventListener('click', function () {
      close_();
    });
  });
  document.addEventListener('keydown', function (e) {
    if (!modal.hidden && e.key === 'Escape') {
      close_();
    }
  });

  if (scoreTag) scoreTag.addEventListener('change', redrawAll_);
  if (scoreHome) scoreHome.addEventListener('input', redrawAll_);
  if (scoreAway) scoreAway.addEventListener('input', redrawAll_);
  if (fileInput) {
    fileInput.addEventListener('change', async function () {
      if (!fileInput.files || !fileInput.files[0]) {
        shareState.photoImg = null;
        redrawAll_();
        return;
      }
      try {
        shareState.photoImg = await loadImageFromFile_(fileInput.files[0]);
      } catch (e1) {
        shareState.photoImg = null;
      }
      redrawAll_();
    });
  }
  if (btnDl) {
    btnDl.addEventListener('click', function () {
      if (!canvas || !ctxState.m) return;
      var mmdd = '';
      try {
        mmdd = formatTime(ctxState.m.start_time).split(' ')[0].replace('/', '');
      } catch (e2) {
        mmdd = '';
      }
      var fname = 'match-' + (ctxState.m.id || 'share') + (mmdd ? '-' + mmdd : '') + '.png';
      downloadCanvasPng_(canvas, fname);
    });
  }

  shareModalController_ = {
    openForMatch: openForMatch_,
    close: close_,
    redraw: redrawAll_
  };
  return shareModalController_;
}

function openShareModalForMatch_(m, v, meta) {
  var ctl = getShareModalController_();
  if (!ctl) return;
  ctl.openForMatch(m, v, meta);
}

function coverDrawImage_(ctx, img, x, y, w, h) {
  var iw = img.naturalWidth || img.width;
  var ih = img.naturalHeight || img.height;
  if (!iw || !ih) {
    return;
  }
  var s = Math.max(w / iw, h / ih);
  var sw = w / s;
  var sh = h / s;
  var sx = (iw - sw) / 2;
  var sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function roundRectPath_(ctx, x, y, w, h, r) {
  var rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapTextLines_(ctx, text, maxWidth) {
  var s = String(text || '').trim();
  if (!s) {
    return [];
  }
  var out = [];
  var line = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    var next = line + ch;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      out.push(line);
      line = ch;
    }
  }
  if (line) {
    out.push(line);
  }
  return out;
}

async function drawShareImage_(opts) {
  opts = opts || {};
  var canvas = opts.canvas;
  if (!canvas) {
    return { ok: false, error: 'No canvas' };
  }
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (e) {
      /* ignore */
    }
  }
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all([
        document.fonts.load('10px "Dela Gothic One"'),
        document.fonts.load('10px "TASA Explorer"'),
        document.fonts.load('10px "Noto Sans TC"'),
        document.fonts.load('10px "Material Symbols Outlined"')
      ]);
    } catch (e2) {
      /* ignore */
    }
  }
  var ctx = canvas.getContext('2d');
  var W = canvas.width;
  var H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  var template = String(opts.template || 'A1');
  var withPhoto = template === 'B1' || template === 'B2';
  var withScore = template === 'A2' || template === 'B2';

  function cssRadiusPx_(varName, fallback) {
    if (typeof window === 'undefined' || !window.getComputedStyle) return fallback;
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(varName);
      var n = parseFloat(String(v || '').trim());
      return isNaN(n) ? fallback : n;
    } catch (e) {
      return fallback;
    }
  }

  function shareRadiusPx_(w, h) {
    // Keep rounding consistent with site radii, scaled to canvas size.
    var base = Math.min(w, h);
    var rCss = cssRadiusPx_('--radius-card', 12);
    var r = (rCss * base) / 720; // 720 is app max width baseline
    r = Math.max(14, Math.min(32, r));
    return Math.round(r);
  }

  // base (yellow card with rounded corners)
  var radius = shareRadiusPx_(W, H);
  roundRectPath_(ctx, 0, 0, W, H, radius);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#f7b728';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  var timeText = opts.timeText || '';
  var isoStart = opts.isoStart || '';
  var sportText = opts.sportText || '';
  var statusText = opts.statusText || '';
  var venueText = opts.venueText || '';
  var cityText = opts.cityText || '';
  var tag = String(opts.scoreTag || '');
  var hs = String(opts.homeScore || '').trim();
  var as = String(opts.awayScore || '').trim();

  function splitDateTime_(t) {
    var s = String(t || '');
    var parts = s.split(' ');
    return { date: parts[0] || s, time: parts[1] || '' };
  }
  var dt = splitDateTime_(timeText);
  var home = opts.homeName || '';
  var away = opts.awayName || '';
  var placeLine = [venueText, cityText].filter(Boolean).join(' · ');

  function setFont_(weight, px) {
    ctx.font = weight + ' ' + Math.round(px) + 'px "TASA Explorer","Noto Sans TC",sans-serif';
  }

  function setFontTime_(weight, px) {
    ctx.font = weight + ' ' + Math.round(px) + 'px "Dela Gothic One",sans-serif';
  }

  function setFontIcon_(px) {
    ctx.font =
      '400 ' + Math.round(px) + 'px "Material Symbols Outlined","Material Symbols Rounded",sans-serif';
  }

  function drawTextFit_(text, x, y, maxWidth, basePx, weight, align) {
    var s = String(text || '').trim();
    if (!s) return;
    var px = basePx;
    ctx.textAlign = align || 'left';
    while (px > 18) {
      setFont_(weight, px);
      if (ctx.measureText(s).width <= maxWidth) break;
      px *= 0.94;
    }
    ctx.fillText(s, x, y);
  }

  function drawTextFitTime_(text, x, y, maxWidth, basePx, weight, align) {
    var s = String(text || '').trim();
    if (!s) return;
    var px = basePx;
    ctx.textAlign = align || 'left';
    while (px > 18) {
      setFontTime_(weight, px);
      if (ctx.measureText(s).width <= maxWidth) break;
      px *= 0.94;
    }
    ctx.fillText(s, x, y);
  }

  function fitTimeFont_(text, maxWidth, basePx, weight) {
    var s = String(text || '').trim();
    if (!s) return { text: '', px: basePx, width: 0, ascent: 0, descent: 0 };
    var px = basePx;
    while (px > 18) {
      setFontTime_(weight, px);
      var m = ctx.measureText(s);
      if (m.width <= maxWidth) {
        return {
          text: s,
          px: px,
          width: m.width,
          ascent: m.actualBoundingBoxAscent || px * 0.8,
          descent: m.actualBoundingBoxDescent || px * 0.2
        };
      }
      px *= 0.94;
    }
    setFontTime_(weight, px);
    var mm = ctx.measureText(s);
    return {
      text: s,
      px: px,
      width: mm.width,
      ascent: mm.actualBoundingBoxAscent || px * 0.8,
      descent: mm.actualBoundingBoxDescent || px * 0.2
    };
  }

  function drawTimeTextHalo_(text, x, y, align, px, weight, strokeW) {
    var s = String(text || '').trim();
    if (!s) return;
    ctx.save();
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    setFontTime_(weight, px);

    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = strokeW || Math.max(6, Math.round(px * 0.06));
    ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
    ctx.restore();

    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    setFontTime_(weight, px);
    ctx.fillText(s, x, y);
  }

  function drawCenterFit_(text, cx, y, maxWidth, basePx, weight) {
    drawTextFit_(text, cx, y, maxWidth, basePx, weight, 'center');
  }

  function drawCenterFitTime_(text, cx, y, maxWidth, basePx, weight) {
    drawTextFitTime_(text, cx, y, maxWidth, basePx, weight, 'center');
  }

  function weekdayLabel_(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var map = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    return map[d.getDay()] || '';
  }

  function drawWeekAfterRightAlignedDate_(dateText, weekdayText, xRight, y, datePx) {
    var d = String(dateText || '').trim();
    var w = String(weekdayText || '').trim();
    if (!d || !w) return;
    setFont_('800', datePx);
    var dateW = ctx.measureText(d).width;
    var gap = 10;
    var xLeft = xRight + gap;
    ctx.fillStyle = 'rgba(7,37,163,0.55)';
    ctx.font = '700 30px "TASA Explorer","Noto Sans TC",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(' ' + w, xLeft, y);
  }

  function drawDateWithWeekday_(dateText, weekdayText, cx, y, maxWidth, datePx) {
    var d = String(dateText || '').trim();
    if (!d) {
      ctx.fillStyle = '#0725a3';
      drawCenterFitTime_('—', cx, y, maxWidth, datePx, '400');
      return;
    }
    ctx.fillStyle = '#0725a3';
    drawCenterFitTime_(d, cx, y, maxWidth, datePx, '400');
    var w = String(weekdayText || '').trim();
    if (!w) return;

    // same style as footer mark: "出門看球！" (size + color + font)
    setFontTime_('400', datePx);
    var dateW = ctx.measureText(d).width;
    var smallPx = 30;
    var wText = ' ' + w;
    ctx.font = '700 ' + smallPx + 'px "TASA Explorer","Noto Sans TC",sans-serif';
    var wW = ctx.measureText(wText).width;
    var gap = 10;
    var xLeft = cx + dateW / 2 + gap;
    if (xLeft + wW > cx + maxWidth / 2) {
      xLeft = cx + maxWidth / 2 - wW;
    }
    ctx.fillStyle = 'rgba(7,37,163,0.55)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(wText, xLeft, y);
  }

  function drawPair_(leftText, rightText, y, pad, basePx) {
    ctx.fillStyle = '#0725a3';
    drawTextFit_(leftText, pad, y, W / 2 - pad - 12, basePx, '900', 'left');
    drawTextFit_(rightText, W - pad, y, W / 2 - pad - 12, basePx, '900', 'right');
    ctx.fillStyle = 'rgba(7,37,163,0.65)';
    setFont_('800', Math.max(22, basePx * 0.28));
    ctx.textAlign = 'center';
    ctx.fillText('vs.', W / 2, y - Math.round(basePx * 0.16));
  }

  function drawLocationCentered_(label, y, baseTextPx) {
    var s = String(label || '').trim();
    if (!s) return;
    var iconName = 'location_on';
    var iconPx = Math.round(baseTextPx * 1.05);
    var gap = Math.round(baseTextPx * 0.26);
    setFont_('800', baseTextPx);
    var textW = ctx.measureText(s).width;
    setFontIcon_(iconPx);
    var iconW = ctx.measureText(iconName).width;
    var totalW = iconW + gap + textW;
    var startX = Math.round((W - totalW) / 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0725a3';
    ctx.textBaseline = 'middle';
    var midY = y - Math.round(baseTextPx * 0.18);
    setFontIcon_(iconPx);
    ctx.fillText(iconName, startX, midY);
    setFont_('800', baseTextPx);
    ctx.fillText(s, startX + iconW + gap, midY);
    ctx.textBaseline = 'alphabetic';
  }

  function drawLocationCenteredOffset_(label, y, baseTextPx, dx, enhanceOnPhoto) {
    dx = dx || 0;
    var s = String(label || '').trim();
    if (!s) return;
    var iconName = 'location_on';
    var iconPx = Math.round(baseTextPx * 1.05);
    var gap = Math.round(baseTextPx * 0.26);
    setFont_('800', baseTextPx);
    var textW = ctx.measureText(s).width;
    setFontIcon_(iconPx);
    var iconW = ctx.measureText(iconName).width;
    var totalW = iconW + gap + textW;
    var startX = Math.round((W - totalW) / 2 + dx);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0725a3';
    ctx.textBaseline = 'middle';
    var midY = y - Math.round(baseTextPx * 0.18);
    if (enhanceOnPhoto) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.22)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      // soft white outline under icon/text for readability
      ctx.strokeStyle = 'rgba(255,255,255,0.88)';
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';

      setFontIcon_(iconPx);
      ctx.strokeText(iconName, startX, midY);
      setFont_('800', baseTextPx);
      ctx.strokeText(s, startX + iconW + gap, midY);

      ctx.restore();
    }

    setFontIcon_(iconPx);
    ctx.fillText(iconName, startX, midY);
    setFont_('800', baseTextPx);
    ctx.fillText(s, startX + iconW + gap, midY);
    ctx.textBaseline = 'alphabetic';
  }

  function drawBDateTimeCentered_(dateText, weekdayText, timeText, y, datePx, timePx) {
    var d = String(dateText || '').trim();
    var w = String(weekdayText || '').trim();
    var t = String(timeText || '').trim();
    if (!d && !t) return;

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // measure widths
    setFont_('800', datePx);
    var dStr = d || '';
    var dW = dStr ? ctx.measureText(dStr).width : 0;

    var wStr = w ? ' ' + w : '';
    ctx.font = '700 30px "TASA Explorer","Noto Sans TC",sans-serif';
    var wW = wStr ? ctx.measureText(wStr).width : 0;

    setFont_('800', timePx);
    var tStr = t || '';
    var tW = tStr ? ctx.measureText(tStr).width : 0;

    var gap1 = dStr && (wStr || tStr) ? 6 : 0;
    var gap2 = (dStr || wStr) && tStr ? 18 : 0;

    var totalW = dW + (wW ? gap1 + wW : 0) + (tW ? gap2 + tW : 0);
    var x = Math.round(W / 2 - totalW / 2);

    // draw date (blue)
    ctx.fillStyle = '#0725a3';
    if (dStr) {
      setFont_('800', datePx);
      ctx.fillText(dStr, x, y);
      x += dW;
    }
    // weekday (grey, footer style)
    if (wW) {
      x += gap1;
      ctx.fillStyle = 'rgba(7,37,163,0.55)';
      ctx.font = '700 30px "TASA Explorer","Noto Sans TC",sans-serif';
      ctx.fillText(wStr, x, y);
      x += wW;
    }
    // time (blue)
    if (tW) {
      x += gap2;
      ctx.fillStyle = '#0725a3';
      setFont_('800', timePx);
      ctx.fillText(tStr, x, y);
    }
  }

  function drawLocationRight_(label, xRight, y, baseTextPx) {
    var s = String(label || '').trim();
    if (!s) return;
    var iconName = 'location_on';
    var iconPx = Math.round(baseTextPx * 1.05);
    var gap = Math.round(baseTextPx * 0.26);
    setFont_('800', baseTextPx);
    var textW = ctx.measureText(s).width;
    setFontIcon_(iconPx);
    var iconW = ctx.measureText(iconName).width;
    var totalW = iconW + gap + textW;
    var startX = Math.round(xRight - totalW);
    ctx.fillStyle = '#0725a3';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var midY = y - Math.round(baseTextPx * 0.18);
    setFontIcon_(iconPx);
    ctx.fillText(iconName, startX, midY);
    setFont_('800', baseTextPx);
    ctx.fillText(s, startX + iconW + gap, midY);
    ctx.textBaseline = 'alphabetic';
  }

  function drawDateLocationCentered_(dateText, venueLabel, y, baseTextPx) {
    var d = String(dateText || '').trim();
    var vlab = String(venueLabel || '').trim();
    if (!d && !vlab) return;

    var iconName = 'location_on';
    var iconPx = Math.round(baseTextPx * 1.05);
    var gap = Math.round(baseTextPx * 0.32);
    var gapIcon = Math.round(baseTextPx * 0.26);

    setFont_('800', baseTextPx);
    var dW = d ? ctx.measureText(d).width : 0;
    var vW = vlab ? ctx.measureText(vlab).width : 0;
    setFontIcon_(iconPx);
    var iconW = vlab ? ctx.measureText(iconName).width : 0;
    var totalW =
      (d ? dW : 0) +
      (d && vlab ? gap : 0) +
      (vlab ? iconW + gapIcon + vW : 0);

    var startX = Math.round(W / 2 - totalW / 2);
    ctx.fillStyle = '#0725a3';
    ctx.textBaseline = 'middle';
    var midY = y - Math.round(baseTextPx * 0.18);

    if (d) {
      setFont_('800', baseTextPx);
      ctx.textAlign = 'left';
      ctx.fillText(d, startX, midY);
      startX += dW;
    }
    if (d && vlab) {
      setFont_('800', baseTextPx);
      ctx.fillText(' ', startX, midY);
      startX += gap;
    }
    if (vlab) {
      setFontIcon_(iconPx);
      ctx.fillText(iconName, startX, midY);
      startX += iconW + gapIcon;
      setFont_('800', baseTextPx);
      ctx.fillText(vlab, startX, midY);
    }
    ctx.textBaseline = 'alphabetic';
  }

  function drawTeamsA1_(homeRaw, awayRaw, yBase, pad, basePx) {
    // Share-only rule:
    // If a team name contains BOTH full-width (CJK) and half-width (latin/digits/symbols),
    // always split into 2 lines (full on first line, half on second line).
    function shareTeamLines_(raw) {
      var s = raw == null ? '' : String(raw);
      var hasFull = false;
      var hasHalf = false;
      var ch;
      for (ch of s) {
        var t = matchCardCharScriptClass(ch);
        if (t === 'full') hasFull = true;
        else hasHalf = true;
      }
      if (!(hasFull && hasHalf)) {
        return { kind: 'single', a: s.trim(), b: '' };
      }
      var runs = [];
      var curType = null;
      var buf = '';
      for (ch of s) {
        var tt = matchCardCharScriptClass(ch);
        if (curType === null) {
          curType = tt;
          buf = ch;
        } else if (tt === curType) {
          buf += ch;
        } else {
          runs.push({ type: curType, text: buf });
          curType = tt;
          buf = ch;
        }
      }
      if (buf) runs.push({ type: curType, text: buf });
      var fullParts = [];
      var halfParts = [];
      for (var r = 0; r < runs.length; r++) {
        if (runs[r].type === 'full') fullParts.push(runs[r].text);
        else halfParts.push(runs[r].text);
      }
      var fullLine = fullParts.join('').trim();
      var halfLine = halfParts
        .map(function (p) {
          return p.replace(/\s+/g, ' ').trim();
        })
        .filter(function (p) {
          return p.length;
        })
        .join(' ')
        .trim();
      if (!fullLine || !halfLine) {
        return { kind: 'single', a: s.trim(), b: '' };
      }
      return { kind: 'stacked', a: fullLine, b: halfLine };
    }

    var homeL = shareTeamLines_(homeRaw);
    var awayL = shareTeamLines_(awayRaw);
    var hasStacked = homeL.kind === 'stacked' || awayL.kind === 'stacked';
    var y = hasStacked ? yBase : yBase - 20;

    function fits_(px) {
      var fullPx = Math.round(px * 0.64);
      var halfPx = Math.round(px * 0.44);
      var ok = true;

      function maxLineW_(lines) {
        if (lines.kind === 'single') {
          setFont_('900', px);
          return ctx.measureText(lines.a).width;
        }
        var w1;
        var w2;
        setFont_('900', fullPx);
        w1 = ctx.measureText(lines.a).width;
        setFont_('900', halfPx);
        w2 = ctx.measureText(lines.b).width;
        return Math.max(w1, w2);
      }

      if (maxLineW_(homeL) > maxWidthEach) ok = false;
      if (maxLineW_(awayL) > maxWidthEach) ok = false;
      return ok;
    }

    // user request: fixed shrink percentage for ALL teams (share image),
    // then only shrink further if it still doesn't fit.
    var px = Math.round(basePx * 0.42);
    while (px > 44 && !fits_(px)) {
      px = Math.round(px * 0.94);
    }

    // Keep stacked teams visually consistent with single-line teams:
    // line 1 uses the same primary size; line 2 is slightly smaller only.
    var fullPx = Math.round(px);
    var halfPx = Math.round(px * 0.78);
    var lineGap = Math.round(px * 0.92);
    var leftCx = Math.round(W * 0.25);
    var rightCx = Math.round(W * 0.75);
    var maxWidthEach = Math.round(W / 2 - pad * 2);

    function drawTeam_(lines, x, align) {
      ctx.fillStyle = '#0725a3';
      ctx.textAlign = align;
      if (lines.kind === 'single') {
        setFont_('900', px);
        ctx.fillText(lines.a || '—', x, y);
        return;
      }
      setFont_('900', fullPx);
      ctx.fillText(lines.a || '—', x, y - lineGap);
      setFont_('900', halfPx);
      ctx.fillText(lines.b || '', x, y);
    }

    // user request: home centered in left half; away centered in right half
    drawTeam_(homeL, leftCx, 'center');
    drawTeam_(awayL, rightCx, 'center');

    ctx.fillStyle = 'rgba(7,37,163,0.65)';
    ctx.textAlign = 'center';
    // user request: vs. font size +300% (relative to previous small "vs.")
    setFont_('900', Math.max(64, Math.round(px * 0.72)));
    var vsY = hasStacked ? y - Math.round(lineGap / 2) : y;
    // optical adjustment for this font: nudge right without affecting team columns
    ctx.fillText('vs.', W / 2 + 20, vsY);
  }

  if (template === 'A1' || template === 'A2') {
    // A: align to SVG (viewBox 300x300) by ratios
    var base = 300;
    var padA = Math.round(W * 0.075);

    var yDate = Math.round((68.83 / base) * H);
    var yTime = Math.round((117.47 / base) * H) + 14;
    var yTeams = Math.round((187.9 / base) * H);
    var yLoc = Math.round((251.86 / base) * H);

    ctx.fillStyle = '#0725a3';

    if (template === 'A2') {
      // A2: mostly same as A1, with score in A1 date/time style (Dela),
      // HT/FT tag in Dela at half score size,
      // bottom date/time styled like location, using TASA.
      // user request: score + tag font size 150%
      var scorePx = W * 0.16 * 1.5;
      var scoreLine = (hs || '-') + ' : ' + (as || '-');
      var yScore = yTime - 100 + 30;

      ctx.fillStyle = '#0725a3';
      if (tag) {
        var tagText = String(tag).trim();
        var fitScoreA2 = fitTimeFont_(scoreLine, W - padA * 2, scorePx, '400');
        var scoreTop = yScore - fitScoreA2.ascent;
        var scoreLeft = W / 2 - fitScoreA2.width / 2;
        var tagPx = fitScoreA2.px * 0.25;
        setFontTime_('400', tagPx);
        var tagM = ctx.measureText(tagText);
        var tagDes = tagM.actualBoundingBoxDescent || tagPx * 0.2;
        var yTag = scoreTop - 10 - tagDes;
        // user request: align tag to score box left, and move with score size
        ctx.textAlign = 'left';
        ctx.fillStyle = '#0725a3';
        setFontTime_('400', tagPx);
        ctx.fillText(tagText, scoreLeft, yTag);
      }
      ctx.textAlign = 'center';
      var fitScoreA2b = fitTimeFont_(scoreLine, W - padA * 2, scorePx, '400');
      ctx.fillStyle = '#0725a3';
      setFontTime_('400', fitScoreA2b.px);
      ctx.fillText(fitScoreA2b.text, W / 2, yScore);

      // bottom row: date/time + location (same hierarchy as location; TASA)
      // user request: shrink to 80%
      var metaPx = W * 0.068 * 0.8 * 0.8;
      ctx.fillStyle = '#0725a3';
      // user request: date + icon + location treated as a centered group
      drawDateLocationCentered_(dt.date || '', venueText || '', yLoc, metaPx);
    } else {
      // date + time (centered)
      drawDateWithWeekday_(
        dt.date || '—',
        weekdayLabel_(isoStart),
        W / 2,
        yDate,
        W - padA * 2,
        W * 0.16
      );
      ctx.fillStyle = '#0725a3';
      drawCenterFitTime_(dt.time || '—', W / 2, yTime, W - padA * 2, W * 0.16, '400');
      // location (centered)
      // user request: location hierarchy smaller
      drawLocationCentered_(placeLine || '', yLoc, W * 0.068 * 0.8);
    }

    // teams
    ctx.textBaseline = 'alphabetic';
    var teamsY = template === 'A1' ? yTeams + 70 : yTeams;
    drawTeamsA1_(home || '—', away || '—', teamsY, padA, W * 0.20);
  } else {
    // B: align to SVG B1/B2 (already 1080x1350)
    var padB = 90;
    var photoX = 90;
    var photoY = 101;
    var photoW = 900;
    var photoH = 675;
    var photoR = shareRadiusPx_(W, H);
    var photoRight = photoX + photoW;
    var photoBottom = photoY + photoH;

    // photo panel (B1/B2)
    ctx.save();
    roundRectPath_(ctx, photoX, photoY, photoW, photoH, photoR);
    ctx.clip();
    if (opts.photoImg) {
      coverDrawImage_(ctx, opts.photoImg, photoX, photoY, photoW, photoH);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(photoX, photoY, photoW, photoH);
      // hint text when no photo selected
      ctx.fillStyle = 'rgba(7,37,163,0.55)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      setFont_('800', 44);
      ctx.fillText('尚未選擇照片', photoX + photoW / 2, photoY + photoH / 2 - 18);
      setFont_('700', 30);
      ctx.fillText('可上傳照片套用在此區域', photoX + photoW / 2, photoY + photoH / 2 + 24);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();

    // score (B2) — style based on A2
    if (template === 'B2' && withScore) {
      var scorePxB2 = 160 * 1.5;
      var scoreLineB2 = (hs || '-') + ' : ' + (as || '-');
      var yScoreB2 = 812 + 30;
      var cxScoreB2 = 760;
      var maxWScoreB2 = 520;

      ctx.fillStyle = '#0725a3';
      ctx.textAlign = 'center';

      var fitScoreB2 = fitTimeFont_(scoreLineB2, maxWScoreB2, scorePxB2, '400');
      var scoreTopB2 = yScoreB2 - fitScoreB2.ascent;
      var scoreLeftB2 = cxScoreB2 - fitScoreB2.width / 2;

      if (tag) {
        var tagTextB2 = String(tag).trim();
        var tagPxB2 = fitScoreB2.px * 0.25;
        setFontTime_('400', tagPxB2);
        var mTagB2 = ctx.measureText(tagTextB2);
        var tagDesB2 = mTagB2.actualBoundingBoxDescent || tagPxB2 * 0.2;
        // tighter: tag bottom is just above score top
        var yTagB2 = scoreTopB2 - 2 - tagDesB2;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#0725a3';
        drawTimeTextHalo_(tagTextB2, scoreLeftB2, yTagB2, 'left', tagPxB2, '400', 6);
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = '#0725a3';
      drawTimeTextHalo_(fitScoreB2.text, cxScoreB2, yScoreB2, 'center', fitScoreB2.px, '400', 12);
    }

    // location line
    ctx.fillStyle = '#0725a3';
    ctx.textAlign = 'center';
    // user request: move up 10px, nudge left 10px
    if (template === 'B1') {
      drawLocationCenteredOffset_(venueText || '', 801 - 10, 72, -10, true);
    }

    function drawTeamsB1_(homeRaw, awayRaw, yBase, pad, basePx) {
      function shareTeamLines_(raw) {
        var s = raw == null ? '' : String(raw);
        var hasFull = false;
        var hasHalf = false;
        var ch;
        for (ch of s) {
          var t = matchCardCharScriptClass(ch);
          if (t === 'full') hasFull = true;
          else hasHalf = true;
        }
        if (!(hasFull && hasHalf)) {
          return { kind: 'single', a: s.trim(), b: '' };
        }
        var runs = [];
        var curType = null;
        var buf = '';
        for (ch of s) {
          var tt = matchCardCharScriptClass(ch);
          if (curType === null) {
            curType = tt;
            buf = ch;
          } else if (tt === curType) {
            buf += ch;
          } else {
            runs.push({ type: curType, text: buf });
            curType = tt;
            buf = ch;
          }
        }
        if (buf) runs.push({ type: curType, text: buf });
        var fullParts = [];
        var halfParts = [];
        for (var r = 0; r < runs.length; r++) {
          if (runs[r].type === 'full') fullParts.push(runs[r].text);
          else halfParts.push(runs[r].text);
        }
        var fullLine = fullParts.join('').trim();
        var halfLine = halfParts
          .map(function (p) {
            return p.replace(/\s+/g, ' ').trim();
          })
          .filter(function (p) {
            return p.length;
          })
          .join(' ')
          .trim();
        if (!fullLine || !halfLine) {
          return { kind: 'single', a: s.trim(), b: '' };
        }
        return { kind: 'stacked', a: fullLine, b: halfLine };
      }

      var homeL = shareTeamLines_(homeRaw);
      var awayL = shareTeamLines_(awayRaw);
      var hasStacked = homeL.kind === 'stacked' || awayL.kind === 'stacked';
      var y = hasStacked ? yBase : yBase - 20;

      var leftCx = Math.round(W * 0.25);
      var rightCx = Math.round(W * 0.75);
      var maxWidthEach = Math.round(W / 2 - pad * 2);

      function fits_(px) {
        var fullPx = Math.round(px);
        var halfPx = Math.round(px * 0.78);
        var ok = true;
        function maxLineW_(lines) {
          if (lines.kind === 'single') {
            setFont_('900', px);
            return ctx.measureText(lines.a).width;
          }
          var w1;
          var w2;
          setFont_('900', fullPx);
          w1 = ctx.measureText(lines.a).width;
          setFont_('900', halfPx);
          w2 = ctx.measureText(lines.b).width;
          return Math.max(w1, w2);
        }
        if (maxLineW_(homeL) > maxWidthEach) ok = false;
        if (maxLineW_(awayL) > maxWidthEach) ok = false;
        return ok;
      }

      var px = Math.round(basePx * 0.42);
      while (px > 44 && !fits_(px)) {
        px = Math.round(px * 0.94);
      }
      var fullPx = Math.round(px);
      var halfPx = Math.round(px * 0.78);
      var lineGap = Math.round(px * 0.92);

      function drawTeam_(lines, x, align) {
        ctx.fillStyle = '#0725a3';
        ctx.textAlign = align;
        if (lines.kind === 'single') {
          setFont_('900', px);
          ctx.fillText(lines.a || '—', x, y);
          return;
        }
        setFont_('900', fullPx);
        ctx.fillText(lines.a || '—', x, y - lineGap);
        setFont_('900', halfPx);
        ctx.fillText(lines.b || '', x, y);
      }

      ctx.textBaseline = 'alphabetic';
      drawTeam_(homeL, leftCx, 'center');
      drawTeam_(awayL, rightCx, 'center');

      ctx.fillStyle = 'rgba(7,37,163,0.65)';
      ctx.textAlign = 'center';
      setFont_('900', Math.max(64, Math.round(px * 0.72)));
      var vsY = hasStacked ? y - Math.round(lineGap / 2) : y;
      ctx.fillText('vs.', W / 2 + 20, vsY);
    }

    // teams line (same share logic as A1)
    drawTeamsB1_(home || '—', away || '—', 991, padB, 150);

    // bottom date/time
    if (template === 'B1') {
      // user request: date + weekday + time centered, no overlap
      drawBDateTimeCentered_(dt.date || '', weekdayLabel_(isoStart), dt.time || '', 1121, 66, 66);
    } else {
      // B2: bottom info = date + icon + location, centered
      ctx.fillStyle = '#0725a3';
      // user request: shrink to 80% (match B1 date size/weight system)
      drawDateLocationCentered_(dt.date || '', venueText || '', 1121, 66 * 0.8);
    }
  }

  // footer mark
  ctx.fillStyle = 'rgba(7,37,163,0.55)';
  ctx.font = '700 30px "TASA Explorer","Noto Sans TC",sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('出門看球！', W - Math.round(W * 0.075), H - Math.round(H * 0.06));
  ctx.textAlign = 'left';

  return { ok: true };
}

function downloadCanvasPng_(canvas, filename) {
  return new Promise(function (resolve) {
    canvas.toBlob(
      async function (blob) {
        if (!blob) {
          resolve(false);
          return;
        }
        var fname = filename || 'share.png';

        // iOS Safari: "download" is unreliable; prefer Share Sheet when available.
        try {
          var file = new File([blob], fname, { type: 'image/png' });
          if (
            navigator &&
            navigator.canShare &&
            navigator.share &&
            navigator.canShare({ files: [file] })
          ) {
            await navigator.share({ files: [file], title: fname });
            resolve(true);
            return;
          }
        } catch (eShare) {
          /* fallback */
        }

        // Fallback: try normal download; if blocked, open image in new tab.
        var url = URL.createObjectURL(blob);
        try {
          var a = document.createElement('a');
          a.href = url;
          a.download = fname;
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          a.remove();
          resolve(true);
        } catch (eDl) {
          try {
            window.open(url, '_blank', 'noopener,noreferrer');
            resolve(true);
          } catch (eOpen) {
            resolve(false);
          }
        } finally {
          setTimeout(function () {
            URL.revokeObjectURL(url);
          }, 4000);
        }
      },
      'image/png',
      1
    );
  });
}

function wireMatchShareUi_(main, m, v, meta) {
  if (!main || !m) {
    return;
  }
  var openBtn = main.querySelector('[data-share-match="1"]');
  if (!openBtn) return;
  openBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    openShareModalForMatch_(m, v, meta);
  });
}

/** 賽事詳情 header 右側：查看球場、觀看直播 */
function matchDetailHeaderActionsHtml(m, v) {
  var parts = [];
  if (m.venue_id != null && String(m.venue_id).trim() !== '') {
    parts.push(
      '<a class="btn-secondary btn-secondary--header btn-inline-action btn-inline-action--venue" href="#/venues/' +
        encodeURIComponent(String(m.venue_id).trim()) +
        '">' +
        msIcon('location_on', 'btn-inline-action__icon') +
        '<span>查看球場</span></a>'
    );
  }
  var bc = getMatchBroadcastFields(m);
  var liveHref = matchLiveDetailHref(bc.live_url);
  if (liveHref) {
    parts.push(
      '<a class="btn-detail-live btn-detail-live--header btn-inline-action btn-inline-action--live" href="' +
        escapeHtml(liveHref) +
        '" target="_blank" rel="noopener noreferrer">' +
        msIcon('live_tv', 'btn-inline-action__icon') +
        '<span>觀看直播</span></a>'
    );
  }
  if (!parts.length) {
    return '';
  }
  return (
    '<nav class="match-detail-overview__actions" aria-label="快捷操作">' + parts.join('') + '</nav>'
  );
}

function detailRow(label, val) {
  if (!val) {
    return '';
  }
  return (
    '<dt>' +
    escapeHtml(label) +
    '</dt><dd>' +
    escapeHtml(val) +
    '</dd>'
  );
}

/** matches.live / live_url：有網址時以 live 文字為連結錨點 */
function matchLiveDetailHref(raw) {
  var s = String(raw || '').trim();
  if (!s) {
    return '';
  }
  var candidates = [s];
  if (!/^https?:\/\//i.test(s)) {
    candidates.push('https://' + s.replace(/^\/+/, ''));
  }
  for (var i = 0; i < candidates.length; i++) {
    try {
      var u = new URL(candidates[i]);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return u.href;
      }
    } catch (err) {
      /* try next */
    }
  }
  return '';
}

function detailLiveRow(m) {
  var bc = getMatchBroadcastFields(m);
  var live = bc.live;
  var href = matchLiveDetailHref(bc.live_url);
  if (!live && !href) {
    return '';
  }
  if (href) {
    var text = live || '轉播連結';
    return (
      '<dt>' +
      escapeHtml('轉播') +
      '</dt><dd>' +
      '<a class="detail-live-link" href="' +
      escapeHtml(href) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(text) +
      '</a></dd>'
    );
  }
  return detailRow('轉播', live);
}

function renderVenueDetail(id) {
  var main = $('#view-venue');
  var v = venueById(id);
  if (!v) {
    main.innerHTML =
      '<p class="empty">找不到這個場館。</p><p><a href="#/" class="back">' +
      msIcon('arrow_back', 'back__icon') +
      '回首頁</a></p>';
    return;
  }
  var venuePoint = venueLatLng(v);
  var venueNearbyPlaces = state.places.filter(function (p) {
    var cityOk = venuePlaceSameCityNormalized(v.city, p.city);
    var placePt = latLngFromRow_(p.lat, p.lng);
    var distOk = false;
    if (venuePoint && placePt) {
      var d = haversineKm(venuePoint.lat, venuePoint.lng, placePt.lat, placePt.lng);
      distOk = d <= VENUE_NEARBY_PLACES_MAX_KM;
    }
    return cityOk || distOk;
  });
  var placeItems = venueNearbyPlaces.map(function (p) {
    var placePt = latLngFromRow_(p.lat, p.lng);
    var hasPoint = placePt != null;
    var km = venuePoint ? placeDistanceKmFromVenue_(v.city, p.city, venuePoint, placePt) : null;
    var mapFromSheet = normalizeHttpUrl(p.map_url);
    var mapHref = mapFromSheet;
    var mapLinkIsCoords = false;
    if (!mapHref && hasPoint) {
      mapHref =
        'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent(placePt.lat + ',' + placePt.lng);
      mapLinkIsCoords = true;
    }
    var desc = '';
    if (p.description != null && String(p.description).trim() !== '') {
      desc = String(p.description).trim();
    }
    return {
      name: p.name || '未命名景點',
      type: p.type || '',
      type_label: displayPlaceTypeLabel(p),
      km: km,
      description: desc,
      mapHref: mapHref,
      mapLinkIsCoords: mapLinkIsCoords
    };
  });
  var placeTypeSet = {};
  placeItems.forEach(function (x) {
    if (x.type) {
      placeTypeSet[String(x.type)] = true;
    }
  });
  var placeTypes = Object.keys(placeTypeSet).sort();
  var mapOpenUrl = venueMapOpenUrl(v);
  var mapEmbedUrl = venueMapEmbedUrl(v);
  var mapSection = '';
  if (mapOpenUrl || mapEmbedUrl) {
    mapSection =
      '<section class="venue-block venue-map-section">' +
      '<h2 id="venue-map-heading" class="venue-anchor-heading">地圖</h2>' +
      '<div class="venue-map-actions">' +
      (mapOpenUrl
        ? '<a class="btn-map btn-map--primary" href="' +
          escapeHtml(mapOpenUrl) +
          '" target="_blank" rel="noopener noreferrer">在 Google 地圖開啟</a>'
        : '') +
      '</div>' +
      (mapEmbedUrl
        ? '<div class="venue-map-frame-wrap"><iframe class="venue-map-frame" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="' +
          escapeHtml(mapEmbedUrl) +
          '" title="' +
          escapeHtml(displayVenueName(v) + ' 地圖') +
          '"></iframe></div>'
        : '') +
      '</section>';
  }

  main.innerHTML =
    '<header class="detail-header detail-header--venue"><a href="#/" class="back">' +
    msIcon('arrow_back', 'back__icon') +
    '返回</a>' +
    '<div class="detail-header__title-row">' +
    '<h1>' +
    escapeHtml(displayVenueName(v)) +
    '</h1>' +
    '<nav class="venue-jump-nav" aria-label="場館段落快速跳轉">' +
    '<button type="button" class="venue-jump-btn" data-target="venue-map-heading">' +
    msIcon('map', 'venue-jump-btn__icon') +
    '地圖</button>' +
    '<button type="button" class="venue-jump-btn" data-target="venue-nearby-heading">' +
    msIcon('explore', 'venue-jump-btn__icon') +
    '附近推薦</button>' +
    '<button type="button" class="venue-jump-btn" data-target="venue-matches-heading">' +
    msIcon('sports', 'venue-jump-btn__icon') +
    '賽事</button>' +
    '</nav></div>' +
    '<p class="meta-line">' +
    escapeHtml(v.city || '') +
    ' ' +
    escapeHtml(v.country || '') +
    '</p></header>' +
    (mapSection
      ? '<div id="venue-map-anchor" class="venue-anchor-target">' + mapSection + '</div>'
      : '') +
    '<section id="venue-nearby-anchor" class="venue-block venue-nearby-section venue-anchor-target"><h2 id="venue-nearby-heading" class="venue-anchor-heading">附近景點</h2>' +
    '<p class="hint">顯示與此場館同縣市或 20 公里內的景點，可再依距離、類型篩選。</p>' +
    (placeItems.length
      ? '<div class="place-filters">' +
        '<label class="place-filter-item">距離' +
        '<select id="place-distance-filter">' +
        '<option value="">全部</option>' +
        '<option value="3">3 km 內</option>' +
        '<option value="10">10 km 內</option>' +
        '<option value="20">20 km 內</option>' +
        '<option value="known">僅有距離的項目</option>' +
        '</select></label>' +
        '<label class="place-filter-item">類型' +
        '<select id="place-type-filter">' +
        '<option value="">全部</option>' +
        placeTypes
          .map(function (t) {
            return (
              '<option value="' +
              escapeHtml(t) +
              '">' +
              escapeHtml(placeTypeLabelById(t)) +
              '</option>'
            );
          })
          .join('') +
        '</select></label>' +
        '</div>' +
        '<ul class="place-filter-list" id="place-filter-list"></ul>'
      : '<p class="empty">目前沒有符合條件的景點和餐飲，歡迎投稿推薦。</p>') +
    '</section>' +
    '<section id="venue-matches-anchor" class="venue-block venue-matches-section venue-anchor-target"><h2 id="venue-matches-heading" class="venue-anchor-heading">賽事</h2>' +
    buildVenueMatchFilterBarHtml() +
    '<div id="venue-matches-content"></div></section>';

  main.querySelectorAll('.venue-jump-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-target');
      var topHeader = document.querySelector('.top-header');
      var detailHeader = main.querySelector('.detail-header--venue');
      var topHeaderH = topHeader ? topHeader.getBoundingClientRect().height : 0;
      var detailHeaderH = detailHeader ? detailHeader.getBoundingClientRect().height : 0;
      var offset = topHeaderH + detailHeaderH + 8;

      var el = targetId ? document.getElementById(targetId) : null;
      if (!el) {
        return;
      }
      var r2 = el.getBoundingClientRect();
      var y2 = window.pageYOffset + r2.top - offset;
      window.scrollTo({ top: Math.max(0, y2), behavior: 'smooth' });
    });
  });

  populateVenuePageMatchFilters(id);
  syncVenueMatchesList(id);
  wireVenuePageMatchFilters(id);

  if (!placeItems.length) {
    return;
  }
  var distSel = $('#place-distance-filter');
  var typeSel = $('#place-type-filter');
  var listEl = $('#place-filter-list');
  if (!distSel || !typeSel || !listEl) {
    return;
  }
  function renderFilteredPlaces() {
    var distVal = distSel.value;
    var typeVal = typeSel.value;
    var list = placeItems
      .filter(function (x) {
        if (typeVal && String(x.type) !== typeVal) {
          return false;
        }
        if (!distVal) {
          return true;
        }
        if (distVal === 'known') {
          return x.km != null;
        }
        var lim = parseFloat(distVal);
        if (isNaN(lim)) {
          return true;
        }
        return x.km != null && x.km <= lim;
      })
      .slice()
      .sort(function (a, b) {
        var ak = a.km == null ? Number.POSITIVE_INFINITY : a.km;
        var bk = b.km == null ? Number.POSITIVE_INFINITY : b.km;
        return ak - bk;
      });
    if (!list.length) {
      listEl.innerHTML = '<li class="place-filter-empty">沒有符合篩選的項目</li>';
      return;
    }
    listEl.innerHTML = list
      .map(function (x) {
        var distText = x.km != null ? '約 ' + x.km.toFixed(1) + ' km' : '距離未知';
        var mapA11y = '在 Google 地圖開啟';
        var mapCell =
          x.mapHref !== ''
            ? '<a class="place-map-link" href="' +
              escapeHtml(x.mapHref) +
              '" target="_blank" rel="noopener noreferrer" title="' +
              escapeHtml(mapA11y) +
              '" aria-label="' +
              escapeHtml(mapA11y) +
              '">' +
              msIcon('map', 'place-map-link__icon') +
              '</a>'
            : '';
        var descBlock =
          x.description !== ''
            ? '<p class="place-desc">' + escapeHtml(x.description) + '</p>'
            : '';
        return (
          '<li class="place-filter-row">' +
          '<div class="place-filter-row__head" role="group" aria-label="景點摘要">' +
          placeTypeIconHtml(x.type, x.type_label) +
          '<span class="place-name place-name--inline">' +
          escapeHtml(x.name) +
          '</span>' +
          '<span class="place-meta place-meta--inline">' +
          escapeHtml(distText) +
          '</span>' +
          mapCell +
          '</div>' +
          descBlock +
          '</li>'
        );
      })
      .join('');
  }
  distSel.addEventListener('change', renderFilteredPlaces);
  typeSel.addEventListener('change', renderFilteredPlaces);
  renderFilteredPlaces();
}

function renderSubmit() {
  var main = $('#view-submit');
  var action = escapeHtml(API_BASE);
  main.innerHTML =
    '<header class="detail-header"><a href="#/" class="back">' +
    msIcon('arrow_back', 'back__icon') +
    '返回</a>' +
    '<h1>投稿賽事</h1>' +
    '<p class="hint">送出後由管理員審核，通過後會出現在賽事清單。</p></header>' +
    submitTypeNavHtml(false) +
    '<form id="pending-form" class="submit-form" method="POST" action="' +
    action +
    '" target="gp_submit_target" accept-charset="UTF-8">' +
    '<label class="hp" aria-hidden="true">勿填<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>' +
    '<label><span class="label-main">運動種類 <span style="color:var(--red)">*</span></span>' +
    '<input type="text" name="sport" required placeholder="例：足球、排球" maxlength="80" /></label>' +
    '<label><span class="label-main">聯盟名稱（選填）</span>' +
    '<input type="text" name="league_name" placeholder="聯盟或賽事名稱" maxlength="120" /></label>' +
    '<div class="row2">' +
    '<label><span class="label-main">主隊名稱 <span style="color:var(--red)">*</span></span>' +
    '<input type="text" name="home_team_name" required maxlength="120" /></label>' +
    '<label><span class="label-main">客隊名稱 <span style="color:var(--red)">*</span></span>' +
    '<input type="text" name="away_team_name" required maxlength="120" /></label>' +
    '</div>' +
    '<label><span class="label-main">場館名稱 <span style="color:var(--red)">*</span></span>' +
    '<input type="text" name="venue_name" required placeholder="與球場／場館正式名稱一致為佳" maxlength="160" /></label>' +
    '<div class="row2">' +
    '<label><span class="label-main">日期 <span style="color:var(--red)">*</span></span>' +
    '<input type="date" name="date" required /></label>' +
    '<label><span class="label-main">時間 <span style="color:var(--red)">*</span></span>' +
    '<input type="time" name="time" required /></label>' +
    '</div>' +
    '<label><span class="label-main">轉播連結（選填）</span>' +
    '<input type="text" name="live_url" placeholder="https://…（轉播或直播頁網址）" maxlength="500" autocomplete="url" /></label>' +
    '<label><span class="label-main">投稿者（選填）</span>' +
    '<input type="text" name="submitter" placeholder="暱稱（將列於投稿者名單）" maxlength="120" /></label>' +
    '<label><span class="label-main">備註（選填）</span>' +
    '<textarea name="note" maxlength="2000" placeholder="售票資訊、補充說明等"></textarea></label>' +
    '<div class="submit-actions">' +
    '<button type="submit" class="btn-primary">送出投稿</button>' +
    '<span id="submit-status" role="status"></span>' +
    '</div>' +
    '</form>';
}

function renderSubmitPlaces() {
  var main = $('#view-submit');
  var action = escapeHtml(API_BASE);
  main.innerHTML =
    '<header class="detail-header"><a href="#/" class="back">' +
    msIcon('arrow_back', 'back__icon') +
    '返回</a>' +
    '<h1>投稿景點</h1>' +
    '<p class="hint">送出後會<strong>直接公開</strong>在景點資料中。請貼上 Google 地圖的<strong>分享連結</strong>，我們會自動取得座標。</p></header>' +
    submitTypeNavHtml(true) +
    '<form id="places-form" class="submit-form" method="POST" action="' +
    action +
    '" target="gp_submit_target" accept-charset="UTF-8">' +
    '<input type="hidden" name="submit_target" value="places" />' +
    '<label class="hp" aria-hidden="true">勿填<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>' +
    '<label><span class="label-main">名稱 <span style="color:var(--red)">*</span></span>' +
    '<input type="text" name="name" required placeholder="景點／店名" maxlength="200" /></label>' +
    '<label class="place-submit-type-label"><span class="label-main">類型 <span style="color:var(--red)">*</span></span>' +
    placeSubmitTypeFieldHtml() +
    '</label>' +
    '<label><span class="label-main">城市／地區 <span style="color:var(--red)">*</span></span>' +
    '<input type="text" name="city" required placeholder="例：台北市" maxlength="80" /></label>' +
    '<label><span class="label-main">Google 地圖連結 <span style="color:var(--red)">*</span></span>' +
    '<input type="text" name="map_url" required placeholder="貼上 Google 地圖「分享」產生的連結" maxlength="2000" autocomplete="url" /></label>' +
    '<label><span class="label-main">說明（選填）</span>' +
    '<textarea name="description" maxlength="2000" placeholder="營業時間、推薦理由等"></textarea></label>' +
    '<label><span class="label-main">投稿者（選填）</span>' +
    '<input type="text" name="submitter" placeholder="暱稱（將列於投稿者名單）" maxlength="120" /></label>' +
    '<div class="submit-actions">' +
    '<button type="submit" class="btn-primary">送出景點</button>' +
    '<span id="submit-status" role="status"></span>' +
    '</div>' +
    '</form>';
  wirePlacesSubmitTypeSelect(main);
}

function renderAbout() {
  var main = document.getElementById('view-about');
  if (!main) {
    return;
  }
  var blocks = [];
  blocks.push(
    '<header class="static-header"><a href="#/" class="back">' +
      msIcon('arrow_back', 'back__icon') +
      '返回</a>' +
      '<h1>關於</h1>' +
      '</header>' +
      '<section class="detail-panel">' +
      '<h2 class="detail-panel__title">關於</h2>' +
      '<p>嗨！歡迎來到「出門看球！觀賽行程規劃小幫手」。這是個幫助你規劃出門看球行程的網頁。</p>' +
      '<p>我是個斷斷續續看球十多年的中度運動迷，但也是個懶得出門、能量非常低的大 I 人。不過在 2024 年 12 強棒球賽時，我因為棒球迷的熱情，受到了不小衝擊，深深感覺到自己真的該出門看球，現場應援了！</p>' +
      '<p>話雖如此，但當我真的試著出門看球時，發現因為種種因素，還滿不容易的 🥹 於是藉助 AI 之力，詠唱了這個小工具。</p>' +
      '<p>如前所述，這畢竟是個鼓勵出門看比賽的小工具，因此是以「場地」為核心製作的。不只可以看到附近場館的賽事，也會有場館周邊的行程推薦。</p>' +
      '<p>因為這是個人籌備的小小工具，資料還滿少的，因此邀請各位一起加入資料建置。目前還只收錄「木蘭聯賽」，但歡迎其他層級、其他運動、其他聯盟的賽事，包含國際賽的投稿。不過畢竟設計時只針對單一聯賽，當資料越來越龐大時，前端的呈現方式也還得思考。當然，這不是現在的首要問題。</p>' +
      '<p>你可以透過「投稿」的方式新增賽事、景點等等資料。我也將程式碼放在 <a href="https://github.com/johnnyhsu/out-to-watch-ball">GitHub</a> 上並使用 <a href="https://choosealicense.com/licenses/gpl-3.0/">GPL-3.0</a> 授權，歡迎你取用，並改成更好用的樣子。</p>' +
      '<p>我不是設計師，更沒有軟體背景，這個純詠唱完成的頁面勢必有所缺漏、不一定好用，請多多包涵。我也是有可能哪天看他不順眼，大改一波。有機會的話，也希望把球隊和球員的基本資料補上，前提是有時間的話🫣</p>' +
      '<p>最後，希望各位都能開心看球，也希望選手們感受到球迷們的愛✨</p>' +
      '</section>'
  );
  blocks.push(
    '<section class="detail-panel" id="about-contrib">' +
      '<h2 class="detail-panel__title">感謝貢獻者</h2>' +
      '<p class="hint">感謝以下提供資料的朋友們。本份資料為自動更新。</p>' +
      '<div class="contrib-grid">' +
      '<div class="contrib-col"><h3 class="contrib-col__title">景點投稿</h3><div id="about-contrib-places"><p class="empty empty--tight"><span class="loading-text">載入中</span></p></div></div>' +
      '<div class="contrib-col"><h3 class="contrib-col__title">賽事投稿</h3><div id="about-contrib-matches"><p class="empty empty--tight"><span class="loading-text">載入中</span></p></div></div>' +
      '</div>' +
      '</section>'
  );
  main.innerHTML = blocks.join('');
  renderAboutContributors_();
}

async function renderAboutContributors_() {
  var boxPlaces = document.getElementById('about-contrib-places');
  var boxMatches = document.getElementById('about-contrib-matches');
  if (!boxPlaces || !boxMatches) {
    return;
  }

  try {
    var placeNames = uniqNonEmptyStrings_(
      (state.places || []).map(function (p) {
        return p && p.submitter != null ? String(p.submitter) : '';
      })
    ).sort(function (a, b) {
      return a.localeCompare(b, 'zh-Hant');
    });

    var pendingNames = [];
    try {
      var res = await fetchResource('matches_pending');
      if (res && res.ok && Array.isArray(res.data)) {
        pendingNames = uniqNonEmptyStrings_(
          res.data.map(function (m) {
            return m && m.submitter != null ? String(m.submitter) : '';
          })
        ).sort(function (a, b) {
          return a.localeCompare(b, 'zh-Hant');
        });
      } else {
        pendingNames = [];
      }
    } catch (e2) {
      pendingNames = [];
    }

    boxPlaces.innerHTML = placeNames.length
      ? '<ul class="contrib-list">' +
        placeNames.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') +
        '</ul>'
      : '<p class="empty empty--tight">尚無</p>';

    boxMatches.innerHTML = pendingNames.length
      ? '<ul class="contrib-list">' +
        pendingNames.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') +
        '</ul>'
      : '<p class="empty empty--tight">尚無</p>';
  } catch (e1) {
    boxPlaces.innerHTML = '<p class="empty empty--tight">暫時無法載入</p>';
    boxMatches.innerHTML = '<p class="empty empty--tight">暫時無法載入</p>';
  }
}

function renderGuide() {
  var main = document.getElementById('view-guide');
  if (!main) {
    return;
  }
  main.innerHTML =
    '<header class="static-header"><a href="#/" class="back">' +
    msIcon('arrow_back', 'back__icon') +
    '返回</a>' +
    '<h1>操作</h1>' +
    '</header>' +
    '<section class="detail-panel">' +
    '<h2 class="detail-panel__title">快速開始</h2>' +
    '<ul class="guide-list">' +
    '<li><strong>找賽事</strong>：在首頁用「地區／運動／球場／聯盟／時間」篩選，或用搜尋框找隊名。</li>' +
    '<li><strong>看賽事詳情</strong>：點一場賽事可查看時間、場館、聯盟與轉播連結（若有）。</li>' +
    '<li><strong>快速分享</strong>：賽事卡片右下角有 <strong>SHARE</strong>（可點按），可直接開啟分享賽事編輯器並下載 PNG。</li>' +
    '<li><strong>快速開直播</strong>：若該場次有直播連結，賽事卡片左下角會顯示 <strong>LIVE</strong>（可點按）直接開啟直播。</li>' +
    '<li><strong>看場館</strong>：在賽事詳情點「查看球場」，可看地圖、近期賽事與附近景點。</li>' +
    '<li><strong>分享賽事（賽事詳情）</strong>：「賽事資訊」區塊右下角可找到「分享賽事」按鈕。</li>' +
    '<li><strong>附近模式</strong>：切到「附近」可用你的大致位置依距離瀏覽（需允許定位）。</li>' +
    '<li><strong>備註</strong>：本頁面賽事資料為純手動，確切賽事資訊請以賽事官網公告文準。</li>' +
    '</ul>' +
    '</section>' +
    '<section class="detail-panel">' +
    '<h2 class="detail-panel__title">分享賽事</h2>' +
    '<ul class="guide-list">' +
    '<li><strong>預覽</strong>：左側即時預覽輸出圖片。</li>' +
    '<li><strong>版型</strong>：可選「資訊／比數／照片資訊／照片比數」。</li>' +
    '<li><strong>照片</strong>：選擇照片後會套用到照片區塊；未選擇時會顯示提示。</li>' +
    '<li><strong>隱私</strong>：你選擇的照片只會在本機瀏覽器內用於預覽與產圖下載，不會上傳到任何網路空間。</li>' +
    '<li><strong>標籤</strong>：可選 <strong>HT / FT / 無</strong>。</li>' +
    '<li><strong>分數</strong>：輸入主場與客場分數（僅比數版型會顯示）。</li>' +
    '<li><strong>下載</strong>：點「下載 PNG」會將圖片存到本機。</li>' +
    '</ul>' +
    '</section>' +
    '<section class="detail-panel">' +
    '<h2 class="detail-panel__title">投稿</h2>' +
    '<ul class="guide-list">' +
    '<li><strong>投稿賽事</strong>：提供隊伍、場館、日期時間等資訊；送出後會先審核再上架。因目前只有一人維護，審核需要一點時間。</li>' +
    '<li><strong>投稿景點</strong>：提供名稱、類型、城市與 Google 地圖分享連結；送出後會直接更新到景點資料中。</li>' +
    '</ul>' +
    '</section>';
}

function initSubmitHandlersOnce() {
  var host = $('#view-submit');
  var iframe = $('#gp_submit_target');
  if (!host || !iframe || host.dataset.submitWired === '1') {
    return;
  }
  host.dataset.submitWired = '1';

  async function refreshPlacesAfterSubmit_() {
    try {
      var places = await loadPlaces();
      state.places = enrichPlacesWithTypeLabels(places, state.placeTypes);
      // 若正在場館頁，附近景點清單也一併更新
      var r = parseHash();
      if (r && r.parts && r.parts[0] === 'venues' && r.parts[1]) {
        renderVenueDetail(decodeURIComponent(r.parts[1]));
      }
    } catch (e) {
      // ignore (保持現狀)
    }
  }

  host.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (!form || (form.id !== 'pending-form' && form.id !== 'places-form')) {
      return;
    }
    if (form.id === 'places-form') {
      form.setAttribute('target', 'gp_submit_target');
      var mapEl = form.querySelector('input[name="map_url"]');
      var entered = normalizePlaceMapUrlForDupWarn_(mapEl && mapEl.value);
      if (entered) {
        var dup = (state.places || []).some(function (p) {
          var have = normalizePlaceMapUrlForDupWarn_(p && p.map_url);
          return have !== '' && have === entered;
        });
        if (dup) {
          var ok = window.confirm(
            '提醒：這個 Google 地圖連結看起來已經有人投稿過了。\n\n仍要送出嗎？'
          );
          if (!ok) {
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          var st0 = document.getElementById('submit-status');
          if (st0) {
            st0.textContent = '提醒：此地圖連結疑似已存在，仍將送出…';
            st0.className = '';
          }
        }
      }
    }
    lastSubmittedFormId = form.id;
    expectingPendingResponse = true;
    var st = $('#submit-status');
    if (st) {
      st.textContent = '送出中…';
      st.className = '';
    }
    var btn = form.querySelector('.btn-primary');
    if (btn) {
      btn.disabled = true;
    }
  });
  iframe.addEventListener('load', function () {
    if (!expectingPendingResponse) {
      return;
    }
    expectingPendingResponse = false;
    var st = $('#submit-status');
    var fid = lastSubmittedFormId;
    lastSubmittedFormId = null;
    var form = fid ? document.getElementById(fid) : null;
    if (st) {
      if (fid === 'places-form') {
        st.textContent = '已送出，正在更新景點資料…';
      } else {
        st.textContent = '已送出，感謝提供。我們會審核後再上架；若結果頁顯示失敗，請稍後再試。';
      }
      st.className = 'ok';
    }
    if (form) {
      form.reset();
      var btn = form.querySelector('.btn-primary');
      if (btn) {
        btn.disabled = false;
      }
    }
    if (fid === 'places-form') {
      refreshPlacesAfterSubmit_().then(function () {
        var st2 = document.getElementById('submit-status');
        if (st2 && st2.className === 'ok') {
          st2.textContent = '已送出。若未立刻看到新增，請稍候或重新整理。';
        }
      });
    }
  });
}

function showView(name) {
  document.querySelectorAll('.view').forEach(function (el) {
    el.hidden = el.dataset.view !== name;
  });
}

function scrollToTopOnRouteChange_() {
  // SPA hash 切頁時預設保留上一頁捲動位置；這裡統一重置到頁首。
  window.scrollTo(0, 0);
}

function route() {
  scrollToTopOnRouteChange_();
  var r = parseHash();
  var p = r.parts;
  if (p[0] === 'matches' && p[1]) {
    showView('match');
    renderMatchDetail(decodeURIComponent(p[1]));
    return;
  }
  if (p[0] === 'venues' && p[1]) {
    showView('venue');
    renderVenueDetail(decodeURIComponent(p[1]));
    return;
  }
  if (p[0] === 'submit') {
    showView('submit');
    if (p[1] === 'places') {
      renderSubmitPlaces();
    } else {
      renderSubmit();
    }
    return;
  }
  if (p[0] === 'guide') {
    showView('guide');
    renderGuide();
    return;
  }
  if (p[0] === 'about') {
    showView('about');
    renderAbout();
    return;
  }
  showView('explore');
  renderExplore();
}

var matchCardCornerHandlersBound_ = false;

function bindMatchCardCornerHandlersOnce_() {
  if (matchCardCornerHandlersBound_) return;
  matchCardCornerHandlersBound_ = true;

  function handle_(targetEl, e) {
    var shareBtn = targetEl.closest('[data-match-share]');
    if (shareBtn) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      var id = shareBtn.getAttribute('data-match-share') || '';
      var m = state.matches.filter(function (x) {
        return String(x.id) === String(id);
      })[0];
      if (!m) return true;
      var pres = matchCardPresentation(m);
      var v = venueById(m.venue_id);
      openShareModalForMatch_(m, v, pres.meta);
      return true;
    }

    var liveBtn = targetEl.closest('[data-match-live]');
    if (liveBtn) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      var id2 = liveBtn.getAttribute('data-match-live') || '';
      var m2 = state.matches.filter(function (x) {
        return String(x.id) === String(id2);
      })[0];
      if (!m2) return true;
      var bc2 = getMatchBroadcastFields(m2);
      var href2 = matchLiveDetailHref(bc2 && bc2.live_url);
      if (href2) {
        window.open(href2, '_blank', 'noopener,noreferrer');
      }
      return true;
    }
    return false;
  }

  document.addEventListener('click', function (e) {
    handle_(e.target, e);
  });

  document.addEventListener('keydown', function (e) {
    if (!(e.key === 'Enter' || e.key === ' ')) return;
    var t = e.target;
    if (!t) return;
    if (t.matches && (t.matches('[data-match-share]') || t.matches('[data-match-live]'))) {
      handle_(t, e);
    }
  });
}

async function bootstrap() {
  state.loading = true;
  state.error = null;
  renderExplore();
  bindMatchCardCornerHandlersOnce_();
  try {
    var results = await Promise.all([
      loadVenues(),
      loadPlaces(),
      loadTeams(),
      loadLeagues(),
      loadSports(),
      loadPlaceTypes()
    ]);
    state.venues = results[0];
    state.places = enrichPlacesWithTypeLabels(results[1], results[5]);
    state.teams = results[2];
    state.leagues = results[3];
    state.sports = results[4];
    state.placeTypes = results[5];
    var pack = await loadMatchesPreferComplete(state.teams, state.venues, state.sports);
    state.matches = pack.matches;
    state.matchDataSource = pack.source || '';
    state.loading = false;
    renderHeaderCities();
    renderSportFilter();
    renderLeagueFilter();
    renderYearMonthSeasonStatusFilters();
    renderVenueFilter();
    route();
  } catch (e) {
    state.loading = false;
    state.error = e && e.message ? e.message : String(e);
    route();
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.geoError = null;
        if (state.mode === 'nearby') {
          renderExplore();
        }
      },
      function () {
        state.geoError = '無法取得你的位置，「附近」模式無法使用。請在瀏覽器設定中允許此網站使用定位。';
        if (state.mode === 'nearby') {
          renderExplore();
        }
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    );
  } else {
    state.geoError = '此瀏覽器不支援定位，無法使用「附近」模式。';
  }
}

function wireUi() {
  var filterPanel = document.getElementById('filter-panel');
  var filterPanelToggle = document.getElementById('filter-panel-toggle');
  if (filterPanel && filterPanelToggle) {
    filterPanelToggle.addEventListener('click', function () {
      filterPanel.classList.toggle('is-collapsed');
      var open = !filterPanel.classList.contains('is-collapsed');
      filterPanelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  $('#city-select').addEventListener('change', function () {
    state.city = this.value;
    renderExplore();
  });
  $('#sport-select').addEventListener('change', function () {
    state.sport = this.value;
    renderExplore();
  });
  $('#league-select').addEventListener('change', function () {
    state.leagueId = this.value;
    renderExplore();
  });
  $('#venue-select').addEventListener('change', function () {
    state.venueId = this.value;
    renderExplore();
  });
  $('#team-filter').addEventListener('input', function () {
    state.teamQuery = this.value.trim();
    renderExplore();
  });
  var fy = $('#filter-year');
  var fm = $('#filter-month');
  var fs = $('#filter-season');
  var fst = $('#filter-status');
  if (fy) {
    fy.addEventListener('change', function () {
      state.filterYear = this.value;
      renderExplore();
    });
  }
  if (fm) {
    fm.addEventListener('change', function () {
      state.filterMonth = this.value;
      renderExplore();
    });
  }
  if (fs) {
    fs.addEventListener('change', function () {
      state.filterSeason = this.value;
      renderExplore();
    });
  }
  if (fst) {
    fst.addEventListener('change', function () {
      state.filterStatus = this.value;
      renderExplore();
    });
  }
  document.querySelectorAll('.mode-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.mode = btn.dataset.mode;
      renderExplore();
    });
  });
  var navGuide = document.getElementById('nav-guide');
  if (navGuide) {
    navGuide.addEventListener('click', function (e) {
      e.preventDefault();
      setHash('/guide');
    });
  }
  var navAbout = document.getElementById('nav-about');
  if (navAbout) {
    navAbout.addEventListener('click', function (e) {
      e.preventDefault();
      setHash('/about');
    });
  }
  $('#nav-submit').addEventListener('click', function (e) {
    e.preventDefault();
    setHash('/submit');
  });
}

window.addEventListener('hashchange', route);

wireUi();
initSubmitHandlersOnce();
bootstrap();
