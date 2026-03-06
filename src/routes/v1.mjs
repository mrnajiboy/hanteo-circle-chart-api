import express from "express";
import { ACTIVE_VERSION, VERSION_PREFIX } from "../config/apiVersion.mjs";
import {
  formEncode,
  todayKST,
  todayYYYYMMDD,
  circleTermMap,
  yyyymmddToIsoUtc,
  yyyymmToIsoUtc,
  yyyyToIsoUtc,
  retailHourToIsoUtc,
  firstListItem,
  isoWeekNumberUTC,
  socialWeeklyPeriodKeyFallback,
  socialMonthlyPeriodKeyFallback,
  socialYearlyPeriodKeyFallback,
  extractCurrentIssueKeyFromListItem,
  issueKeyToIso,
} from "../utils/helpers.mjs";
import { logError, logInfo, logVerbose } from "../utils/logging.mjs";

// ============================================================================
// HANTEO — DATA LAYER
// ============================================================================

const HANTEO_BASE = "https://api.hanteochart.io";

function hanteoApiParams(category, timeframe) {
  const typeMap = {
    album: "ALBUM",
    digital: "SOUND",
    world: "WORLD",
    social: "SOCIAL",
    star: "STAR",
    authentication: "AUTHENTICATION",
  };
  const termMap = {
    real: "REAL",
    daily: "DAILY",
    weekly: "WEEKLY",
    monthly: "MONTHLY",
    yearly: "YEARLY",
  };
  const type = typeMap[category];
  const term = termMap[timeframe];
  if (!type || !term) throw new Error(`Unsupported Hanteo combination: ${category} ${timeframe}`);
  return { type, term };
}

/**
 * For Hanteo World regional charts (US/JP/CN) the raw targetName is formatted as
 * "<artist> - <album title>". We only want everything before the LAST " - ".
 */
function parseWorldArtistName(targetName) {
  if (!targetName) return targetName;
  const s = String(targetName);
  const lastIdx = s.lastIndexOf(" - ");
  if (lastIdx === -1) return s;
  return s.slice(0, lastIdx);
}

function parseHanteoIssueDatetime(resultDatetime) {
  if (!resultDatetime) return null;
  const t = Date.parse(String(resultDatetime));
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function deriveHanteoIssueTime(category, timeframe) {
  const now = todayKST();

  if (timeframe === "real") {
    const utcNow = new Date();
    utcNow.setUTCMinutes(0, 0, 0);
    return utcNow.toISOString();
  }
  if (timeframe === "daily") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)).toISOString();
  }
  if (timeframe === "weekly") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)).toISOString();
  }
  if (timeframe === "monthly") {
    let y = now.getFullYear();
    let m = now.getMonth();
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    return new Date(Date.UTC(y, m, 1, 0, 0, 0)).toISOString();
  }
  if (timeframe === "yearly") {
    return new Date(Date.UTC(now.getFullYear() - 1, 0, 1, 0, 0, 0)).toISOString();
  }
  return new Date().toISOString();
}

function buildHanteoCrossChartScores(detail = {}) {
  if (!detail || typeof detail !== "object") return null;
  const out = {
    melon_score: detail.melon ?? null,
    melon_rank: detail.melonRank ?? null,
    melon_song_id: detail.melonSongIdx ?? null,
    bugs_score: detail.bugs ?? null,
    bugs_rank: detail.bugsRank ?? null,
    bugs_song_id: detail.bugsSongIdx ?? null,
    genie_score: detail.genie ?? null,
    genie_rank: detail.genieRank ?? null,
    genie_song_id: detail.genieSongIdx ?? null,
    flo_score: detail.flo ?? null,
    flo_rank: detail.floRank ?? null,
    flo_song_id: detail.floSongIdx ?? null,
    collect_song_name: detail.collectSongName ?? null,
    collect_album_name: detail.collectAlbumName ?? null,
    collect_artist_name: detail.collectArtistName ?? null,
  };
  const hasAny = Object.values(out).some((v) => v !== null && v !== undefined && v !== "");
  return hasAny ? out : null;
}

