import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { PeriodRange } from "./period";
import { ymd } from "./period";

export type DamSummary = {
  id: number;
  code: string;
  name: string;
  river: string | null;
  address: string | null;
  totalCapacity: number | null;
  nrmlHighStg: number | null;
};

export type ObservationPoint = {
  observedAt: string; // ISO string
  storLvl: number | null;
  allSink: number | null;
  allDisch: number | null;
};

export type DailyReportPoint = {
  reportDate: string;
  storCap: number | null;
  storPcntIrr: number | null;
};

export type WeatherPoint = {
  observedDate: string;
  precipitation: number | null;
  temperatureAvg: number | null;
  temperatureMax: number | null;
  temperatureMin: number | null;
};

export type WeatherSeriesPoint = {
  observedAt: string; // ISO 10 分粒度
  precipitation: number | null; // mm/期間
  temperature: number | null;
};

export type WeatherStationInfo = {
  code: string;
  name: string;
  label: string | null;
  points: WeatherPoint[];      // 日次集計 (DailySummaryChart, RangeStats 用)
  series: WeatherSeriesPoint[]; // 10 分粒度 (DamChart オーバーレイ用)
};

export type DailyAggregate = {
  date: string;
  storLvlAvg: number | null;
  storLvlMin: number | null;
  storLvlMax: number | null;
  precipitation: number | null;
  temperatureAvg: number | null;
  temperatureMax: number | null;
  temperatureMin: number | null;
  // 日次平均流入・放流（m³/s）
  inflowAvg: number | null;
  dischargeAvg: number | null;
  // 当日の貯水量 (千m³)
  storCap: number | null;
  // 実質取水量 (m³/s): 流入 - 放流 - 貯水量変化/日
  //   負値は逆に「正味で蓄積された」ことを意味する（雨で増えた場合など）
  netWithdrawal: number | null;
};

export type RangeStats = {
  fromDate: string;
  toDate: string;
  totalPrecipitation: number;
  rainyDays: number;
  maxPrecipitation: number | null;
  maxPrecipitationDate: string | null;
  avgTemperature: number | null;
  maxTemperature: number | null;
  maxTemperatureDate: string | null;
  storLvlStart: number | null;
  storLvlEnd: number | null;
  storLvlDelta: number | null;
  // 期間中の平均実質取水量 (m³/s)
  avgNetWithdrawal: number | null;
  // 期間中の実質取水量合計 (m³)
  totalNetWithdrawal: number | null;
};

export type ResolutionInfo = {
  bucketLabel: string;  // 表示用 "10分" / "1時間" / "6時間" / "1日"
  bucketUnit: "minute" | "hour" | "day"; // Postgres date_trunc 単位
  bucketSize: number;   // 単位を何個まとめるか (10分 = unit "minute" + size 10)
};

export type PredictionScenarios = {
  optimistic7d: number | null;
  standard7d: number | null;
  pessimistic7d: number | null;
  optimistic30d: number | null;
  standard30d: number | null;
  pessimistic30d: number | null;
  daysTo30pct: number | null;
  actual7d: number | null;
  actual30d: number | null;
};

export type LLMForecastInfo = {
  provider: string; // 'claude' | 'openai' | 'gemini'
  model: string;
  predicted7d: number | null;
  predicted30d: number | null;
  warningLevel: string | null;
  reasoning: string | null;
  error: string | null;
  actual7d: number | null;
  actual30d: number | null;
};

export type PredictionInfo = {
  runId: number;
  generatedAt: string;
  baseStorPcnt: number;
  baseObservedAt: string;
  deterministic: PredictionScenarios | null;
  llms: LLMForecastInfo[];
};

export type DamPayload = {
  dam: DamSummary;
  observations: ObservationPoint[];
  resolution: ResolutionInfo;
  dailyReports: DailyReportPoint[];
  weather: WeatherStationInfo | null;
  daily: DailyAggregate[];
  stats: RangeStats;
  prediction: PredictionInfo | null;
};

