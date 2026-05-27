import { getDamsWithSeries } from "@/lib/dam-data";
import { DamChartClient } from "@/components/DamChartClient";
import { DailyReportTable } from "@/components/DailyReportTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const payloads = await getDamsWithSeries(24 * 7);

  const latestObs = (obs: typeof payloads[number]["observations"]) =>
    [...obs].reverse().find((o) => o.storLvl !== null);

  const latestReport = (rs: typeof payloads[number]["dailyReports"]) =>
    rs[rs.length - 1];

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 font-sans">
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold">東播用水ダム監視</h1>
        <p className="text-sm text-gray-500 mt-1">
          大川瀬ダム・呑吐ダムの貯水位を 10 分毎に取得。土地改良区の日次貯水率と合わせて表示。
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-1">
        {payloads.map(({ dam, observations, dailyReports, weather }) => {
          const obs = latestObs(observations);
          const rep = latestReport(dailyReports);
          return (
            <section
              key={dam.id}
              className="border border-gray-200 rounded-lg p-4 sm:p-6 bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                <h2 className="text-xl font-semibold">{dam.name}</h2>
                <div className="text-xs text-gray-500">
                  {dam.river} ・ {dam.address}
                  {dam.totalCapacity !== null && (
                    <span className="ml-2">
                      総貯水量 {dam.totalCapacity.toLocaleString()} 千m³
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-gray-500 text-xs">最新 貯水位</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {obs?.storLvl != null ? `${obs.storLvl.toFixed(2)} m` : "-"}
                  </div>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-gray-500 text-xs">流入量</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {obs?.allSink != null ? `${obs.allSink.toFixed(2)} m³/s` : "-"}
                  </div>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-gray-500 text-xs">放流量</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {obs?.allDisch != null
                      ? `${obs.allDisch.toFixed(2)} m³/s`
                      : "-"}
                  </div>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-gray-500 text-xs">
                    貯水率（{rep?.reportDate ?? "-"}）
                  </div>
                  <div className="text-lg font-semibold tabular-nums">
                    {rep?.storPcntIrr != null
                      ? `${rep.storPcntIrr.toFixed(1)} %`
                      : "-"}
                  </div>
                </div>
              </div>

              <div className="mb-2 text-sm font-medium">過去 7 日間 (10分毎)</div>
              <DamChartClient
                data={observations}
                weather={weather}
                damName={dam.name}
                fullLvl={dam.nrmlHighStg}
              />
              {weather && (
                <div className="mt-2 text-xs text-gray-500">
                  天気観測所: {weather.name} ({weather.code})
                  {weather.label && <span className="ml-1">— {weather.label}</span>}
                </div>
              )}

              <details className="mt-4">
                <summary className="text-sm text-gray-600 cursor-pointer">
                  日次貯水率履歴 ({dailyReports.length}件)
                </summary>
                <div className="mt-2">
                  <DailyReportTable reports={dailyReports} />
                </div>
              </details>
            </section>
          );
        })}
      </div>

      <footer className="mt-12 text-xs text-gray-500">
        データソース:{" "}
        <a
          href="https://www.river.go.jp/"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          川の防災情報 (国交省)
        </a>{" "}
        ・{" "}
        <a
          href="http://toban-yosui.jp/"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          東播用水土地改良区
        </a>
      </footer>
    </main>
  );
}