async function fetchHanteoChart(category, timeframe, region = null, limit = 100, lang = "EN") {
  const fetchedAt = new Date().toISOString();
  const { type, term } = hanteoApiParams(category, timeframe);

  let url;
  if (category === "world") {
    const u = new URL(`${HANTEO_BASE}/v4/ranking/list/WORLD/${term}`);
    if (!region || region === "global") {
      u.searchParams.set("limit", String(limit));
    } else {
      u.searchParams.set("limit", "30");
      u.searchParams.set("countryCode", String(region).toUpperCase());
    }
    u.searchParams.set("lang", lang);
    url = u.toString();
  } else {
    const u = new URL(`${HANTEO_BASE}/v4/ranking/list/${type}/${term}/BASIC`);
    u.searchParams.set("limit", String(limit));
    u.searchParams.set("lang", lang);
    url = u.toString();
  }

  logInfo("hanteo", "api-resolve", { category, timeframe, region, url });

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Origin: "https://www.hanteochart.com",
      Referer: "https://www.hanteochart.com/",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    logError("hanteo", "api-error", res.status, text.slice(0, 300));
    throw new Error(`Hanteo API HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  logVerbose("hanteo", "api-json-snippet", JSON.stringify(json).slice(0, 200) + "...");

  const list = json?.resultData?.list || [];
  const weekLabel = json?.resultData?.resultDatetime ?? null;

  let issueIso = parseHanteoIssueDatetime(weekLabel);
  if (!issueIso) issueIso = deriveHanteoIssueTime(category, timeframe);

  const entries = list.map((item) => {
    const d = item.detail || {};

    if (category === "album") {
      return {
        rank: item.rank,
        rank_diff: item.rankDiff,
        album: item.targetName,
        artist: d.artistName ?? null,
        artist_global_name: d.artistGlobalName ?? null,
        sales: d.salesVolume ?? null,
        supply_price: d.supplyPrice ?? null,
        entertainment: d.entertainment ?? null,
        distribute: d.distribute ?? null,
        badge: d.badge ?? null,
        value: item.value,
        image: item.targetImg ? `https://resource.hanteochart.io${item.targetImg}` : null,
        reg_date: item.regDate ?? null,
        is_deadline: item.isDeadLine ?? null,
        provider_item_id: item.targetIdx ?? null,
        provider_artist_id: d.artistIdx ?? null,
        provider_album_id: d.albumIdx ?? null,
        cross_chart_scores: buildHanteoCrossChartScores(d),
      };
    }

    if (category === "world") {
      const isRegional = region && region !== "global";
      return {
        rank: item.rank,
        rank_diff: item.rankDiff,
        artist: isRegional ? parseWorldArtistName(item.targetName) : item.targetName,
        artist_global_name: d.artistGlobalName ?? null,
        world_index: item.value,
        sound_index: d.soundRankPoint ?? null,
        album_index: d.albumRankPoint ?? null,
        social_index: d.socialRankPoint ?? null,
        media_index: d.mediaRankPoint ?? null,
        entertainment: d.entertainment ?? null,
        image: item.targetImg ? `https://resource.hanteochart.io${item.targetImg}` : null,
        reg_date: item.regDate ?? null,
        is_deadline: item.isDeadLine ?? null,
        provider_item_id: item.targetIdx ?? null,
        provider_artist_id: d.artistIdx ?? null,
        provider_album_id: d.albumIdx ?? null,
        cross_chart_scores: buildHanteoCrossChartScores(d),
      };
    }

    if (category === "social") {
      return {
        rank: item.rank,
        rank_diff: item.rankDiff,
        artist: item.targetName,
        artist_global_name: d.artistGlobalName ?? null,
        social_index: d.socialRankPoint ?? item.value ?? null,
        star_index: d.starRankPoint ?? null,
        value: item.value,
        entertainment: d.entertainment ?? null,
        image: item.targetImg ? `https://resource.hanteochart.io${item.targetImg}` : null,
        reg_date: item.regDate ?? null,
        is_deadline: item.isDeadLine ?? null,
        provider_item_id: item.targetIdx ?? null,
        provider_artist_id: d.relationIdx ?? item.targetIdx ?? null,
        provider_album_id: null,
        cross_chart_scores: buildHanteoCrossChartScores(d),
      };
    }

    return {
      rank: item.rank,
      rank_diff: item.rankDiff,
      name: item.targetName,
      value: item.value,
      artist: d.artistName ?? null,
      artist_global_name: d.artistGlobalName ?? null,
      sales: d.salesVolume ?? null,
      entertainment: d.entertainment ?? null,
      distribute: d.distribute ?? null,
      image: item.targetImg ? `https://resource.hanteochart.io${item.targetImg}` : null,
      reg_date: item.regDate ?? null,
      is_deadline: item.isDeadLine ?? null,
      provider_item_id: item.targetIdx ?? null,
      provider_artist_id: d.artistIdx ?? null,
      provider_album_id: d.albumIdx ?? null,
      cross_chart_scores: buildHanteoCrossChartScores(d),
    };
  });

  return {
    chart_datetime: issueIso,
    fetched_at: fetchedAt,
    provider: "hanteo",
    chart_name: region ? `${category}_${region}_${timeframe}` : `${category}_${timeframe}`,
    category,
    timeframe,
    region: region || null,
    week_label: weekLabel,
    entries,
  };
}

// ============================================================================
// CIRCLE — DATA LAYER
// ============================================================================

const CIRCLE_BASE = "https://circlechart.kr";

function extractList(json) {
  if (!json) return {};
  if (json.List) return json.List;
  if (json.list) return json.list;
  if (json.data?.List) return json.data.List;
  if (json.data?.list) return json.data.list;
  const ds = json.DataSet || json.dataset;
  if (ds?.DATA) return ds.DATA;
  if (json.DATA) return json.DATA;
  return {};
}

function extractResultStatus(json) {
  return json?.ResultStatus ?? json?.resultStatus ?? null;
}