/** 期間長から表示用解像度を決定。点数を概ね 1,500 以下に保つ。 */
function selectResolution(from: Date, to: Date): ResolutionInfo {
  const hours = (to.getTime() - from.getTime()) / 3600_000;
  if (hours <= 24 * 7) return { bucketLabel: "10分", bucketUnit: "minute", bucketSize: 10 };
  if (hours <= 24 * 30) return { bucketLabel: "1時間", bucketUnit: "hour", bucketSize: 1 };
  if (hours <= 24 * 90) return { bucketLabel: "6時間", bucketUnit: "hour", bucketSize: 6 };
  return { bucketLabel: "1日", bucketUnit: "day", bucketSize: 1 };
}

function jstYmd(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 観測解像度に合わせて 10 分粒度の天気データを集約取得。 */
async function fetchWeatherSeries(
  stationCode: string,
  from: Date,
  to: Date,
  resolution: ResolutionInfo,
): Promise<WeatherSeriesPoint[]> {
  // 10 分粒度のときは元データ
  if (resolution.bucketUnit === "minute" && resolution.bucketSize === 10) {
    const rows = await prisma.weatherObservation.findMany({
      where: {
        stationCode,
        observedAt: { gte: from, lte: to },
      },
      orderBy: { observedAt: "asc" },
      select: {
        observedAt: true,
        precipitation10m: true,
        temperature: true,
      },
    });
    return rows.map((r) => ({
      observedAt: r.observedAt.toISOString(),
      precipitation: r.precipitation10m,
      temperature: r.temperature,
    }));
  }

  // ラスター集約 (1h / 6h / 1d)
  const truncExpr =
    resolution.bucketUnit === "day"
      ? Prisma.sql`date_trunc('day', "observedAt")`
      : resolution.bucketSize === 1
        ? Prisma.sql`date_trunc('hour', "observedAt")`
        : Prisma.sql`date_trunc('hour', "observedAt") - (EXTRACT(hour FROM "observedAt")::int % ${resolution.bucketSize}) * INTERVAL '1 hour'`;

  const rows = await prisma.$queryRaw<
    Array<{ bucket: Date; precipitation: number | null; temperature: number | null }>
  >(
    Prisma.sql`
      SELECT
        ${truncExpr} AS bucket,
        SUM("precipitation10m") AS precipitation,
        AVG(temperature) AS temperature
      FROM "WeatherObservation"
      WHERE "stationCode" = ${stationCode}
        AND "observedAt" >= ${from}
        AND "observedAt" <= ${to}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
  );
  return rows.map((r) => ({
    observedAt: r.bucket.toISOString(),
    precipitation: r.precipitation !== null ? Number(r.precipitation) : null,
    temperature: r.temperature !== null ? Number(r.temperature) : null,
  }));
}

/** Postgres 側で date_trunc + 集約して観測値を返す。 */
async function fetchObservations(
  damId: number,
  from: Date,
  to: Date,
  resolution: ResolutionInfo,
): Promise<ObservationPoint[]> {
  // 10 分粒度のときは元データをそのまま返す（date_trunc('minute', ...) では 10 分集約できないため別経路）
  if (resolution.bucketUnit === "minute" && resolution.bucketSize === 10) {
    const rows = await prisma.observation.findMany({
      where: {
        damId,
        source: "kawabou",
        observedAt: { gte: from, lte: to },
      },
      orderBy: { observedAt: "asc" },
      select: { observedAt: true, storLvl: true, allSink: true, allDisch: true },
    });
    return rows.map((r) => ({
      observedAt: r.observedAt.toISOString(),
      storLvl: r.storLvl,
      allSink: r.allSink,
      allDisch: r.allDisch,
    }));
  }

  // 1時間/6時間/1日 はラスター集約 SQL
  const truncExpr =
    resolution.bucketUnit === "day"
      ? Prisma.sql`date_trunc('day', "observedAt")`
      : resolution.bucketSize === 1
        ? Prisma.sql`date_trunc('hour', "observedAt")`
        : // 6時間集約: 時刻を6h単位に丸める
          Prisma.sql`date_trunc('hour', "observedAt") - (EXTRACT(hour FROM "observedAt")::int % ${resolution.bucketSize}) * INTERVAL '1 hour'`;

  const rows = await prisma.$queryRaw<
    Array<{ bucket: Date; stor_lvl: number | null; all_sink: number | null; all_disch: number | null }>
  >(
    Prisma.sql`
      SELECT
        ${truncExpr} AS bucket,
        AVG("storLvl") AS stor_lvl,
        AVG("allSink") AS all_sink,
        AVG("allDisch") AS all_disch
      FROM "Observation"
      WHERE "damId" = ${damId}
        AND source = 'kawabou'
        AND "observedAt" >= ${from}
        AND "observedAt" <= ${to}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
  );

  return rows.map((r) => ({
    observedAt: r.bucket.toISOString(),
    storLvl: r.stor_lvl !== null ? Number(r.stor_lvl) : null,
    allSink: r.all_sink !== null ? Number(r.all_sink) : null,
    allDisch: r.all_disch !== null ? Number(r.all_disch) : null,
  }));
}

function aggregateDaily(
  obs: ObservationPoint[],
  weather: WeatherPoint[],
  dailyReports: { reportDate: string; storCap: number | null }[],
): DailyAggregate[] {
  type Bucket = { lvls: number[]; ins: number[]; outs: number[] };
  const buckets = new Map<string, Bucket>();
  for (const o of obs) {
    const date = jstYmd(new Date(o.observedAt));
    if (!buckets.has(date)) buckets.set(date, { lvls: [], ins: [], outs: [] });
    const b = buckets.get(date)!;
    if (o.storLvl !== null) b.lvls.push(o.storLvl);
    if (o.allSink !== null) b.ins.push(o.allSink);
    if (o.allDisch !== null) b.outs.push(o.allDisch);
  }
  const weatherByDate = new Map<string, WeatherPoint>();
  for (const w of weather) weatherByDate.set(w.observedDate, w);
  const storCapByDate = new Map<string, number>();
  for (const r of dailyReports) {
    if (r.storCap !== null) storCapByDate.set(r.reportDate, r.storCap);
  }

  const dates = new Set<string>([
    ...buckets.keys(),
    ...weatherByDate.keys(),
    ...storCapByDate.keys(),
  ]);
  const sortedDates = [...dates].sort();
  const out: DailyAggregate[] = [];
  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    const b = buckets.get(date);
    const w = weatherByDate.get(date);
    const storCap = storCapByDate.get(date) ?? null;

    let avg: number | null = null;
    let min: number | null = null;
    let max: number | null = null;
    if (b && b.lvls.length > 0) {
      avg = b.lvls.reduce((a, b) => a + b, 0) / b.lvls.length;
      min = Math.min(...b.lvls);
      max = Math.max(...b.lvls);
    }
    const inflowAvg = b && b.ins.length > 0
      ? b.ins.reduce((a, b) => a + b, 0) / b.ins.length
      : null;
    const dischargeAvg = b && b.outs.length > 0
      ? b.outs.reduce((a, b) => a + b, 0) / b.outs.length
      : null;

    // 実質取水量 = 流入 - 放流 - (今日の貯水量 - 昨日の貯水量) / 86400 * 1000
    // 貯水量変化が負（減）なら -(-x) = +x で取水側に寄与
    let netWithdrawal: number | null = null;
    const prevDate = sortedDates[i - 1];
    const prevStorCap = prevDate ? (storCapByDate.get(prevDate) ?? null) : null;
    if (
      storCap !== null && prevStorCap !== null &&
      inflowAvg !== null && dischargeAvg !== null
    ) {
      const dStorageM3PerSec = (storCap - prevStorCap) * 1000 / 86400;
      netWithdrawal = inflowAvg - dischargeAvg - dStorageM3PerSec;
    }

    out.push({
      date,
      storLvlAvg: avg,
      storLvlMin: min,
      storLvlMax: max,
      precipitation: w?.precipitation ?? null,
      temperatureAvg: w?.temperatureAvg ?? null,
      temperatureMax: w?.temperatureMax ?? null,
      temperatureMin: w?.temperatureMin ?? null,
      inflowAvg,
      dischargeAvg,
      storCap,
      netWithdrawal,
    });
  }
  return out;
}

