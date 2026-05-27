"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ObservationPoint,
  WeatherStationInfo,
} from "@/lib/dam-data";
import { fmtShortDateTime, fmtIsoDate } from "@/lib/jst";

type Props = {
  data: ObservationPoint[];
  weather: WeatherStationInfo | null;
  damName: string;
  fullLvl: number | null;
};

type ChartPoint = {
  observedAt: string;
  storLvl: number | null;
  allSink: number | null;
  allDisch: number | null;
  precipitation: number | null;
};

function formatTick(iso: string): string {
  return fmtShortDateTime(iso);
}

function jstDate(iso: string): string {
  // YYYY-MM-DD in JST
  return fmtIsoDate(iso);
}

/** 10 分粒度の降水量を 1 時間ごとに集計（表示密度を抑える）。
 *  各時間の終了時刻 (HH:50 ~ HH+1:00) に総和を割り当てるイメージ。
 */
function aggregateHourly(
  series: { observedAt: string; precipitation: number | null }[],
): { observedAt: string; precipitation: number }[] {
  const byHour = new Map<string, number>();
  for (const w of series) {
    if (w.precipitation === null) continue;
    const d = new Date(w.observedAt);
    d.setUTCMinutes(0, 0, 0); // UTC で時間頭にスナップ
    const key = d.toISOString();
    byHour.set(key, (byHour.get(key) ?? 0) + w.precipitation);
  }
  return [...byHour.entries()]
    .map(([k, v]) => ({ observedAt: k, precipitation: v }))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

function mergeWeather(
  obs: ObservationPoint[],
  weather: WeatherStationInfo | null,
): ChartPoint[] {
  const points: ChartPoint[] = obs.map((o) => ({
    observedAt: o.observedAt,
    storLvl: o.storLvl,
    allSink: o.allSink,
    allDisch: o.allDisch,
    precipitation: null,
  }));
  if (weather) {
    if (weather.series && weather.series.length > 0) {
      // 10 分粒度を時間集計して描画密度を下げる
      for (const w of aggregateHourly(weather.series)) {
        points.push({
          observedAt: w.observedAt,
          storLvl: null,
          allSink: null,
          allDisch: null,
          precipitation: w.precipitation,
        });
      }
    } else {
      for (const w of weather.points) {
        const ts = new Date(`${w.observedDate}T12:00:00+09:00`).toISOString();
        points.push({
          observedAt: ts,
          storLvl: null,
          allSink: null,
          allDisch: null,
          precipitation: w.precipitation,
        });
      }
    }
  }
  return points.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

type CustomTooltipExtra = {
  precipByDate: Map<string, number | null>;
  tempByDate: Map<string, { avg: number | null; max: number | null; min: number | null }>;
  weatherStationName: string | null;
};

// Recharts の Tooltip content から渡る型は厳密に書くと噛み合わないので、必要なキーだけ unknown で受ける。
type CustomTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<unknown>;
} & CustomTooltipExtra;

function CustomTooltip(props: CustomTooltipProps) {
  if (!props.active || props.label === undefined) return null;
  const labelStr = String(props.label);
  const time = formatTick(labelStr);
  const date = jstDate(labelStr);
  const precip = props.precipByDate.get(date);
  const temp = props.tempByDate.get(date);

  const items: { name: string; value: string; color?: string }[] = [];
  for (const raw of props.payload ?? []) {
    const p = raw as { name?: unknown; value?: unknown; color?: string; dataKey?: unknown };
    if (typeof p.value === "number") {
      const dk = typeof p.dataKey === "string" ? p.dataKey : "";
      let unit = "";
      if (dk === "storLvl") unit = " m";
      else if (dk === "allSink" || dk === "allDisch") unit = " m³/s";
      else if (dk === "precipitation") unit = " mm";
      items.push({
        name: String(p.name ?? dk),
        value: `${p.value.toFixed(2)}${unit}`,
        color: p.color,
      });
    }
  }
  // 観測点側 (10分粒度) で payload に precipitation が無いケースが多いので、別途日次値を補足
  if (precip !== undefined && precip !== null && !items.some((i) => i.name.includes("降水量"))) {
    items.push({
      name: `当日降水量${props.weatherStationName ? ` (${props.weatherStationName})` : ""}`,
      value: `${precip.toFixed(1)} mm`,
      color: "#0ea5e9",
    });
  }

  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm p-2 text-xs">
      <div className="font-medium mb-1">{time}</div>
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2">
            {it.color && (
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ background: it.color }}
              />
            )}
            <span className="text-gray-600">{it.name}:</span>
            <span className="font-semibold tabular-nums">{it.value}</span>
          </li>
        ))}
        {temp && (temp.max !== null || temp.min !== null) && (
          <li className="text-gray-500 mt-1 border-t pt-1">
            気温: {temp.max?.toFixed(1) ?? "-"} ℃ / {temp.min?.toFixed(1) ?? "-"} ℃ (最高/最低)
          </li>
        )}
      </ul>
    </div>
  );
}

