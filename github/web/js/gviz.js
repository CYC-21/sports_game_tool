import { SHEET_ID } from './config.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 以本地日曆欄位組出與試算表顯示一致的 yyyy-MM-dd HH:mm:ss */
function formatLocalYmdHms(d) {
  return (
    d.getFullYear() +
    '-' +
    pad2(d.getMonth() + 1) +
    '-' +
    pad2(d.getDate()) +
    ' ' +
    pad2(d.getHours()) +
    ':' +
    pad2(d.getMinutes()) +
    ':' +
    pad2(d.getSeconds())
  );
}

/**
 * @param {object} cell — gviz 儲存格 { v, f? }
 * @param {object} [col] — table.cols[j]，含 type；datetime 優先採用 f（試算表目前格式）
 */
function cellValue(cell, col) {
  if (!cell) {
    return '';
  }
  var colType = col && String(col.type || '').toLowerCase();
  if (
    (colType === 'datetime' || colType === 'timeofday') &&
    cell.f != null &&
    String(cell.f).trim() !== ''
  ) {
    return String(cell.f).trim();
  }
  if (colType === 'date' && cell.f != null && String(cell.f).trim() !== '') {
    return String(cell.f).trim();
  }
  if (cell.v === undefined || cell.v === null) {
    return '';
  }
  if (Object.prototype.toString.call(cell.v) === '[object Date]') {
    try {
      return formatLocalYmdHms(cell.v);
    } catch (e) {
      return String(cell.v);
    }
  }
  if (typeof cell.v === 'string') {
    var ds = cell.v.trim();
    if (/^Date\(\d+,\d+,\d+,\d+,\d+,\d+\)$/.test(ds)) {
      var inner = ds.slice(5, -1).split(',');
      var d = new Date(
        parseInt(inner[0], 10),
        parseInt(inner[1], 10),
        parseInt(inner[2], 10),
        parseInt(inner[3], 10),
        parseInt(inner[4], 10),
        parseInt(inner[5], 10)
      );
      if (!isNaN(d.getTime())) {
        return formatLocalYmdHms(d);
      }
    }
  }
  return cell.v;
}

/** gviz col.label 常為「id 唯一ID」，取第一個詞為欄位鍵（與試算表第 1 列一致） */
function headerKeyFromGvizCol(col) {
  var label = col && col.label != null ? String(col.label).trim() : '';
  if (!label) {
    return '';
  }
  var space = label.indexOf(' ');
  if (space > 0) {
    return label.substring(0, space).trim();
  }
  return label;
}

function cellHasValueJs(v) {
  if (v === null || v === undefined) {
    return false;
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return !isNaN(v.getTime());
  }
  return String(v).trim() !== '';
}

/** 與 Code.gs rowHasMatchLikeData_ 一致，供 id 空白時給 AUTO_R */
function rowHasMatchLikeDataJs(obj) {
  return (
    cellHasValueJs(obj.sport) ||
    cellHasValueJs(obj.venue_id) ||
    cellHasValueJs(obj.start_time) ||
    cellHasValueJs(obj.home_team_id) ||
    cellHasValueJs(obj.away_team_id)
  );
}

/**
 * matches 分頁：試算表 gviz 多為 table.cols 帶 label，rows 僅含資料列；
 * 少數分頁則 rows[0] 為鍵列、rows[1] 說明列（見 objectsFromGvizTable）。
 */
