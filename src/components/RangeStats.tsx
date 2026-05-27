import type { RangeStats } from "@/lib/dam-data";

type Props = { stats: RangeStats; rangeLabel: string };

export function RangeStatsCard({ stats, rangeLabel }: Props) {
  const items: { label: string; value: string }[] = [
    {
      label: "降水量合計",
      value: `${stats.totalPrecipitation.toLocaleString()} mm`,
    },
    {
      label: "雨日数 (≥1mm)",
      value: `${stats.rainyDays} 日`,
    },
    {
      label: "最大日降水量",
      value:
        stats.maxPrecipitation !== null
          ? `${stats.maxPrecipitation.toFixed(1)} mm (${stats.maxPrecipitationDate})`
          : "-",
    },
    {
      label: "平均気温",
      value:
        stats.avgTemperature !== null
          ? `${stats.avgTemperature.toFixed(1)} ℃`
          : "-",
    },
    {
      label: "最高気温",
      value:
        stats.maxTemperature !== null
          ? `${stats.maxTemperature.toFixed(1)} ℃ (${stats.maxTemperatureDate})`
          : "-",
    },
    {
      label: "貯水位変化",
      value:
        stats.storLvlDelta !== null
          ? `${stats.storLvlDelta > 0 ? "+" : ""}${stats.storLvlDelta.toFixed(2)} m`
          : "-",
    },
    {
      label: "実質取水量 (推定平均)",
      value:
        stats.avgNetWithdrawal !== null
          ? `${stats.avgNetWithdrawal.toFixed(2)} m³/s`
          : "- (要日次貯水量データ)",
    },
  ];

  return (
    <div className="bg-blue-50/40 border border-blue-100 rounded-md p-3 mt-4">
      <div className="text-xs text-blue-900 mb-2 font-medium">
        {rangeLabel} 統計サマリー
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col">
            <dt className="text-xs text-gray-500">{it.label}</dt>
            <dd className="font-semibold tabular-nums">{it.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
