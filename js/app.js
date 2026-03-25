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
  var lat = parseFloat(v.lat);
  var lng = parseFloat(v.lng);
  if (isNaN(lat) || isNaN(lng)) {
    return null;
  }
  return { lat: lat, lng: lng };
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
  return (
    '<li class="match-list__item">' +
    '<a class="match-card ' +
    pres.modifier +
    '" href="#/matches/' +
    encodeURIComponent(m.id) +
    '">' +
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
      var iconName = placeTypeToMaterialIcon(lab + ' ' + id);
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
    if (!v || v.lat === '' || v.lng === '' || v.lat == null || v.lng == null) {
      return;
    }
    var lat = parseFloat(v.lat);
    var lng = parseFloat(v.lng);
    if (isNaN(lat) || isNaN(lng)) {
      return;
    }
    var km = haversineKm(state.userPos.lat, state.userPos.lng, lat, lng);
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
    content.innerHTML = '<p class="empty">載入中…</p>';
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
  var headerActions = matchDetailHeaderActionsHtml(m, v);
  main.innerHTML =
    '<header class="detail-header detail-header--match">' +
    '<a href="#/" class="back">' +
    msIcon('arrow_back', 'back__icon') +
    '返回</a>' +
    '<div class="detail-header__title-row">' +
    '<div class="detail-header__title-stack">' +
    '<h1>' +
    escapeHtml(displayMatchTitle(m)) +
    '</h1>' +
    '<p class="meta-line">' +
    escapeHtml(formatTime(m.start_time)) +
    ' · ' +
    escapeHtml(displaySportLabel(m)) +
    '</p>' +
    '<p class="status-line"><span class="status-dot ' +
    meta.dotClass +
    '"></span>' +
    escapeHtml(meta.label) +
    '</p></div>' +
    headerActions +
    '</div></header>' +
    '<section class="detail-matchup" aria-label="對戰隊伍">' +
    '<div class="detail-matchup__col detail-matchup__col--home">' +
    '<span class="detail-matchup__label">主場</span>' +
    '<span class="detail-matchup__name">' +
    escapeHtml(homeNm) +
    '</span></div>' +
    '<div class="detail-matchup__mid" aria-hidden="true">' +
    '<span class="detail-matchup__vs">對</span>' +
    '</div>' +
    '<div class="detail-matchup__col detail-matchup__col--away">' +
    '<span class="detail-matchup__label">客場</span>' +
    '<span class="detail-matchup__name">' +
    escapeHtml(awayNm) +
    '</span></div></section>' +
    '<section class="detail-panel" aria-labelledby="match-detail-info-heading">' +
    '<h2 id="match-detail-info-heading" class="detail-panel__title">賽事資訊</h2>' +
    '<dl class="detail-dl">' +
    detailRow('場館', displayVenueName(v, m.venue_name)) +
    detailRow('城市', (v && v.city) || m.venue_city || '') +
    detailRow('聯盟', displayLeagueName(m)) +
    detailLiveRow(m) +
    detailRow('備註', m.note || '') +
    '</dl></section>';
}

