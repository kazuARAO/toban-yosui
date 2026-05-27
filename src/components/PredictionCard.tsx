import type { PredictionInfo } from "@/lib/dam-data";

type Props = { prediction: PredictionInfo; baseStorPcnt: number };

const PROVIDER_META: Record<string, { label: string; color: string }> = {
  claude: { label: "Claude Opus 4.7", color: "#7c3aed" },
  openai: { label: "GPT-5.5", color: "#0ea5e9" },
  gemini: { label: "Gemini 3.1 Pro", color: "#16a34a" },
};

const WARN_BADGE: Record<string, string> = {
  low: "bg-green-100 text-green-800",
  mid: "bg-yellow-100 text-yellow-800",
  high: "bg-red-100 text-red-800",
};

function fmt(v: number | null): string {
  return v === null ? "-" : `${v.toFixed(1)}%`;
}

function daysLabel(days: number | null): string {
  if (days === null) return "-";
  if (days >= 9999) return "予測範囲外（30 日内に到達せず）";
  if (days >= 365) return `約 ${Math.round(days / 30)} ヶ月後`;
  return `${days} 日後`;
}

export function PredictionCard({ prediction, baseStorPcnt }: Props) {
  const det = prediction.deterministic;
  const llms = prediction.llms;
  const generatedAt = new Date(prediction.generatedAt);
  const generatedLabel = `${generatedAt.getMonth() + 1}/${generatedAt.getDate()} ${String(generatedAt.getHours()).padStart(2, "0")}:${String(generatedAt.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="mt-6 border border-purple-100 bg-purple-50/30 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-purple-900">📡 予測 (実験中)</h3>
        <span className="text-xs text-gray-500">生成: {generatedLabel} / 基準貯水率 {baseStorPcnt.toFixed(1)}%</span>
      </div>

      {/* 決定論的 3 シナリオ */}
      {det && (
        <div className="mb-4">
          <div className="text-xs text-gray-600 mb-2">決定論的 3 シナリオ (簡易物理モデル)</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="bg-white border border-emerald-100 rounded p-2">
              <div className="text-xs text-emerald-700">🟢 楽観</div>
              <div className="tabular-nums">7d: <span className="font-semibold">{fmt(det.optimistic7d)}</span></div>
              <div className="tabular-nums">30d: <span className="font-semibold">{fmt(det.optimistic30d)}</span></div>
            </div>
            <div className="bg-white border border-blue-100 rounded p-2">
              <div className="text-xs text-blue-700">🟡 標準</div>
              <div className="tabular-nums">7d: <span className="font-semibold">{fmt(det.standard7d)}</span></div>
              <div className="tabular-nums">30d: <span className="font-semibold">{fmt(det.standard30d)}</span></div>
            </div>
            <div className="bg-white border border-rose-100 rounded p-2">
              <div className="text-xs text-rose-700">🔴 悲観</div>
              <div className="tabular-nums">7d: <span className="font-semibold">{fmt(det.pessimistic7d)}</span></div>
              <div className="tabular-nums">30d: <span className="font-semibold">{fmt(det.pessimistic30d)}</span></div>
            </div>
          </div>
          <div className="text-xs text-gray-600 mt-2">
            取水制限 (30%) 到達予測: {daysLabel(det.daysTo30pct)}
          </div>
        </div>
      )}

      {/* 3 LLM 独立予測 */}
      {llms.length > 0 && (
        <div>
          <div className="text-xs text-gray-600 mb-2">3 LLM の独立予測と気づき</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {llms.map((llm) => {
              const meta = PROVIDER_META[llm.provider] ?? { label: llm.provider, color: "#6b7280" };
              return (
                <div key={llm.provider} className="bg-white border border-gray-200 rounded p-3 text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-xs" style={{ color: meta.color }}>{meta.label}</div>
                    {llm.warningLevel && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${WARN_BADGE[llm.warningLevel] ?? "bg-gray-100"}`}>
                        {llm.warningLevel.toUpperCase()}
                      </span>
                    )}
                  </div>
                  {llm.error ? (
                    <div className="text-xs text-red-600">⚠️ {llm.error}</div>
                  ) : (
                    <>
                      <div className="flex gap-3 mb-2 tabular-nums text-xs">
                        <div>7d: <span className="font-semibold text-base">{fmt(llm.predicted7d)}</span></div>
                        <div>30d: <span className="font-semibold text-base">{fmt(llm.predicted30d)}</span></div>
                      </div>
                      {llm.reasoning && (
                        <div className="text-xs text-gray-700 leading-relaxed">{llm.reasoning}</div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="text-xs text-gray-500 mt-2 italic">
            ※ 各 LLM の予測精度は後日 実測値と照合して評価していきます。
          </div>
        </div>
      )}
    </div>
  );
}
