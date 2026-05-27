"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ObservationPoint } from "@/lib/dam-data";

type Props = {
  data: ObservationPoint[];
  damName: string;
  fullLvl: number | null;
};

function formatTick(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function DamChart({ data, damName, fullLvl }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-8">
        観測データがありません。
      </div>
    );
  }

  // 動的に Y 軸範囲を設定（最小〜最大の周辺＋常時満水位）
  const lvls = data
    .map((d) => d.storLvl)
    .filter((v): v is number => v !== null);
  const minLvl = lvls.length ? Math.min(...lvls) : 0;
  const maxLvl = lvls.length ? Math.max(...lvls) : 0;
  const yMin = Math.floor(minLvl - 0.5);
  const yMax = Math.ceil(Math.max(maxLvl, fullLvl ?? maxLvl) + 0.5);

  return (
    <div style={{ width: "100%", height: 288 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 30, left: 0, bottom: 8 }}>
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
          <Tooltip
            labelFormatter={(v) => formatTick(v as string)}
            formatter={(v, name) => {
              if (typeof v !== "number") return ["-", name];
              return [v.toFixed(2), name];
            }}
          />
          <Legend />
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
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
