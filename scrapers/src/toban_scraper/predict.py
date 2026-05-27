"""統合エントリ: 全ダムに対して 決定論的予測 + 3 LLM 予測 を実行。

GH Actions 日次 cron はこのモジュールを呼ぶ。
"""
from __future__ import annotations

from .predict_deterministic import DAM_CODES, predict_one
from .predict_llm import run_for_runId


def main() -> None:
    for code in DAM_CODES:
        print(f"\n=== Dam {code} ===")
        run_id, det, history, forecast = predict_one(code)
        print(
            f"  deterministic run #{run_id}: "
            f"7d std={det.standard_7d:.2f}% / 30d std={det.standard_30d:.2f}% / "
            f"days_to_30pct={det.days_to_30pct}"
        )
        responses = run_for_runId(run_id)
        for r in responses:
            if r.error:
                print(f"  ❌ {r.provider}: {r.error}")
            else:
                print(
                    f"  ✓ {r.provider}: 7d={r.predicted7d} 30d={r.predicted30d} warn={r.warning_level}"
                )


if __name__ == "__main__":
    main()
