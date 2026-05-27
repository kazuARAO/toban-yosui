import { getDamsWithSeries } from "@/lib/dam-data";
import { resolvePeriod } from "@/lib/period";
import { DamChartClient } from "@/components/DamChartClient";
import { DailySummaryChartClient } from "@/components/DailySummaryChartClient";
import { DailyReportTable } from "@/components/DailyReportTable";
import { PeriodSelector } from "@/components/PeriodSelector";
import { RangeStatsCard } from "@/components/RangeStats";
import { PredictionCard } from "@/components/PredictionCard";

// データは 10 分粒度で更新されるので、60 秒キャッシュで十分。
// 同じ URL (period+from+to) なら最大 60 秒は CDN/フルルートキャッシュから即返す。
export const revalidate = 60;

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const period = resolvePeriod(params);
  const payloads = await getDamsWithSeries(period);

  const latestObs = (obs: typeof payloads[number]["observations"]) =>
    [...obs].reverse().find((o) => o.storLvl !== null);

  const latestReport = (rs: typeof payloads[number]["dailyReports"]) =>
    rs[rs.length - 1];

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 font-sans">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">東播用水ダム監視</h1>
        <p className="text-sm text-gray-500 mt-1">
          大川瀬ダム・呑吐ダムの貯水位を 10 分毎に取得。土地改良区の日次貯水率と合わせて表示。
        </p>
      </header>

      <section className="mb-6">
        <div className="text-xs text-gray-500 mb-2">表示期間: {period.label}</div>
        <PeriodSelector current={period.key} from={params.from} to={params.to} />
      </section>

      <div className="grid gap-8 lg:grid-cols-1">
        {payloads.map(({ dam, observations, resolution, dailyReports, weather, daily, stats, prediction }) => {
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

              <div className="mb-2 text-sm font-medium">
                {period.label} ({resolution.bucketLabel} 粒度・{observations.length.toLocaleString()} 点)
              </div>
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

              <div className="mt-6 mb-2 text-sm font-medium">日次サマリー（貯水位平均 + 気温 + 降水量）</div>
              <DailySummaryChartClient
                data={daily}
                damName={dam.name}
                fullLvl={dam.nrmlHighStg}
              />

              <RangeStatsCard stats={stats} rangeLabel={period.label} />

              {prediction && (
                <PredictionCard
                  prediction={prediction}
                  baseStorPcnt={prediction.baseStorPcnt}
                />
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
        </a>{" "}
        ・{" "}
        <a
          href="https://www.jma.go.jp/bosai/amedas/"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          気象庁アメダス
        </a>
      </footer>
    </main>
  );
}
