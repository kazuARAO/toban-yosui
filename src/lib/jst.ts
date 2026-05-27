// JST 用フォーマッタ集（サーバー / クライアント問わず常に JST で表示する）。

const JST_TZ = "Asia/Tokyo";

const dateFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST_TZ,
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const shortDateFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST_TZ,
  month: "numeric",
  day: "numeric",
});

const timeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "5/27 14:16" 形式（JST） */
export function fmtShortDateTime(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  // Intl は ja-JP では "5/27 14:16" だが括弧などが入ることがあるので手組み
  const parts = dateTimeFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

/** "5/27" 形式（JST） */
export function fmtShortDate(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const parts = shortDateFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")}`;
}

/** "14:16" 形式（JST） */
export function fmtTime(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return timeFmt.format(d);
}

/** "2026-05-27" 形式（JST 基準の YYYY-MM-DD） */
export function fmtIsoDate(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const parts = dateFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
