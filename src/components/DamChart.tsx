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
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
    for (const w of weather.points) {
      // 各日の正午（JST 12:00）にバーを配置
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
  return points.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
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

  const precipMax = Math.max(
    50, // 最低でも 50mm/日まで表示（雨無しの日も棒スペース確保）
    ...(weather?.points
      .map((w) => w.precipitation)
      .filter((v): v is number => v !== null) ?? []),
  );

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
          {/* 左軸：貯水位 */}
          <YAxis
            yAxisId="lvl"
            domain={[yMin, yMax]}
            tick={{ fontSize: 12 }}
            label={{ value: "貯水位 (m)", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
          />
          {/* 右軸：流入・放流量 */}
          <YAxis
            yAxisId="flow"
            orientation="right"
            tick={{ fontSize: 12 }}
            label={{ value: "流量 (m³/s)", angle: 90, position: "insideRight", style: { fontSize: 12 } }}
          />
          {/* 右第2軸：降水量（上から下に伸びるバー = reversed） */}
          <YAxis
            yAxisId="rain"
            orientation="right"
            reversed
            domain={[0, precipMax]}
            tick={{ fontSize: 10, fill: "#0891b2" }}
            axisLine={{ stroke: "#0891b2" }}
            tickLine={{ stroke: "#0891b2" }}
            width={36}
            label={{ value: "雨量(mm/日)", angle: 90, position: "insideRight", offset: -34, style: { fontSize: 11, fill: "#0891b2" } }}
          />
          <Tooltip
            labelFormatter={(v) => formatTick(v as string)}
            formatter={(v, name) => {
              if (typeof v !== "number") return ["-", name];
              return [v.toFixed(2), name];
            }}
          />
          <Legend />
          {/* 降水量バー（最初に描いて他の線が前面に） */}
          <Bar
            yAxisId="rain"
            dataKey="precipitation"
            name={weather ? `降水量 (${weather.name})` : "降水量"}
            fill="#0891b2"
            fillOpacity={0.55}
            maxBarSize={20}
          />
          <Line
            yAxisId="lvl"
            type="monotone"
            dataKey="storLvl"
            name={`${damName} 貯水位`}
            stroke="#2563eb"
            dot={false}
            strokeWidth={2}
            connectNulls={false}
          />
          <Line
            yAxisId="flow"
            type="monotone"
            dataKey="allSink"
            name="流入量"
            stroke="#059669"
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
          />
          <Line
            yAxisId="flow"
            type="monotone"
            dataKey="allDisch"
            name="放流量"
            stroke="#d97706"
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