function circleMapItemToEntry(item, key) {
  if (!item || typeof item !== "object") return null;

  const rankOrderRaw = item.RankOrder ?? item.RANK_ORDER ?? item.rank_order ?? null;
  const rankFieldRaw =
    item.SERVICE_RANKING ??
    item.RankInt ??
    item.Rank ??
    item.rank ??
    item.RANK ??
    item.RANK_NO ??
    null;

  let rank = null;
  if (rankOrderRaw != null && rankOrderRaw !== "" && rankOrderRaw !== "-") {
    rank = Number(rankOrderRaw);
  }
  if (
    (!rank || !Number.isFinite(rank) || rank < 1) &&
    rankFieldRaw != null &&
    rankFieldRaw !== "" &&
    rankFieldRaw !== "-"
  ) {
    rank = Number(rankFieldRaw);
  }
  if (!rank || !Number.isFinite(rank) || rank < 1) {
    const keyNum = Number(key);
    if (Number.isFinite(keyNum) && keyNum >= 0) rank = keyNum + 1;
  }

  const title =
    item.SONG_NAME ??
    item.Title ??
    item.ALBUM_NAME ??
    item.Album ??
    item.title ??
    item.music_title ??
    null;
  const artist = item.ARTIST_NAME ?? item.Artist ?? item.artist_name ?? item.artist ?? null;
  const album = item.ALBUM_NAME ?? item.Album ?? item.album_name ?? item.album ?? null;

  const scoreRaw =
    item.SCORE ?? item.Score ?? item.score ?? item.TOTAL_SCORE ?? item.cumulative_score ?? null;
  const score = scoreRaw != null && scoreRaw !== "" ? Number(scoreRaw) : null;

  const salesRaw =
    item.Album_CNT ?? item.Total_CNT ?? item.KSum ?? item.rowSum ?? item.ESum ?? item.sales ?? null;
  const sales = salesRaw != null && salesRaw !== "" ? Number(salesRaw) : null;

  const rankChange = item.RankChange ?? item.diff_rank ?? item.DIFF_RANK ?? null;
  const rank_status = item.RankStatus ?? item.rank_status ?? null;
  const distribution =
    item.DE_COMPANY_NAME ??
    item.De_company_name ??
    item.de_nm ??
    item.CompanyDist ??
    item.distribution ??
    null;
  const production = item.MAKE_COMPANY_NAME ?? item.CompanyMake ?? item.production ?? null;

  const imgRaw =
    item.ALBUMIMG ??
    item.FILE_NAME ??
    item.save_name ??
    item.album_image_url ??
    item.ALBUM_IMAGE_URL ??
    null;
  const image = imgRaw
    ? String(imgRaw).startsWith("http")
      ? String(imgRaw)
      : `${CIRCLE_BASE}${String(imgRaw).startsWith("/") ? "" : "/"}${String(imgRaw).replace(/\\/g, "/")}`
    : null;

  const rankHigh = item.RankHigh ?? item.rank_high ?? null;
  const rankContinue = item.RankContinue ?? item.rank_continue ?? null;
  const certify_grade = item.Certify_Grade ?? item.certify_grade ?? null;
  const seq_mom = item.SEQ_MOM ?? item.Seq_Mom ?? item.seq_mom ?? item.seq_aoa ?? null;

  const cumulative_score = item.cumulative_score ?? null;
  const diff_score_percent = item.diff_score_percent ?? null;
  const youtube_id = item.youtube_link ?? null;
  const youtube_title = item.youtube_title ?? null;
  const period_key = item.period_key ?? null;

  return {
    rank,
    title: title != null ? String(title) : null,
    artist: artist != null ? String(artist) : null,
    album: album != null ? String(album) : null,
    score,
    sales,
    cumulative_score: cumulative_score != null ? Number(cumulative_score) : null,
    rank_change: rankChange != null && rankChange !== "" ? String(rankChange) : null,
    rank_status: rank_status != null ? String(rank_status) : null,
    diff_score_percent: diff_score_percent != null ? Number(diff_score_percent) : null,
    production: production != null ? String(production) : null,
    distribution: distribution != null ? String(distribution) : null,
    image,
    rank_high: rankHigh != null ? String(rankHigh) : null,
    rank_continue: rankContinue != null ? String(rankContinue) : null,
    certify_grade: certify_grade != null ? String(certify_grade) : null,
    seq_mom: seq_mom != null ? String(seq_mom) : null,
    youtube_id: youtube_id != null ? String(youtube_id) : null,
    youtube_title: youtube_title != null ? String(youtube_title) : null,
    period_key: period_key != null ? String(period_key) : null,
    provider_item_id: seq_mom != null ? String(seq_mom) : null,
    provider_artist_id: null,
    provider_album_id: null,
  };
}

// ── Circle issue helpers ─────────────────────────────────────────────────────

async function fetchCircleGlobalDateList(termGbn) {
  const res = await fetch(`${CIRCLE_BASE}/data/api/chart_func/global/datelist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Origin: CIRCLE_BASE,
      Referer: `${CIRCLE_BASE}/page_chart/global.circle?termGbn=${termGbn}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formEncode({ termGbn }),
  });
  if (!res.ok)
    throw new Error(
      `Circle global datelist HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
    );
  return res.json();
}

async function fetchCircleGlobalDefaultValue(termGbn) {
  const res = await fetch(`${CIRCLE_BASE}/data/api/chart_func/global/default_value`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Origin: CIRCLE_BASE,
      Referer: `${CIRCLE_BASE}/page_chart/global.circle?termGbn=${termGbn}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formEncode({ termGbn }),
  });
  if (!res.ok)
    throw new Error(
      `Circle global default_value HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
    );
  return res.json();
}

async function fetchCircleSocialDateList(dateType) {
  const url = new URL(`${CIRCLE_BASE}/data/api/chart_func/social/v3/datelist`);
  url.searchParams.set("date_type", dateType);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Referer: `${CIRCLE_BASE}/page_chart/social.circle?date_type=${dateType}`,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!res.ok)
    throw new Error(
      `Circle social datelist HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
    );
  return res.json();
}

async function fetchCircleRetailDefaultValue(termGbn) {
  const res = await fetch(`${CIRCLE_BASE}/data/api/chart_func/retail/default_value`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Origin: CIRCLE_BASE,
      Referer: `${CIRCLE_BASE}/page_chart/retail.circle?termGbn=${termGbn}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formEncode({ termGbn }),
  });
  if (!res.ok)
    throw new Error(
      `Circle retail default_value HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
    );
  return res.json();
}