function calcStats(daily: DailyAggregate[], from: Date, to: Date): RangeStats {
  let totalPrecip = 0;
  let rainyDays = 0;
  let maxPrecip = -Infinity;
  let maxPrecipDate: string | null = null;
  const temps: number[] = [];
  let maxTemp = -Infinity;
  let maxTempDate: string | null = null;
  let storLvlStart: number | null = null;
  let storLvlEnd: number | null = null;

  const withdrawals: number[] = [];

  for (const d of daily) {
    if (d.precipitation !== null) {
      totalPrecip += d.precipitation;
      if (d.precipitation >= 1.0) rainyDays += 1;
      if (d.precipitation > maxPrecip) {
        maxPrecip = d.precipitation;
        maxPrecipDate = d.date;
      }
    }
    if (d.temperatureAvg !== null) temps.push(d.temperatureAvg);
    if (d.temperatureMax !== null && d.temperatureMax > maxTemp) {
      maxTemp = d.temperatureMax;
      maxTempDate = d.date;
    }
    if (d.storLvlAvg !== null) {
      if (storLvlStart === null) storLvlStart = d.storLvlAvg;
      storLvlEnd = d.storLvlAvg;
    }
    if (d.netWithdrawal !== null) withdrawals.push(d.netWithdrawal);
  }

  const avgWithdrawal = withdrawals.length
    ? withdrawals.reduce((a, b) => a + b, 0) / withdrawals.length
    : null;
  const totalWithdrawal = avgWithdrawal !== null
    ? avgWithdrawal * 86400 * withdrawals.length
    : null;

  return {
    fromDate: ymd(from),
    toDate: ymd(to),
    totalPrecipitation: Math.round(totalPrecip * 10) / 10,
    rainyDays,
    maxPrecipitation: maxPrecip === -Infinity ? null : maxPrecip,
    maxPrecipitationDate: maxPrecipDate,
    avgTemperature:
      temps.length
        ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10
        : null,
    maxTemperature: maxTemp === -Infinity ? null : Math.round(maxTemp * 10) / 10,
    maxTemperatureDate: maxTempDate,
    storLvlStart,
    storLvlEnd,
    storLvlDelta:
      storLvlStart !== null && storLvlEnd !== null
        ? Math.round((storLvlEnd - storLvlStart) * 100) / 100
        : null,
    avgNetWithdrawal: avgWithdrawal,
    totalNetWithdrawal: totalWithdrawal,
  };
}

