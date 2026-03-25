/**
 * 與 Apps Script getMatchesEnriched_ 相同邏輯（前端端內 JOIN）
 */

function normMatchHeaderKeyPart(key) {
  var s = String(key || '')
    .trim()
    .replace(/^\uFEFF/, '');
  var i = s.indexOf(' ');
  if (i > 0) {
    s = s.substring(0, i);
  }
  return s.toLowerCase().replace(/-/g, '_');
}

function extractUrlFromHyperlinkFormula(s) {
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

function pickBroadcastField(obj, canonical) {
  if (!obj) {
    return '';
  }
  var want = String(canonical).toLowerCase().replace(/-/g, '_');
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) {
      continue;
    }
    if (normMatchHeaderKeyPart(k) === want) {
      var v = obj[k];
      if (v == null || v === '') {
        return '';
      }
      return String(v).trim();
    }
  }
  return '';
}

/** 轉播欄位：對應試算表 live / live_url（標題大小寫、空格說明、liveurl、HYPERLINK 公式字串） */
export function getMatchBroadcastFields(m) {
  if (!m) {
    return { live: '', live_url: '' };
  }
  var live = pickBroadcastField(m, 'live');
  var liveUrl = pickBroadcastField(m, 'live_url') || pickBroadcastField(m, 'liveurl');
  var urlParsed = extractUrlFromHyperlinkFormula(liveUrl);
  if (urlParsed) {
    liveUrl = urlParsed;
  }
  if (!live && m.live != null && String(m.live).trim() !== '') {
    live = String(m.live).trim();
  }
  if (!liveUrl && m.live_url != null && String(m.live_url).trim() !== '') {
    var ru = String(m.live_url).trim();
    liveUrl = extractUrlFromHyperlinkFormula(ru) || ru;
  }
  return { live: live, live_url: liveUrl };
}

function seasonFromMatchRow(m) {
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

export function enrichMatches(matches, teams, venues, sports) {
  var tMap = {};
  (teams || []).forEach(function (t) {
    if (t.id !== '' && t.id != null) {
      tMap[String(t.id)] = t;
    }
  });
  var vMap = {};
  (venues || []).forEach(function (v) {
    if (v.id !== '' && v.id != null) {
      vMap[String(v.id)] = v;
    }
  });
  var sMap = {};
  (sports || []).forEach(function (s) {
    if (s.id !== '' && s.id != null) {
      sMap[String(s.id)] = s;
    }
  });
  return (matches || []).map(function (m) {
    var home = tMap[m.home_team_id] || {};
    var away = tMap[m.away_team_id] || {};
    var v = vMap[m.venue_id] || {};
    var homeName = home.name || m.home_team_id || '';
    var awayName = away.name || m.away_team_id || '';
    var sid = m.sport != null ? String(m.sport).trim() : '';
    var sportLabel = '';
    if (sid) {
      var have = m.sport_label != null ? String(m.sport_label).trim() : '';
      if (have) {
        sportLabel = have;
      } else {
        var srow = sMap[sid] || {};
        var lab = srow.label != null && String(srow.label).trim() !== '' ? String(srow.label).trim() : '';
        sportLabel = lab || sid;
      }
    }
    var bf = getMatchBroadcastFields(m);
    return Object.assign({}, m, {
      season: seasonFromMatchRow(m),
      home_team_name: homeName,
      away_team_name: awayName,
      venue_name: v.name || '',
      venue_city: v.city || '',
      sport_label: sportLabel,
      live: bf.live,
      live_url: bf.live_url,
      title:
        homeName && awayName ? homeName + ' vs ' + awayName : m.note || m.id || ''
    });
  });
}

/** API 未帶 type_label 時，依 place_types 對照補上 */
export function enrichPlacesWithTypeLabels(places, placeTypes) {
  var tMap = {};
  (placeTypes || []).forEach(function (r) {
    if (r.id !== '' && r.id != null) {
      tMap[String(r.id)] = r;
    }
  });
  return (places || []).map(function (p) {
    var have = p.type_label != null ? String(p.type_label).trim() : '';
    if (have) {
      return p;
    }
    var tid = p.type != null ? String(p.type).trim() : '';
    var row = tMap[tid] || {};
    var lab = row.label != null && String(row.label).trim() !== '' ? String(row.label).trim() : '';
    return Object.assign({}, p, { type_label: lab || tid || '' });
  });
}