async function fetchCircleRetailHourInfo() {
  const res = await fetch(`${CIRCLE_BASE}/data/api/chart_func/retail/hour_time`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Origin: CIRCLE_BASE,
      Referer: `${CIRCLE_BASE}/page_chart/retail.circle?termGbn=hour`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formEncode({ termGbn: "hour" }),
  });
  if (!res.ok)
    throw new Error(
      `Circle retail hour_time HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
    );
  return res.json();
}

async function resolveCircleGlobalCurrentIssue(termGbn) {
  let json = null;
  try {
    json = await fetchCircleGlobalDateList(termGbn);
    if (extractResultStatus(json) === "Error") json = null;
  } catch {
    /* json stays null on datelist error — fallback below */
  }
  if (!json) json = await fetchCircleGlobalDefaultValue(termGbn);
  const item = firstListItem(json?.List);
  const issueKey = extractCurrentIssueKeyFromListItem(termGbn, item);
  return {
    issue_key: issueKey,
    chart_datetime: issueKeyToIso(termGbn, issueKey),
    raw: item,
    result_status: extractResultStatus(json),
  };
}

async function resolveCircleSocialCurrentIssue(dateType) {
  const json = await fetchCircleSocialDateList(dateType);
  const item = firstListItem(json?.List);
  if (!item) return null;
  return {
    period_key: item.period_key ?? null,
    start_date: item.start_date ?? null,
    end_date: item.end_date ?? null,
    chart_datetime: yyyymmddToIsoUtc(item.start_date),
    raw: item,
  };
}

async function resolveCircleRetailCurrentIssue(termGbn) {
  if (termGbn === "hour") {
    const json = await fetchCircleRetailHourInfo();
    return {
      yyyymmdd: json?.YYYYMMDD ?? null,
      thisHour: json?.Hour_End ?? null,
      chart_datetime: retailHourToIsoUtc(json?.YYYYMMDD, json?.Hour_End),
      raw: json,
    };
  }
  const json = await fetchCircleRetailDefaultValue(termGbn);
  const item = firstListItem(json?.List);
  const issueKey = extractCurrentIssueKeyFromListItem(termGbn, item);
  return {
    issue_key: issueKey,
    chart_datetime: issueKeyToIso(termGbn, issueKey),
    raw: item,
    result_status: extractResultStatus(json),
  };
}

// ── Circle data fetchers ─────────────────────────────────────────────────────

async function fetchCircleSocial(dateType = "week", periodKey) {
  const fetchedAt = new Date().toISOString();
  let resolved = null;
  if (!periodKey) {
    try {
      resolved = await resolveCircleSocialCurrentIssue(dateType);
      periodKey = resolved?.period_key || null;
    } catch {
      if (dateType === "week") periodKey = socialWeeklyPeriodKeyFallback();
      else if (dateType === "month") periodKey = socialMonthlyPeriodKeyFallback();
      else if (dateType === "year") periodKey = socialYearlyPeriodKeyFallback();
    }
  }

  const url = new URL(`${CIRCLE_BASE}/data/api/chart/social/v3`);
  url.searchParams.set("date_type", dateType);
  if (periodKey) url.searchParams.set("period_key", periodKey);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Referer: `${CIRCLE_BASE}/page_chart/social.circle?date_type=${dateType}`,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!res.ok)
    throw new Error(`Circle social HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const list = extractList(json);
  const entries = Object.keys(list)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => circleMapItemToEntry(list[k], k))
    .filter((e) => e && e.rank && e.rank > 0);

  let issueIso = resolved?.chart_datetime || null;
  if (!issueIso && dateType === "month" && /^\d{6}$/.test(String(periodKey || "")))
    issueIso = yyyymmToIsoUtc(periodKey);
  if (!issueIso && dateType === "year" && /^\d{4}$/.test(String(periodKey || "")))
    issueIso = yyyyToIsoUtc(periodKey);

  return {
    chart_datetime: issueIso || fetchedAt,
    fetched_at: fetchedAt,
    provider: "circle",
    chart_type: "social",
    timeframe: dateType,
    period_key: periodKey || null,
    result_status: extractResultStatus(json),
    entries,
  };
}

async function fetchCircleGlobal(term, body = {}) {
  const fetchedAt = new Date().toISOString();
  let resolved = null;
  let yyyymmdd = body?.yyyymmdd ? String(body.yyyymmdd) : null;
  if (!yyyymmdd) {
    resolved = await resolveCircleGlobalCurrentIssue(term);
    yyyymmdd = resolved?.issue_key || null;
  }

  const res = await fetch(`${CIRCLE_BASE}/data/api/chart/global`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Origin: CIRCLE_BASE,
      Referer: `${CIRCLE_BASE}/page_chart/global.circle?termGbn=${term}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formEncode({ termGbn: term, yyyymmdd }),
  });
  if (!res.ok)
    throw new Error(`Circle global HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const list = extractList(json);
  const entries = Object.keys(list)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => circleMapItemToEntry(list[k], k))
    .filter((e) => e && e.rank && e.rank > 0);

  let issueIso = resolved?.chart_datetime || null;
  if (!issueIso && yyyymmdd) issueIso = issueKeyToIso(term, yyyymmdd);

  return {
    chart_datetime: issueIso || fetchedAt,
    fetched_at: fetchedAt,
    provider: "circle",
    chart_type: "global",
    term,
    yyyymmdd: yyyymmdd || null,
    result_status: extractResultStatus(json),
    entries,
  };
}

