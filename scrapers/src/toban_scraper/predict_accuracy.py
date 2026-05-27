"""予測の事後精度評価。

毎日実行され、N 日前の予測に対して実測値 (DailyReport.storPcntIrr) を照合し、
DeterministicForecast.actual7d/30d + LLMForecast.actual7d/30d + error7d/30d を埋める。

呼び出し時、すでに評価済み (evaluatedAt 非 NULL) のレコードはスキップ。
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from .db import connect


JST = timezone(timedelta(hours=9))


def _date_after(d: datetime, days: int) -> date:
    return (d.astimezone(JST) + timedelta(days=days)).date()


def _fetch_actual_pct(cur, dam_id: int, target_date: date) -> float | None:
    """target_date 当日（無ければ前後 1 日許容）の実測 storPcntIrr を取得。"""
    cur.execute(
        """
        SELECT "reportDate", "storPcntIrr"
        FROM "DailyReport"
        WHERE "damId" = %s
          AND "storPcntIrr" IS NOT NULL
          AND "reportDate" BETWEEN %s AND %s
        ORDER BY ABS(EXTRACT(EPOCH FROM ("reportDate"::timestamp - %s::timestamp))) ASC
        LIMIT 1
        """,
        (dam_id, target_date - timedelta(days=1), target_date + timedelta(days=1), target_date),
    )
    row = cur.fetchone()
    return float(row[1]) if row else None


def run() -> tuple[int, int]:
    """評価対象（7d/30d 経過済、未評価）を全て評価。戻り値: (Det 更新数, LLM 更新数)"""
    det_updated = 0
    llm_updated = 0

    with connect() as conn, conn.cursor() as cur:
        # 評価対象 PredictionRun: 7 日経過済 (= base_observed_at + 7d <= 今日) かつ
        # まだ deterministic.evaluatedAt が NULL
        now = datetime.now(JST)
        cutoff = (now - timedelta(days=7)).isoformat()

        cur.execute(
            """
            SELECT pr.id, pr."damId", pr."baseObservedAt"
            FROM "PredictionRun" pr
            LEFT JOIN "DeterministicForecast" df ON df."runId" = pr.id
            WHERE df."evaluatedAt" IS NULL
              AND pr."baseObservedAt" <= %s
            ORDER BY pr."generatedAt" ASC
            """,
            (cutoff,),
        )
        runs = list(cur.fetchall())

        for run_id, dam_id, base_at in runs:
            d7 = _date_after(base_at, 7)
            actual_7 = _fetch_actual_pct(cur, dam_id, d7)

            # 30 日後はまだ未到達かもしれないので別判定
            actual_30 = None
            if (now - base_at.astimezone(JST)).days >= 30:
                d30 = _date_after(base_at, 30)
                actual_30 = _fetch_actual_pct(cur, dam_id, d30)

            # 7 日後の実測すら無ければスキップ
            if actual_7 is None:
                continue

            # Deterministic 更新
            cur.execute(
                """
                UPDATE "DeterministicForecast"
                SET "actual7d" = %s, "actual30d" = %s, "evaluatedAt" = NOW()
                WHERE "runId" = %s
                """,
                (actual_7, actual_30, run_id),
            )
            if cur.rowcount > 0:
                det_updated += 1

            # 各 LLMForecast 更新
            cur.execute(
                """
                SELECT id, "predicted7d", "predicted30d"
                FROM "LLMForecast"
                WHERE "runId" = %s
                """,
                (run_id,),
            )
            for llm_id, p7, p30 in cur.fetchall():
                err7 = (actual_7 - p7) if (p7 is not None and actual_7 is not None) else None
                err30 = (actual_30 - p30) if (p30 is not None and actual_30 is not None) else None
                cur.execute(
                    """
                    UPDATE "LLMForecast"
                    SET "actual7d" = %s, "actual30d" = %s,
                        "error7d" = %s, "error30d" = %s, "evaluatedAt" = NOW()
                    WHERE id = %s
                    """,
                    (actual_7, actual_30, err7, err30, llm_id),
                )
                if cur.rowcount > 0:
                    llm_updated += 1
        conn.commit()

    return det_updated, llm_updated


def main() -> None:
    d, l = run()
    print(f"Accuracy backfill: deterministic={d}, llm={l}")


if __name__ == "__main__":
    main()
