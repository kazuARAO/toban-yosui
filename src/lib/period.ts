// 期間指定の解釈ヘルパー。URL searchParams (?period=7d|14d|30d|90d|all|custom + from/to) から
// クエリ範囲を組み立てる。
//
// Convention: from/to は JST 0:00 / 23:59:59 として扱う（日付指定の自然な解釈）。

export type PeriodKey = "7d" | "14d" | "30d" | "90d" | "all" | "custom";

const PRESET_HOURS: Record<Exclude<PeriodKey, "all" | "custom">, number> = {
  "7d": 24 * 7,
  "14d": 24 * 14,
  "30d": 24 * 30,
  "90d": 24 * 90,
};

export type PeriodRange = {
  key: PeriodKey;
  from: Date; // 開始日時 (UTC)
  to: Date;   // 終了日時 (UTC)
  label: string;
};

const PRESET_LABELS: Record<PeriodKey, string> = {
  "7d": "過去 7 日",
  "14d": "過去 14 日",
  "30d": "過去 30 日",
  "90d": "過去 90 日",
  all: "全期間",
  custom: "期間指定",
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function startOfJstDay(d: Date): Date {
  const ms = d.getTime();
  const jstMs = ms + JST_OFFSET_MS;
  const dayStartJst = Math.floor(jstMs / 86400000) * 86400000;
  return new Date(dayStartJst - JST_OFFSET_MS);
}

function endOfJstDay(d: Date): Date {
  return new Date(startOfJstDay(d).getTime() + 86400000 - 1);
}

function parseYmd(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  // JST 0:00 として解釈
  const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0));
  return new Date(utc.getTime() - JST_OFFSET_MS);
}

/** 全期間モードでの最古 from。データソース (kawabou) は 2 週間しかないが、念のため 2 年前まで遡る。 */
const ALL_FROM = new Date("2024-01-01T00:00:00Z");

export function resolvePeriod(searchParams: Record<string, string | undefined>): PeriodRange {
  const rawPeriod = (searchParams.period ?? "7d").toLowerCase();
  const now = new Date();
  const to = now;

  if (rawPeriod === "all") {
    return { key: "all", from: ALL_FROM, to, label: PRESET_LABELS.all };
  }

  if (rawPeriod === "custom") {
    const fromParsed = parseYmd(searchParams.from);
    const toParsed = parseYmd(searchParams.to);
    const from = fromParsed ?? startOfJstDay(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    const toEnd = toParsed ? endOfJstDay(toParsed) : to;
    const label = `${ymd(from)} 〜 ${ymd(toEnd)}`;
    return { key: "custom", from, to: toEnd, label };
  }

  const hours = PRESET_HOURS[rawPeriod as Exclude<PeriodKey, "all" | "custom">];
  if (hours) {
    return {
      key: rawPeriod as PeriodKey,
      from: new Date(now.getTime() - hours * 60 * 60 * 1000),
      to,
      label: PRESET_LABELS[rawPeriod as PeriodKey],
    };
  }

  // fallback
  return { key: "7d", from: new Date(now.getTime() - PRESET_HOURS["7d"] * 3600_000), to, label: PRESET_LABELS["7d"] };
}

export function ymd(d: Date): string {
  // JST の YYYY-MM-DD
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

export const PERIOD_PRESETS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7日" },
  { key: "14d", label: "14日" },
  { key: "30d", label: "30日" },
  { key: "90d", label: "90日" },
  { key: "all", label: "全期間" },
  { key: "custom", label: "期間指定" },
];