async function buildCircleOnOffDateParams(termGbn) {
  const resolved = await resolveCircleGlobalCurrentIssue(termGbn);
  if (!resolved?.issue_key)
    throw new Error(`Unable to resolve current Circle issue for onoff termGbn=${termGbn}`);
  const issueKey = String(resolved.issue_key);

  if (termGbn === "week") {
    if (!/^\d{8}$/.test(issueKey))
      throw new Error(`Invalid weekly issue key for onoff: ${issueKey}`);
    const hitYear = issueKey.slice(0, 4);
    const weekNo = isoWeekNumberUTC(
      new Date(`${issueKey.slice(0, 4)}-${issueKey.slice(4, 6)}-${issueKey.slice(6, 8)}T00:00:00Z`)
    );
    return { hitYear, targetTime: String(weekNo).padStart(2, "0"), yearTime: "3" };
  }
  if (termGbn === "month") {
    if (!/^\d{6}$/.test(issueKey))
      throw new Error(`Invalid monthly issue key for onoff: ${issueKey}`);
    return { hitYear: issueKey.slice(0, 4), targetTime: issueKey.slice(4, 6), yearTime: "3" };
  }
  if (termGbn === "year") {
    if (!/^\d{4}$/.test(issueKey))
      throw new Error(`Invalid yearly issue key for onoff: ${issueKey}`);
    return { hitYear: issueKey, targetTime: issueKey, yearTime: "3" };
  }
  if (termGbn === "day") {
    if (!/^\d{8}$/.test(issueKey))
      throw new Error(`Invalid daily issue key for onoff: ${issueKey}`);
    return { hitYear: issueKey.slice(0, 4), targetTime: issueKey, yearTime: "3" };
  }
  throw new Error(`Unsupported onoff termGbn: ${termGbn}`);
}

async function fetchCircleOnOff({ serviceGbn, termGbn, hitYear, targetTime, yearTime, curUrl }) {
  const fetchedAt = new Date().toISOString();
  const body = {
    nationGbn: "T",
    serviceGbn: String(serviceGbn),
    termGbn: String(termGbn),
    hitYear: String(hitYear),
    targetTime: String(targetTime),
    yearTime: String(yearTime),
    curUrl: String(curUrl),
  };

  logInfo("circle", "onoff-resolve", {
    serviceGbn,
    termGbn,
    url: `${CIRCLE_BASE}/data/api/chart/onoff`,
    body,
  });

  const res = await fetch(`${CIRCLE_BASE}/data/api/chart/onoff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Origin: CIRCLE_BASE,
      Referer: `${CIRCLE_BASE}/page_chart/onoff.circle?serviceGbn=${serviceGbn}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formEncode(body),
  });
  if (!res.ok) {
    logError("circle", "onoff-error", res.status);
    throw new Error(`Circle onoff HTTP ${res.status}`);
  }

  const json = await res.json();
  logVerbose("circle", "onoff-json-snippet", JSON.stringify(json).slice(0, 200) + "...");

  const list = extractList(json);
  const entries = Object.keys(list)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => circleMapItemToEntry(list[k], k))
    .filter((e) => e && e.rank && e.rank > 0);

  const fm = json?.FormToMap || {};
  const fmHitYear = String(fm.hitYear ?? hitYear ?? "");
  const fmTargetTime = String(fm.targetTime ?? targetTime ?? "");

  let issueIso = null;
  if (termGbn === "week" && /^\d{4}$/.test(fmHitYear) && /^\d{1,2}$/.test(fmTargetTime)) {
    issueIso = new Date(
      Date.UTC(Number(fmHitYear), 0, 1 + (Number(fmTargetTime) - 1) * 7, 0, 0, 0)
    ).toISOString();
  } else if (termGbn === "month" && /^\d{4}$/.test(fmHitYear) && /^\d{1,2}$/.test(fmTargetTime)) {
    issueIso = yyyymmToIsoUtc(`${fmHitYear}${fmTargetTime.padStart(2, "0")}`);
  } else if (termGbn === "year" && /^\d{4}$/.test(fmHitYear)) {
    issueIso = yyyyToIsoUtc(fmHitYear);
  } else if (termGbn === "day" && /^\d{8}$/.test(fmTargetTime)) {
    issueIso = yyyymmddToIsoUtc(fmTargetTime);
  }

  return {
    chart_datetime: issueIso || fetchedAt,
    fetched_at: fetchedAt,
    provider: "circle",
    chart_type: "onoff",
    serviceGbn,
    termGbn,
    hitYear: fm.hitYear ?? String(hitYear),
    targetTime: fm.targetTime ?? String(targetTime),
    yearTime: fm.yearTime ?? String(yearTime),
    result_status: extractResultStatus(json),
    entries,
  };
}

async function buildCurrentCircleAlbumParams(termGbn) {
  const now = todayKST();
  const prevYear = String(now.getFullYear() - 1);

  if (termGbn === "week") {
    const resolved = await resolveCircleGlobalCurrentIssue("week");
    const weekStart = String(resolved?.issue_key || "");
    const hitYear = weekStart.slice(0, 4);
    const weekNo = isoWeekNumberUTC(
      new Date(
        `${weekStart.slice(0, 4)}-${weekStart.slice(4, 6)}-${weekStart.slice(6, 8)}T00:00:00Z`
      )
    );
    return { termGbn: "week", hitYear, targetTime: String(weekNo).padStart(2, "0"), yearTime: "3" };
  }
  if (termGbn === "month") {
    const resolved = await resolveCircleGlobalCurrentIssue("month");
    const key = String(resolved?.issue_key || "");
    return {
      termGbn: "month",
      hitYear: key.slice(0, 4),
      targetTime: key.slice(4, 6),
      yearTime: "3",
    };
  }
  if (termGbn === "half") {
    return { termGbn: "year", hitYear: prevYear, targetTime: prevYear, yearTime: "1" };
  }
  if (termGbn === "year") {
    const resolved = await resolveCircleGlobalCurrentIssue("year");
    const key = String(resolved?.issue_key || prevYear);
    return { termGbn: "year", hitYear: key, targetTime: key, yearTime: "3" };
  }
  return null;
}