export function matchObjectsFromGvizTable(table) {
  var cols = table && table.cols;
  var rows = table && table.rows;
  if (!rows || !rows.length) {
    return [];
  }
  var headers = [];
  var startI = 0;
  var sheetRowForIndex;

  var hasColLabels = false;
  if (cols && cols.length) {
    for (var u = 0; u < cols.length; u++) {
      if (cols[u] && String(cols[u].label || '').trim()) {
        hasColLabels = true;
        break;
      }
    }
  }
  if (hasColLabels) {
    for (var h = 0; h < cols.length; h++) {
      headers.push(headerKeyFromGvizCol(cols[h]));
    }
    startI = 0;
    sheetRowForIndex = function (i) {
      return 3 + (i - startI);
    };
  } else {
    if (rows.length < 3) {
      return [];
    }
    var headerCells = rows[0].c || [];
    for (var h2 = 0; h2 < headerCells.length; h2++) {
      headers.push(String(cellValue(headerCells[h2], cols && cols[h2]) || '').trim());
    }
    startI = 2;
    sheetRowForIndex = function (i) {
      return i + 1;
    };
  }

  var numCols = headers.length;
  var out = [];
  for (var i = startI; i < rows.length; i++) {
    var r = rows[i];
    var c = r.c || [];
    var obj = {};
    for (var j = 0; j < numCols; j++) {
      var key = headers[j];
      if (!key) {
        continue;
      }
      var raw = cellValue(c[j], cols && cols[j]);
      obj[key] = raw === '' || raw == null ? '' : String(raw);
    }
    var idVal = obj.id != null && obj.id !== '' ? String(obj.id).trim() : '';
    if (!idVal && rowHasMatchLikeDataJs(obj)) {
      obj.id = 'AUTO_R' + sheetRowForIndex(i);
      idVal = obj.id;
    }
    if (idVal) {
      out.push(obj);
    }
  }
  return out;
}

/**
 * 通用分頁轉物件：第 1 列鍵、第 2 列說明、第 3 列起資料
 */
export function objectsFromGvizTable(table) {
  var rows = table && table.rows;
  var colsMeta = table && table.cols;
  if (!rows || rows.length < 3) {
    return [];
  }
  var headerCells = rows[0].c || [];
  var numCols = headerCells.length;
  var headers = [];
  for (var h = 0; h < numCols; h++) {
    headers.push(String(cellValue(headerCells[h], colsMeta && colsMeta[h]) || '').trim());
  }
  var out = [];
  for (var i = 2; i < rows.length; i++) {
    var r = rows[i];
    var c = r.c || [];
    var obj = {};
    var hasAnyValue = false;
    for (var j = 0; j < numCols; j++) {
      var key = headers[j];
      if (!key) {
        continue;
      }
      var raw = cellValue(c[j], colsMeta && colsMeta[j]);
      var val = raw === '' || raw == null ? '' : String(raw);
      obj[key] = val;
      if (val !== '') {
        hasAnyValue = true;
      }
    }
    if (hasAnyValue) {
      out.push(obj);
    }
  }
  return out;
}

/**
 * Google Visualization API：以 JSONP 載入試算表列（responseHandler）。
 * 試算表須設為「知道連結的使用者」可檢視，瀏覽器才讀得到。
 */
export function fetchGvizTable(sheetName) {
  return new Promise(function (resolve, reject) {
    var name = 'gp_gviz_' + Math.random().toString(36).slice(2, 11);
    name = name.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^[0-9]/.test(name)) {
      name = '_' + name;
    }
    var script = document.createElement('script');
    window[name] = function (resp) {
      try {
        delete window[name];
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        if (!resp || resp.status !== 'ok') {
          var msg =
            resp &&
            resp.errors &&
            resp.errors[0] &&
            (resp.errors[0].detailed_message || resp.errors[0].reason);
          reject(new Error(msg || 'gviz 回應異常'));
          return;
        }
        resolve(resp.table);
      } catch (err) {
        delete window[name];
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        reject(err);
      }
    };
    script.onerror = function () {
      delete window[name];
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
      reject(new Error('無法載入試算表 gviz（請確認連結已公開為可檢視）'));
    };
    var tqx = 'out:json;responseHandler:' + name;
    script.src =
      'https://docs.google.com/spreadsheets/d/' +
      SHEET_ID +
      '/gviz/tq?sheet=' +
      encodeURIComponent(sheetName) +
      '&tqx=' +
      encodeURIComponent(tqx);
    document.head.appendChild(script);
  });
}
