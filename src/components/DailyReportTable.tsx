import type { DailyReportPoint } from "@/lib/dam-data";

type Props = {
  reports: DailyReportPoint[];
};

export function DailyReportTable({ reports }: Props) {
  if (reports.length === 0) {
    return <div className="text-gray-500 text-sm">日次データなし</div>;
  }
  return (
    <table className="text-sm w-full">
      <thead className="text-left text-gray-500">
        <tr>
          <th className="py-1">日付</th>
          <th className="py-1 text-right">貯水量 (千m³)</th>
          <th className="py-1 text-right">貯水率</th>
        </tr>
      </thead>
      <tbody>
        {reports
          .slice()
          .reverse()
          .map((r) => (
            <tr key={r.reportDate} className="border-t border-gray-200">
              <td className="py-1">{r.reportDate}</td>
              <td className="py-1 text-right">
                {r.storCap !== null ? r.storCap.toLocaleString() : "-"}
              </td>
              <td className="py-1 text-right">
                {r.storPcntIrr !== null
                  ? `${r.storPcntIrr.toFixed(1)}%`
                  : "-"}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