async function fetchCircleAlbum({ termGbn, hitYear, targetTime, yearTime }) {
  const fetchedAt = new Date().toISOString();
  const res = await fetch(`${CIRCLE_BASE}/data/api/chart/album`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Origin: CIRCLE_BASE,
      Referer: `${CIRCLE_BASE}/page_chart/album.circle`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formEncode({
      nationGbn: "T",
      termGbn: String(termGbn),
      hitYear: String(hitYear),
      targetTime: String(targetTime),
      yearTime: String(yearTime),
      curUrl: "circlechart.kr/page_chart/album.circle?",
    }),
  });
  if (!res.ok)
    throw new Error(`Circle album HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const list = extractList(json);
  const entries = Object.keys(list)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => circleMapItemToEntry(list[k], k))
    .filter((e) => e && e.rank && e.rank > 0);

  let issueIso = null;
  if (
    termGbn === "week" &&
    /^\d{4}$/.test(String(hitYear)) &&
    /^\d{1,2}$/.test(String(targetTime))
  ) {
    issueIso = new Date(
      Date.UTC(Number(hitYear), 0, 1 + (Number(targetTime) - 1) * 7, 0, 0, 0)
    ).toISOString();
  } else if (
    termGbn === "month" &&
    /^\d{4}$/.test(String(hitYear)) &&
    /^\d{1,2}$/.test(String(targetTime))
  ) {
    issueIso = yyyymmToIsoUtc(`${String(hitYear)}${String(targetTime).padStart(2, "0")}`);
  } else if (termGbn === "year" && /^\d{4}$/.test(String(hitYear))) {
    issueIso = yyyyToIsoUtc(String(hitYear));
  }

  return {
    chart_datetime: issueIso || fetchedAt,
    fetched_at: fetchedAt,
    provider: "circle",
    chart_type: "album",
    termGbn,
    hitYear: String(hitYear),
    targetTime: String(targetTime),
    yearTime: String(yearTime),
    result_status: extractResultStatus(json),
    entries,
  };
}

async function buildCurrentCircleRetailListParams(termGbn) {
  const resolved = await resolveCircleRetailCurrentIssue(termGbn);
  if (!resolved) return null;
  return { termGbn, yyyymmdd: resolved.issue_key };
}

async function fetchCircleRetailDay({ termGbn, yyyymmdd }) {
  const fetchedAt = new Date().toISOString();
  const res = await fetch(`${CIRCLE_BASE}/data/api/chart/retail_list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Origin: CIRCLE_BASE,
      Referer: `${CIRCLE_BASE}/page_chart/retail.circle?termGbn=${termGbn}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formEncode({ termGbn, yyyymmdd }),
  });
  if (!res.ok)
    throw new Error(`Circle retail_list HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const list = extractList(json);
  const entries = Object.keys(list)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => circleMapItemToEntry(list[k], k))
    .filter((e) => e && e.rank && e.rank > 0);
  const issueIso = issueKeyToIso(termGbn, yyyymmdd);

  return {
    chart_datetime: issueIso || fetchedAt,
    fetched_at: fetchedAt,
    provider: "circle",
    chart_type: "retail",
    termGbn,
    yyyymmdd: String(yyyymmdd || "") || null,
    result_status: extractResultStatus(json),
    entries,
  };
}

function currentKstHourString() {
  return String(todayKST().getHours());
}