/** 賽事詳情 header 右側：查看球場、觀看直播 */
function matchDetailHeaderActionsHtml(m, v) {
  var parts = [];
  if (m.venue_id != null && String(m.venue_id).trim() !== '') {
    parts.push(
      '<a class="btn-secondary btn-secondary--header" href="#/venues/' +
        encodeURIComponent(String(m.venue_id).trim()) +
        '">查看球場</a>'
    );
  }
  var bc = getMatchBroadcastFields(m);
  var liveHref = matchLiveDetailHref(bc.live_url);
  if (liveHref) {
    parts.push(
      '<a class="btn-detail-live btn-detail-live--header" href="' +
        escapeHtml(liveHref) +
        '" target="_blank" rel="noopener noreferrer">觀看直播</a>'
    );
  }
  if (!parts.length) {
    return '';
  }
  return (
    '<nav class="detail-header__actions" aria-label="快捷操作">' + parts.join('') + '</nav>'
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
    var plat = parseFloat(p.lat);
    var plng = parseFloat(p.lng);
    var distOk = false;
    if (venuePoint && !isNaN(plat) && !isNaN(plng)) {
      var d = haversineKm(venuePoint.lat, venuePoint.lng, plat, plng);
      distOk = d <= VENUE_NEARBY_PLACES_MAX_KM;
    }
    return cityOk || distOk;
  });
  var placeItems = venueNearbyPlaces.map(function (p) {
    var lat = parseFloat(p.lat);
    var lng = parseFloat(p.lng);
    var hasPoint = !isNaN(lat) && !isNaN(lng);
    var km =
      venuePoint && hasPoint ? haversineKm(venuePoint.lat, venuePoint.lng, lat, lng) : null;
    var mapFromSheet = normalizeHttpUrl(p.map_url);
    var mapHref = mapFromSheet;
    var mapLinkIsCoords = false;
    if (!mapHref && hasPoint) {
      mapHref =
        'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent(lat + ',' + lng);
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
      '<h2>地圖</h2>' +
      '<div class="venue-map-actions">' +
      (mapOpenUrl
        ? '<a class="btn-map btn-map--primary" href="' +
          escapeHtml(mapOpenUrl) +
          '" target="_blank" rel="noopener noreferrer">在 Google 地圖開啟</a>'
        : '') +
      (mapOpenUrl
        ? '<a class="btn-map btn-map--secondary" href="' +
          escapeHtml(mapOpenUrl) +
          '" target="_blank" rel="noopener noreferrer">導航 / 路線規劃</a>'
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
    '<button type="button" class="venue-jump-btn" data-target="venue-map-anchor">' +
    msIcon('map', 'venue-jump-btn__icon') +
    '地圖</button>' +
    '<button type="button" class="venue-jump-btn" data-target="venue-nearby-anchor">' +
    msIcon('explore', 'venue-jump-btn__icon') +
    '附近推薦</button>' +
    '<button type="button" class="venue-jump-btn" data-target="venue-matches-anchor">' +
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
    '<section id="venue-nearby-anchor" class="venue-block venue-nearby-section venue-anchor-target"><h2>附近景點</h2>' +
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
      : '<p class="empty">目前沒有符合條件的景點。</p>') +
    '</section>' +
    '<section id="venue-matches-anchor" class="venue-block venue-matches-section venue-anchor-target"><h2>賽事</h2>' +
    buildVenueMatchFilterBarHtml() +
    '<div id="venue-matches-content"></div></section>';

  main.querySelectorAll('.venue-jump-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-target');
      var el = targetId ? document.getElementById(targetId) : null;
      if (!el) {
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      '<p>嗨！歡迎來到「出門看球！」小工具。這是個幫助你規劃出門看球行程的網頁。</p>' +
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
      '<div class="contrib-col"><h3 class="contrib-col__title">景點投稿</h3><div id="about-contrib-places"><p class="empty empty--tight">載入中…</p></div></div>' +
      '<div class="contrib-col"><h3 class="contrib-col__title">賽事投稿</h3><div id="about-contrib-matches"><p class="empty empty--tight">載入中…</p></div></div>' +
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
    '<h1>使用說明</h1>' +
    '</header>' +
    '<section class="detail-panel">' +
    '<h2 class="detail-panel__title">快速開始</h2>' +
    '<ul class="guide-list">' +
    '<li><strong>找賽事</strong>：在首頁用「地區／運動／球場／聯盟／時間」篩選，或用搜尋框找隊名。</li>' +
    '<li><strong>看賽事詳情</strong>：點一場賽事可查看時間、場館、聯盟與轉播連結（若有）。</li>' +
    '<li><strong>看場館</strong>：在賽事詳情點「查看球場」，可看地圖、近期賽事與附近景點。</li>' +
    '<li><strong>附近模式</strong>：切到「附近」可用你的大致位置依距離瀏覽（需允許定位）。</li>' +
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

function route() {
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

async function bootstrap() {
  state.loading = true;
  state.error = null;
  renderExplore();
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
