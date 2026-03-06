// ============================================================================
// SHARED UTILITY HELPERS
// ============================================================================

export function formEncode(data) {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export function todayKST() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 60 * 60000);
}

export function todayYYYYMMDD() {
  const d = todayKST();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

export const circleTermMap = {
  hour: "hour",
  daily: "day",
  day: "day",
  weekly: "week",
  week: "week",
  monthly: "month",
  month: "month",
  firsthalf: "half",
  half: "half",
  yearly: "year",
  year: "year",
};

export function yyyymmddToIsoUtc(yyyymmdd) {
  const s = String(yyyymmdd || "");
  if (!/^\d{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString();
}

export function yyyymmToIsoUtc(yyyymm) {
  const s = String(yyyymm || "");
  if (!/^\d{6}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)).toISOString();
}

export function yyyyToIsoUtc(yyyy) {
  const s = String(yyyy || "");
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  return new Date(Date.UTC(y, 0, 1, 0, 0, 0)).toISOString();
}

export function retailHourToIsoUtc(yyyymmdd, hourKst) {
  const s = String(yyyymmdd || "");
  if (!/^\d{8}$/.test(s)) return null;
  const h = Number(hourKst);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d, h - 9, 0, 0)).toISOString();
}

export function firstListItem(listObj) {
  if (!listObj || typeof listObj !== "object") return null;
  const keys = Object.keys(listObj).sort((a, b) => Number(a) - Number(b));
  if (!keys.length) return null;
  return listObj[keys[0]] || null;
}

export function isoWeekNumberUTC(dateUTC) {
  const d = new Date(dateUTC.getTime());
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export function socialWeeklyPeriodKeyFallback() {
  const base = todayKST();
  base.setDate(base.getDate() - 7);
  const date = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  const year = date.getUTCFullYear();
  return `${year}${String(weekNo).padStart(2, "0")}`;
}

export function socialMonthlyPeriodKeyFallback() {
  const d = todayKST();
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  const day = d.getDate();
  const offset = day <= 7 ? 2 : 1;
  month -= offset;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  return `${year}${String(month).padStart(2, "0")}`;
}

export function socialYearlyPeriodKeyFallback() {
  return String(todayKST().getFullYear() - 1);
}

export function extractCurrentIssueKeyFromListItem(termGbn, item) {
  if (!item || typeof item !== "object") return null;
  if (termGbn === "day") return item.YYYYMMDD ?? null;
  if (termGbn === "week") return item.YYYYMMDD ?? item.WeekStart ?? null;
  if (termGbn === "month") return item.YYYYMMDD ?? null;
  if (termGbn === "half") return item.YYYYMMDD ?? null;
  if (termGbn === "year") return item.YYYYMMDD ?? null;
  return null;
}

export function issueKeyToIso(termGbn, issueKey) {
  if (!issueKey) return null;
  if (termGbn === "day") return yyyymmddToIsoUtc(issueKey);
  if (termGbn === "week") return yyyymmddToIsoUtc(issueKey);
  if (termGbn === "month") return yyyymmToIsoUtc(issueKey);
  if (termGbn === "half") return yyyyToIsoUtc(issueKey);
  if (termGbn === "year") return yyyyToIsoUtc(issueKey);
  return null;
}