export function DamChart({ data, weather, damName, fullLvl }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-8">観測データがありません。</div>
    );
  }

  const merged = mergeWeather(data, weather);

  const lvls = data.map((d) => d.storLvl).filter((v): v is number => v !== null);
  const minLvl = lvls.length ? Math.min(...lvls) : 0;
  const maxLvl = lvls.length ? Math.max(...lvls) : 0;
  const yMin = Math.floor(minLvl - 0.5);
  const yMax = Math.ceil(Math.max(maxLvl, fullLvl ?? maxLvl) + 0.5);

  // 時間集計後の最大値を使って Y 軸スケールを決定。
  const hourlyRain = weather?.series ? aggregateHourly(weather.series) : [];
  const hourlyMax = Math.max(5, ...hourlyRain.map((w) => w.precipitation));
  // 雨量バーが画面の上 1/4 以内に収まるスケール
  const precipMax = hourlyMax * 4;

  const precipByDate = new Map<string, number | null>();
  const tempByDate = new Map<
    string,
    { avg: number | null; max: number | null; min: number | null }
  >();
  if (weather) {
    for (const w of weather.points) {
      precipByDate.set(w.observedDate, w.precipitation);
      tempByDate.set(w.observedDate, {
        avg: w.temperatureAvg,
        max: w.temperatureMax,
        min: w.temperatureMin,
      });
    }
  }

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={merged} margin={{ top: 16, right: 50, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="observedAt"
            tickFormatter={formatTick}
            minTickGap={64}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            yAxisId="lvl"
            domain={[yMin, yMax]}
            tick={{ fontSize: 12 }}
            label={{ value: "貯水位 (m)", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
          />
          <YAxis
            yAxisId="flow"
            orientation="right"
            tick={{ fontSize: 12 }}
            label={{ value: "流量 (m³/s)", angle: 90, position: "insideRight", style: { fontSize: 12 } }}
          />
          <YAxis
            yAxisId="rain"
            orientation="right"
            reversed
            domain={[0, precipMax]}
            tick={{ fontSize: 10, fill: "#0ea5e9" }}
            axisLine={{ stroke: "#0ea5e9" }}
            tickLine={{ stroke: "#0ea5e9" }}
            width={36}
            label={{ value: "雨量(mm/h)", angle: 90, position: "insideRight", offset: -34, style: { fontSize: 11, fill: "#0ea5e9" } }}
          />
          <Tooltip
            content={(p) => (
              <CustomTooltip
                {...p}
                precipByDate={precipByDate}
                tempByDate={tempByDate}
                weatherStationName={weather?.name ?? null}
              />
            )}
          />
          <Legend />
          <Bar
            yAxisId="rain"
            dataKey="precipitation"
            name={weather ? `降水量 (${weather.name}, 1h)` : "降水量"}
            fill="#0ea5e9"
            fillOpacity={0.65}
            maxBarSize={12}
          />
          <Line
            yAxisId="lvl"
            type="monotone"
            dataKey="storLvl"
            name={`${damName} 貯水位`}
            stroke="#1e3a8a"
            dot={false}
            strokeWidth={2}
            connectNulls={false}
          />
          <Line
            yAxisId="flow"
            type="monotone"
            dataKey="allSink"
            name="流入量"
            stroke="#15803d"
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
          />
          <Line
            yAxisId="flow"
            type="monotone"
            dataKey="allDisch"
            name="放流量"
            stroke="#dc2626"
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
