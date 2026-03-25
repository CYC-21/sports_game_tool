import { API_BASE } from './config.js';
import { enrichMatches } from './enrich.js';
import { fetchGvizTable, matchObjectsFromGvizTable, objectsFromGvizTable } from './gviz.js';

/**
 * 透過 JSONP 取得 API（避免 GitHub Pages → script.google.com 的 CORS）。
 */
export function fetchResource(resource) {
  return new Promise(function (resolve, reject) {
    var name = 'gp_cb_' + Math.random().toString(36).slice(2, 11);
    var script = document.createElement('script');
    var timer = setTimeout(function () {
      cleanup();
      reject(new Error('Request timed out'));
    }, 25000);

    window[name] = function (payload) {
      clearTimeout(timer);
      cleanup();
      resolve(payload);
    };

    function cleanup() {
      delete window[name];
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    var sep = API_BASE.indexOf('?') >= 0 ? '&' : '?';
    script.src =
      API_BASE + sep + 'resource=' + encodeURIComponent(resource) + '&callback=' + encodeURIComponent(name);
    script.onerror = function () {
      clearTimeout(timer);
      cleanup();
      reject(new Error('Failed to load script'));
    };
    document.head.appendChild(script);
  });
}

export async function loadMatches() {
  var res = await fetchResource('matches');
  if (!res || !res.ok) {
    throw new Error((res && res.error) || 'matches API error');
  }
  return res.data || [];
}

export async function loadVenues() {
  var res = await fetchResource('venues');
  if (!res || !res.ok) {
    throw new Error((res && res.error) || 'venues API error');
  }
  return res.data || [];
}

export async function loadPlaces() {
  var res = await fetchResource('places');
  if (!res || !res.ok) {
    throw new Error((res && res.error) || 'places API error');
  }
  return res.data || [];
}

export async function loadTeams() {
  var res = await fetchResource('teams');
  if (!res || !res.ok) {
    throw new Error((res && res.error) || 'teams API error');
  }
  return res.data || [];
}

export async function loadLeagues() {
  try {
    var res = await fetchResource('leagues');
    if (res && res.ok && Array.isArray(res.data)) {
      return res.data;
    }
  } catch (e1) {
    console.warn('[leagues] API 失敗，改用 gviz', e1 && e1.message ? e1.message : e1);
  }
  try {
    var table = await fetchGvizTable('leagues');
    return objectsFromGvizTable(table);
  } catch (e2) {
    console.warn('[leagues] gviz 失敗', e2 && e2.message ? e2.message : e2);
  }
  return [];
}

export async function loadSports() {
  try {
    var res = await fetchResource('sports');
    if (res && res.ok && Array.isArray(res.data)) {
      return res.data;
    }
  } catch (e1) {
    console.warn('[sports] API 失敗，改用 gviz', e1 && e1.message ? e1.message : e1);
  }
  try {
    var table = await fetchGvizTable('sports');
    return objectsFromGvizTable(table);
  } catch (e2) {
    console.warn('[sports] gviz 失敗', e2 && e2.message ? e2.message : e2);
  }
  return [];
}

export async function loadPlaceTypes() {
  try {
    var res = await fetchResource('place_types');
    if (res && res.ok && Array.isArray(res.data)) {
      return res.data;
    }
  } catch (e1) {
    console.warn('[place_types] API 失敗，改用 gviz', e1 && e1.message ? e1.message : e1);
  }
  try {
    var table = await fetchGvizTable('place_types');
    return objectsFromGvizTable(table);
  } catch (e2) {
    console.warn('[place_types] gviz 失敗', e2 && e2.message ? e2.message : e2);
  }
  return [];
}

/**
 * 先取 Apps Script matches；若 gviz 讀到更多列（常見：API 快取或舊版 .gs），改用 gviz + 前端 JOIN。
 */
export async function loadMatchesPreferComplete(teams, venues, sports) {
  var fromApi = [];
  try {
    fromApi = await loadMatches();
  } catch (e1) {
    console.warn('[matches] API 失敗', e1 && e1.message ? e1.message : e1);
  }
  var enrichedGviz = [];
  try {
    var table = await fetchGvizTable('matches');
    var raw = matchObjectsFromGvizTable(table);
    enrichedGviz = enrichMatches(raw, teams, venues, sports);
  } catch (e2) {
    console.warn('[matches] gviz 失敗', e2 && e2.message ? e2.message : e2);
  }
  if (enrichedGviz.length > fromApi.length) {
    return { matches: enrichedGviz, source: 'gviz' };
  }
  if (fromApi.length) {
    return { matches: fromApi, source: 'api' };
  }
  if (enrichedGviz.length) {
    return { matches: enrichedGviz, source: 'gviz' };
  }
  throw new Error('無法載入賽事（API 與試算表 gviz 皆失敗）');
}