async function buildDamPayload(
  dam: {
    id: number;
    code: string;
    name: string;
    river: string | null;
    address: string | null;
    totalCapacity: number | null;
    nrmlHighStg: number | null;
  },
  from: Date,
  to: Date,
  resolution: ResolutionInfo,
): Promise<DamPayload> {
  // 4 つを並列に
  const [observations, reports, primaryLink, latestPrediction] = await Promise.all([
    fetchObservations(dam.id, from, to, resolution),
    prisma.dailyReport.findMany({
      where: { damId: dam.id },
      orderBy: { reportDate: "desc" },
      take: 30,
      select: { reportDate: true, storCap: true, storPcntIrr: true },
    }),
    prisma.damWeatherStation.findFirst({
      where: { damId: dam.id },
      orderBy: { priority: "asc" },
      include: { station: true },
    }),
    prisma.predictionRun.findFirst({
      where: { damId: dam.id },
      orderBy: { generatedAt: "desc" },
      include: {
        deterministic: true,
        llmForecasts: { orderBy: { provider: "asc" } },
      },
    }),
  ]);

  let weather: WeatherStationInfo | null = null;
  let weatherPoints: WeatherPoint[] = [];
  if (primaryLink) {
    const [weatherRows, weatherSeriesRows] = await Promise.all([
      prisma.weather.findMany({
        where: {
          stationCode: primaryLink.stationCode,
          observedDate: { gte: from, lte: to },
        },
        orderBy: { observedDate: "asc" },
        select: {
          observedDate: true,
          precipitation: true,
          temperatureAvg: true,
          temperatureMax: true,
          temperatureMin: true,
        },
      }),
      fetchWeatherSeries(primaryLink.stationCode, from, to, resolution),
    ]);
    weatherPoints = weatherRows.map((w) => ({
      observedDate: w.observedDate.toISOString().slice(0, 10),
      precipitation: w.precipitation,
      temperatureAvg: w.temperatureAvg,
      temperatureMax: w.temperatureMax,
      temperatureMin: w.temperatureMin,
    }));
    weather = {
      code: primaryLink.station.code,
      name: primaryLink.station.name,
      label: primaryLink.label,
      points: weatherPoints,
      series: weatherSeriesRows,
    };
  }

  const dailyReportsForCalc = reports.map((r) => ({
    reportDate: r.reportDate.toISOString().slice(0, 10),
    storCap: r.storCap,
  }));
  const daily = aggregateDaily(observations, weatherPoints, dailyReportsForCalc);
  const stats = calcStats(daily, from, to);

  let prediction: PredictionInfo | null = null;
  if (latestPrediction) {
    prediction = {
      runId: latestPrediction.id,
      generatedAt: latestPrediction.generatedAt.toISOString(),
      baseStorPcnt: latestPrediction.baseStorPcnt,
      baseObservedAt: latestPrediction.baseObservedAt.toISOString(),
      deterministic: latestPrediction.deterministic
        ? {
            optimistic7d: latestPrediction.deterministic.optimistic7d,
            standard7d: latestPrediction.deterministic.standard7d,
            pessimistic7d: latestPrediction.deterministic.pessimistic7d,
            optimistic30d: latestPrediction.deterministic.optimistic30d,
            standard30d: latestPrediction.deterministic.standard30d,
            pessimistic30d: latestPrediction.deterministic.pessimistic30d,
            daysTo30pct: latestPrediction.deterministic.daysTo30pct,
            actual7d: latestPrediction.deterministic.actual7d,
            actual30d: latestPrediction.deterministic.actual30d,
          }
        : null,
      llms: latestPrediction.llmForecasts.map((f) => ({
        provider: f.provider,
        model: f.model,
        predicted7d: f.predicted7d,
        predicted30d: f.predicted30d,
        warningLevel: f.warningLevel,
        reasoning: f.reasoning,
        error: f.errorMessage,
        actual7d: f.actual7d,
        actual30d: f.actual30d,
      })),
    };
  }

  return {
    dam,
    observations,
    resolution,
    dailyReports: reports
      .map((r) => ({
        reportDate: r.reportDate.toISOString().slice(0, 10),
        storCap: r.storCap,
        storPcntIrr: r.storPcntIrr,
      }))
      .reverse(),
    weather,
    daily,
    stats,
    prediction,
  };
}

export async function getDamsWithSeries(period: PeriodRange): Promise<DamPayload[]> {
  const dams = await prisma.dam.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      river: true,
      address: true,
      totalCapacity: true,
      nrmlHighStg: true,
    },
  });
  const resolution = selectResolution(period.from, period.to);
  return Promise.all(dams.map((d) => buildDamPayload(d, period.from, period.to, resolution)));
}
