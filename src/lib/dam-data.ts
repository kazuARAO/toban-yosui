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
  observedAt: string; // ISO string (10 分粒度)
  storLvl: number | null;
  allSink: number | null;
  allDisch: number | null;
};

export type DailyReportPoint = {
  reportDate: string; // YYYY-MM-DD
  storCap: number | null;
  storPcntIrr: number | null;
};

export type WeatherPoint = {
  observedDate: string; // YYYY-MM-DD
  precipitation: number | null;
  temperatureAvg: number | null;
  temperatureMax: number | null;
  temperatureMin: number | null;
};

export type WeatherStationInfo = {
  code: string;
  name: string;
  label: string | null;
  points: WeatherPoint[];
};

export type DailyAggregate = {
  date: string; // YYYY-MM-DD JST
  storLvlAvg: number | null;
  storLvlMin: number | null;
  storLvlMax: number | null;
  precipitation: number | null;
  temperatureAvg: number | null;
  temperatureMax: number | null;
  temperatureMin: number | null;
};

export type RangeStats = {
  fromDate: string;     // YYYY-MM-DD
  toDate: string;       // YYYY-MM-DD
  totalPrecipitation: number; // mm
  rainyDays: number;
  maxPrecipitation: number | null;
  maxPrecipitationDate: string | null;
  avgTemperature: number | null;
  maxTemperature: number | null;
  maxTemperatureDate: string | null;
  storLvlStart: number | null;
  storLvlEnd: number | null;
  storLvlDelta: number | null;
};

export type DamPayload = {
  dam: DamSummary;
  observations: ObservationPoint[];
  dailyReports: DailyReportPoint[];
  weather: WeatherStationInfo | null;
  daily: DailyAggregate[];
  stats: RangeStats;
};

function jstYmd(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function aggregateDaily(
  obs: ObservationPoint[],
  weather: WeatherPoint[],
): DailyAggregate[] {
  const buckets = new Map<
    string,
    { lvls: number[] }
  >();
  for (const o of obs) {
    if (o.storLvl === null) continue;
    const date = jstYmd(new Date(o.observedAt));
    if (!buckets.has(date)) buckets.set(date, { lvls: [] });
    buckets.get(date)!.lvls.push(o.storLvl);
  }
  const weatherByDate = new Map<string, WeatherPoint>();
  for (const w of weather) weatherByDate.set(w.observedDate, w);

  const dates = new Set<string>([...buckets.keys(), ...weatherByDate.keys()]);
  const result: DailyAggregate[] = [];
  for (const date of [...dates].sort()) {
    const bucket = buckets.get(date);
    const w = weatherByDate.get(date);
    let avg: number | null = null;
    let min: number | null = null;
    let max: number | null = null;
    if (bucket && bucket.lvls.length > 0) {
      const sum = bucket.lvls.reduce((a, b) => a + b, 0);
      avg = sum / bucket.lvls.length;
      min = Math.min(...bucket.lvls);
      max = Math.max(...bucket.lvls);
    }
    result.push({
      date,
      storLvlAvg: avg,
      storLvlMin: min,
      storLvlMax: max,
      precipitation: w?.precipitation ?? null,
      temperatureAvg: w?.temperatureAvg ?? null,
      temperatureMax: w?.temperatureMax ?? null,
      temperatureMin: w?.temperatureMin ?? null,
    });
  }
  return result;
}

function calcStats(
  daily: DailyAggregate[],
  from: Date,
  to: Date,
): RangeStats {
  let totalPrecip = 0;
  let rainyDays = 0;
  let maxPrecip = -Infinity;
  let maxPrecipDate: string | null = null;
  const temps: number[] = [];
  let maxTemp = -Infinity;
  let maxTempDate: string | null = null;
  let storLvlStart: number | null = null;
  let storLvlEnd: number | null = null;
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
  }
  return {
    fromDate: ymd(from),
    toDate: ymd(to),
    totalPrecipitation: Math.round(totalPrecip * 10) / 10,
    rainyDays,
    maxPrecipitation: maxPrecip === -Infinity ? null : maxPrecip,
    maxPrecipitationDate: maxPrecipDate,
    avgTemperature: temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
    maxTemperature: maxTemp === -Infinity ? null : Math.round(maxTemp * 10) / 10,
    maxTemperatureDate: maxTempDate,
    storLvlStart,
    storLvlEnd,
    storLvlDelta: storLvlStart !== null && storLvlEnd !== null ? Math.round((storLvlEnd - storLvlStart) * 100) / 100 : null,
  };
}

export async function getDamsWithSeries(period: PeriodRange): Promise<DamPayload[]> {
  const dams = await prisma.dam.findMany({ orderBy: { id: "asc" } });

  const result: DamPayload[] = [];
  for (const d of dams) {
    const obs = await prisma.observation.findMany({
      where: {
        damId: d.id,
        source: "kawabou",
        observedAt: { gte: period.from, lte: period.to },
      },
      orderBy: { observedAt: "asc" },
      select: {
        observedAt: true,
        storLvl: true,
        allSink: true,
        allDisch: true,
      },
    });
    const reports = await prisma.dailyReport.findMany({
      where: { damId: d.id },
      orderBy: { reportDate: "desc" },
      take: 30,
      select: { reportDate: true, storCap: true, storPcntIrr: true },
    });

    const primaryLink = await prisma.damWeatherStation.findFirst({
      where: { damId: d.id },
      orderBy: { priority: "asc" },
      include: { station: true },
    });

    let weather: WeatherStationInfo | null = null;
    let weatherPoints: WeatherPoint[] = [];
    if (primaryLink) {
      const weatherRows = await prisma.weather.findMany({
        where: {
          stationCode: primaryLink.stationCode,
          observedDate: { gte: period.from, lte: period.to },
        },
        orderBy: { observedDate: "asc" },
        select: {
          observedDate: true,
          precipitation: true,
          temperatureAvg: true,
          temperatureMax: true,
          temperatureMin: true,
        },
      });
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
      };
    }

    const observations = obs.map((o) => ({
      observedAt: o.observedAt.toISOString(),
      storLvl: o.storLvl,
      allSink: o.allSink,
      allDisch: o.allDisch,
    }));

    const daily = aggregateDaily(observations, weatherPoints);
    const stats = calcStats(daily, period.from, period.to);

    result.push({
      dam: {
        id: d.id,
        code: d.code,
        name: d.name,
        river: d.river,
        address: d.address,
        totalCapacity: d.totalCapacity,
        nrmlHighStg: d.nrmlHighStg,
      },
      observations,
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
    });
  }
  return result;
}