async function fetchCircleRetailHour({ yyyymmdd, hourRange, listType, thisHour = "" }) {
  const fetchedAt = new Date().toISOString();
  const res = await fetch(`${CIRCLE_BASE}/data/api/chart/retail_hour`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Origin: CIRCLE_BASE,
      Referer: `${CIRCLE_BASE}/page_chart/retail.circle?termGbn=hour`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formEncode({ yyyymmdd, HourRange: hourRange, ListType: listType, thisHour }),
  });
  if (!res.ok)
    throw new Error(`Circle retail_hour HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const list = extractList(json);
  const entries = Object.keys(list)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => circleMapItemToEntry(list[k], k))
    .filter((e) => e && e.rank && e.rank > 0);
  const issueIso = retailHourToIsoUtc(yyyymmdd, thisHour);

  return {
    chart_datetime: issueIso || fetchedAt,
    fetched_at: fetchedAt,
    provider: "circle",
    chart_type: "retail_hour",
    yyyymmdd: String(yyyymmdd || "") || null,
    thisHour: thisHour === "" ? null : String(thisHour),
    result_status: extractResultStatus(json),
    entries,
  };
}

// ============================================================================
// V1 ROUTER
// ============================================================================

const router = express.Router();

// Helper: build absolute endpoint paths using the active version prefix
function ep(path) {
  return `${VERSION_PREFIX}${path}`;
}

// ── Index ────────────────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Hanteo / Circle Chart API (JSON format, EN)",
    version: ACTIVE_VERSION,
    endpoints: {
      hanteo: {
        album: ["real", "daily", "weekly", "monthly", "yearly"].map((tf) =>
          ep(`/hanteo/album/${tf}`)
        ),
        digital: ["real", "daily", "weekly", "monthly", "yearly"].map((tf) =>
          ep(`/hanteo/digital/${tf}`)
        ),
        world: [
          ep("/hanteo/world/global/weekly"),
          ep("/hanteo/world/global/monthly"),
          ep("/hanteo/world/global/yearly"),
          ep("/hanteo/world/us/weekly"),
          ep("/hanteo/world/jp/weekly"),
          ep("/hanteo/world/cn/weekly"),
        ],
        social: ["weekly", "monthly"].map((tf) => ep(`/hanteo/social/${tf}`)),
        star: ["weekly", "monthly", "yearly"].map((tf) => ep(`/hanteo/star/${tf}`)),
        authentication: ["weekly", "monthly", "yearly"].map((tf) =>
          ep(`/hanteo/authentication/${tf}`)
        ),
      },
      circle: {
        social: ["weekly", "monthly", "yearly"].map((tf) => ep(`/circle/social/${tf}`)),
        global: ["daily", "weekly", "monthly", "yearly"].map((tf) => ep(`/circle/global/${tf}`)),
        digital: ["weekly", "monthly", "yearly"].map((tf) => ep(`/circle/digital/${tf}`)),
        streaming: ["weekly", "monthly", "yearly"].map((tf) => ep(`/circle/streaming/${tf}`)),
        download: ["weekly", "monthly", "yearly"].map((tf) => ep(`/circle/download/${tf}`)),
        bgm: ["weekly", "monthly"].map((tf) => ep(`/circle/bgm/${tf}`)),
        vcoloring: ["weekly", "monthly", "yearly"].map((tf) => ep(`/circle/vcoloring/${tf}`)),
        singingroom: ["weekly", "monthly"].map((tf) => ep(`/circle/singingroom/${tf}`)),
        bell: ["weekly", "monthly"].map((tf) => ep(`/circle/bell/${tf}`)),
        ring: ["weekly", "monthly"].map((tf) => ep(`/circle/ring/${tf}`)),
        album: ["weekly", "monthly", "firsthalf", "yearly"].map((tf) => ep(`/circle/album/${tf}`)),
        retail: [
          ep("/circle/retail/hour"),
          ...["daily", "weekly", "monthly", "yearly"].map((tf) => ep(`/circle/retail/${tf}`)),
        ],
      },
    },
  });
});

// ── Hanteo ───────────────────────────────────────────────────────────────────
router.get("/hanteo/album/:timeframe", async (req, res) => {
  try {
    const { timeframe } = req.params;
    if (!["real", "daily", "weekly", "monthly", "yearly"].includes(timeframe))
      return res.status(400).json({ error: "Invalid timeframe" });
    const lang = (req.query.lang && String(req.query.lang)) || "EN";
    res.json(await fetchHanteoChart("album", timeframe, null, 100, lang));
  } catch (err) {
    logError("hanteo", "route-album", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/hanteo/digital/:timeframe", async (req, res) => {
  try {
    const { timeframe } = req.params;
    if (!["real", "daily", "weekly", "monthly", "yearly"].includes(timeframe))
      return res.status(400).json({ error: "Invalid timeframe" });
    const lang = (req.query.lang && String(req.query.lang)) || "EN";
    res.json(await fetchHanteoChart("digital", timeframe, null, 100, lang));
  } catch (err) {
    logError("hanteo", "route-digital", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/hanteo/world/:region/:timeframe", async (req, res) => {
  try {
    const { region, timeframe } = req.params;
    if (!["global", "us", "jp", "cn"].includes(region))
      return res.status(400).json({ error: "Invalid region" });
    if (!["weekly", "monthly", "yearly"].includes(timeframe))
      return res.status(400).json({ error: "Invalid timeframe" });
    const lang = (req.query.lang && String(req.query.lang)) || "EN";
    res.json(await fetchHanteoChart("world", timeframe, region, 100, lang));
  } catch (err) {
    logError("hanteo", "route-world", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/hanteo/social/:timeframe", async (req, res) => {
  try {
    const { timeframe } = req.params;
    if (!["weekly", "monthly"].includes(timeframe))
      return res.status(400).json({ error: "Invalid timeframe" });
    const lang = (req.query.lang && String(req.query.lang)) || "EN";
    res.json(await fetchHanteoChart("social", timeframe, null, 100, lang));
  } catch (err) {
    logError("hanteo", "route-social", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/hanteo/star/:timeframe", (req, res) => {
  res.status(501).json({
    error: "coming soon!",
    provider: "hanteo",
    category: "star",
    timeframe: req.params.timeframe,
  });
});

router.get("/hanteo/authentication/:timeframe", (req, res) => {
  res.status(501).json({
    error: "coming soon!",
    provider: "hanteo",
    category: "authentication",
    timeframe: req.params.timeframe,
  });
});

// ── Circle Social ────────────────────────────────────────────────────────────
router.get("/circle/social/:timeframe", async (req, res) => {
  try {
    const map = { weekly: "week", monthly: "month", yearly: "year" };
    const dateType = map[req.params.timeframe];
    if (!dateType) return res.status(400).json({ error: "Invalid timeframe" });
    let { period_key } = req.query;
    period_key = period_key ? String(period_key) : null;
    res.json(await fetchCircleSocial(dateType, period_key));
  } catch (err) {
    logError("circle", "route-social", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ── Circle Global ────────────────────────────────────────────────────────────
router.get("/circle/global/:timeframe", async (req, res) => {
  try {
    const term = circleTermMap[req.params.timeframe];
    if (!["day", "week", "month", "year"].includes(term))
      return res.status(400).json({ error: "Invalid timeframe" });
    const qY = req.query.yyyymmdd ? String(req.query.yyyymmdd) : null;
    res.json(await fetchCircleGlobal(term, { termGbn: term, yyyymmdd: qY }));
  } catch (err) {
    logError("circle", "route-global", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ── Circle On/Off (shared factory) ──────────────────────────────────────────
function onOffRoute(serviceGbn, allowedTerms) {
  return async (req, res) => {
    try {
      const termGbn = circleTermMap[req.params.timeframe];
      if (!allowedTerms.includes(termGbn))
        return res.status(400).json({ error: "Invalid timeframe" });

      const qHitYear = req.query.hitYear ? String(req.query.hitYear) : null;
      const qTargetTime = req.query.targetTime ? String(req.query.targetTime) : null;
      const qYearTime = req.query.yearTime ? String(req.query.yearTime) : null;

      let hitYear, targetTime, yearTime;
      if (qHitYear && qTargetTime && qYearTime) {
        hitYear = qHitYear;
        targetTime = qTargetTime;
        yearTime = qYearTime;
      } else {
        ({ hitYear, targetTime, yearTime } = await buildCircleOnOffDateParams(termGbn));
      }

      res.json(
        await fetchCircleOnOff({
          serviceGbn,
          termGbn,
          hitYear,
          targetTime,
          yearTime,
          curUrl: `circlechart.kr/page_chart/onoff.circle?serviceGbn=${serviceGbn}`,
        })
      );
    } catch (err) {
      logError("circle", `route-onoff-${serviceGbn}`, err);
      res.status(500).json({ error: err?.message || String(err) });
    }
  };
}

router.get("/circle/digital/:timeframe", onOffRoute("ALL", ["week", "month", "year"]));
router.get("/circle/streaming/:timeframe", onOffRoute("S1040", ["week", "month", "year"]));
router.get("/circle/download/:timeframe", onOffRoute("S1020", ["week", "month", "year"]));
router.get("/circle/bgm/:timeframe", onOffRoute("S1060", ["week", "month"]));
router.get("/circle/vcoloring/:timeframe", onOffRoute("S4010", ["week", "month", "year"]));
router.get("/circle/singingroom/:timeframe", onOffRoute("S3010", ["week", "month"]));
router.get("/circle/bell/:timeframe", onOffRoute("S2020", ["week", "month"]));
router.get("/circle/ring/:timeframe", onOffRoute("S2040", ["week", "month"]));

// ── Circle Album ─────────────────────────────────────────────────────────────
router.get("/circle/album/:timeframe", async (req, res) => {
  try {
    const termGbn = circleTermMap[req.params.timeframe];
    if (!["week", "month", "half", "year"].includes(termGbn))
      return res.status(400).json({ error: "Invalid timeframe" });

    const qHitYear = req.query.hitYear ? String(req.query.hitYear) : null;
    const qTargetTime = req.query.targetTime ? String(req.query.targetTime) : null;
    const qYearTime = req.query.yearTime ? String(req.query.yearTime) : null;

    let term = termGbn,
      hitYear,
      targetTime,
      yearTime;
    if (qHitYear && qTargetTime && qYearTime) {
      hitYear = qHitYear;
      targetTime = qTargetTime;
      yearTime = qYearTime;
      if (termGbn === "half") term = "year";
    } else {
      const params = await buildCurrentCircleAlbumParams(termGbn);
      if (!params) return res.status(501).json({ error: "Album timeframe not supported" });
      term = params.termGbn;
      hitYear = params.hitYear;
      targetTime = params.targetTime;
      yearTime = params.yearTime;
    }
    res.json(await fetchCircleAlbum({ termGbn: term, hitYear, targetTime, yearTime }));
  } catch (err) {
    logError("circle", "route-album", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ── Circle Retail ────────────────────────────────────────────────────────────
router.get("/circle/retail/hour", async (req, res) => {
  try {
    let yyyymmdd = req.query.yyyymmdd ? String(req.query.yyyymmdd) : null;
    let thisHour = req.query.thisHour != null ? String(req.query.thisHour) : null;
    if (!yyyymmdd || thisHour == null) {
      const resolved = await resolveCircleRetailCurrentIssue("hour");
      if (!yyyymmdd) yyyymmdd = resolved?.yyyymmdd || todayYYYYMMDD();
      if (thisHour == null) thisHour = resolved?.thisHour || currentKstHourString();
    }
    res.json(
      await fetchCircleRetailHour({
        yyyymmdd,
        hourRange: "0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23",
        listType: "전일22시",
        thisHour,
      })
    );
  } catch (err) {
    logError("circle", "route-retail-hour", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/circle/retail/:timeframe", async (req, res) => {
  try {
    const termGbn = circleTermMap[req.params.timeframe];
    if (!["day", "week", "month", "year"].includes(termGbn))
      return res.status(400).json({ error: "Invalid timeframe" });
    let yyyymmdd = req.query.yyyymmdd ? String(req.query.yyyymmdd) : null;
    if (!yyyymmdd) {
      const params = await buildCurrentCircleRetailListParams(termGbn);
      if (!params) return res.status(501).json({ error: "Retail timeframe not supported" });
      yyyymmdd = params.yyyymmdd;
    }
    res.json(await fetchCircleRetailDay({ termGbn, yyyymmdd }));
  } catch (err) {
    logError("circle", "route-retail", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;
