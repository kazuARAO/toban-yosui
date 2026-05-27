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
import type { DailyAggregate } from "@/lib/dam-data";

type Props = {
  data: DailyAggregate[];
  damName: string;
  fullLvl: number | null;
};

export function DailySummaryChart({ data, damName, fullLvl }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-6">日次データがありません。</div>
    );
  }

  const lvls = data
    .map((d) => d.storLvlAvg)
    .filter((v): v is number => v !== null);
  const minLvl = lvls.length ? Math.min(...lvls) : 0;
  const maxLvl = lvls.length ? Math.max(...lvls) : 0;
  const yMin = Math.floor(minLvl - 0.5);
  const yMax = Math.ceil(Math.max(maxLvl, fullLvl ?? maxLvl) + 0.5);

  const precipMax = Math.max(
    50,
    ...data.map((d) => d.precipitation).filter((v): v is number => v !== null),
  );

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 60, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={32} />
          <YAxis
            yAxisId="lvl"
            domain={[yMin, yMax]}
            tick={{ fontSize: 11 }}
            label={{ value: "貯水位 (m)", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
          />
          <YAxis
            yAxisId="temp"
            orientation="right"
            tick={{ fontSize: 11, fill: "#b91c1c" }}
            axisLine={{ stroke: "#b91c1c" }}
            tickLine={{ stroke: "#b91c1c" }}
            domain={["dataMin - 2", "dataMax + 2"]}
            label={{ value: "気温 (℃)", angle: 90, position: "insideRight", style: { fontSize: 11, fill: "#b91c1c" } }}
          />
          {/* 実質取水量 (m³/s) 用、左寄り内側に隠れて配置 */}
          <YAxis
            yAxisId="flow"
            orientation="left"
            tick={{ fontSize: 10, fill: "#ea580c" }}
            axisLine={false}
            tickLine={false}
            width={0}
            hide
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
            label={{ value: "雨量(mm/日)", angle: 90, position: "insideRight", offset: -34, style: { fontSize: 11, fill: "#0ea5e9" } }}
          />
          <Tooltip
            formatter={(v, name) => {
              if (typeof v !== "number") return ["-", name];
              return [v.toFixed(2), name];
            }}
          />
          <Legend />
          <Bar
            yAxisId="rain"
            dataKey="precipitation"
            name="降水量"
            fill="#0ea5e9"
            fillOpacity={0.65}
            maxBarSize={24}
          />
          <Line
            yAxisId="lvl"
            type="monotone"
            dataKey="storLvlAvg"
            name={`${damName} 日平均貯水位`}
            stroke="#1e3a8a"
            dot={{ r: 2 }}
            strokeWidth={2}
            connectNulls
          />
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temperatureMax"
            name="最高気温"
            stroke="#b91c1c"
            dot={false}
            strokeWidth={1.4}
            connectNulls
          />
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temperatureMin"
            name="最低気温"
            stroke="#a16207"
            dot={false}
            strokeWidth={1.4}
            strokeDasharray="3 3"
            connectNulls
          />
          <Line
            yAxisId="flow"
            type="monotone"
            dataKey="netWithdrawal"
            name="実質取水量"
            stroke="#ea580c"
            dot={{ r: 2 }}
            strokeWidth={1.8}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
