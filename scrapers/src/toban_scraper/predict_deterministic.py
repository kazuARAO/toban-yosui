"""決定論的 3 シナリオ予測ロジック。

過去の貯水率減少率 + 気象庁週間予報から、楽観/標準/悲観の 3 シナリオで
7d 後・30d 後の貯水率と取水制限 (30%) 到達日を計算する。

物理モデル (簡易):
  Day N の貯水率 = Day N-1 - daily_drop_pct + rain_recovery_pct
  daily_drop_pct = 過去 N 日の無降雨日の平均減少率
  rain_recovery_pct = precipitation_mm × recovery_factor
    recovery_factor は流域面積・容量・捕捉効率から計算

シナリオ係数 (drop / rain):
  optimistic:   0.7 / 1.3   (減少緩く、雨多めに見積もる)
  standard:     1.0 / 1.0
  pessimistic:  1.4 / 0.7
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Iterable

from .db import connect


JST = timezone(timedelta(hours=9))

# シナリオ係数 (drop_multiplier, rain_multiplier)
SCENARIO_FACTORS = {
    "optimistic": (0.7, 1.3),
    "standard": (1.0, 1.0),
    "pessimistic": (1.4, 0.7),
}

CAPTURE_EFFICIENCY = 0.5  # 流域降雨の何割がダムに到達するか
TAKEN_LIMIT_PCT = 30.0    # 取水制限ライン (%)


@dataclass
class DamPhysics:
    dam_id: int
    name: str
    total_capacity_thousand_m3: float | None
    basin_area_km2: float | None
    recovery_pct_per_mm: float  # 1 mm の流域降雨で何 % 貯水率が上がるか

    @classmethod
    def from_db_row(cls, row) -> "DamPhysics":
        dam_id, name, cap, area = row
        if cap and area:
            # m³ per mm rain: area_km2 * 1000 * 1000 * 0.001 = area * 1000 m³
            # capture: × efficiency
            # capacity: thousand m³ → m³: cap * 1000
            # pct: (mm * area * 1000 * eff) / (cap * 1000) * 100
            #      = (mm * area * eff / cap) * 100
            recovery = (1.0 * area * CAPTURE_EFFICIENCY / cap) * 100
        else:
            recovery = 0.3  # フォールバック (大川瀬相当)
        return cls(
            dam_id=dam_id,
            name=name,
            total_capacity_thousand_m3=cap,
            basin_area_km2=area,
            recovery_pct_per_mm=recovery,
        )


@dataclass
class HistoricalContext:
    base_stor_pcnt: float
    base_observed_at: datetime
    recent_days: int
    recent_drop_rate: float | None  # pct / day (無降雨日平均)
    recent_daily_history: list[dict]  # [{date, storPcnt, precipitation}, ...]


@dataclass
class ForecastDay:
    target_date: date
    precipitation_mm: float    # 推定降水量 (mm/日)
    precip_prob_pct: float | None
    temp_max: float | None
    temp_min: float | None


@dataclass
class ScenarioResult:
    optimistic_7d: float | None
    standard_7d: float | None
    pessimistic_7d: float | None
    optimistic_30d: float | None
    standard_30d: float | None
    pessimistic_30d: float | None
    days_to_30pct: int | None


# ----------------------------------------------------------------------------

def load_dam_physics(cur, dam_code: str) -> DamPhysics:
    cur.execute(
        'SELECT id, name, "totalCapacity", "basinArea" FROM "Dam" WHERE code = %s',
        (dam_code,),
    )
    row = cur.fetchone()
    if row is None:
        raise RuntimeError(f"Dam not found: code={dam_code}")
    return DamPhysics.from_db_row(row)


def load_historical_context(
    cur, dam_id: int, station_code: str | None, days: int = 14
) -> HistoricalContext:
    """直近 N 日の日次貯水率 + 降水量を集約。"""
    cur.execute(
        """
        SELECT "reportDate", "storPcntIrr"
        FROM "DailyReport"
        WHERE "damId" = %s AND "storPcntIrr" IS NOT NULL
        ORDER BY "reportDate" DESC
        LIMIT %s
        """,
        (dam_id, days),
    )
    rows = list(cur.fetchall())
    if not rows:
        raise RuntimeError(f"No DailyReport for damId={dam_id}")

    rows.reverse()  # 古い順
    base_date, base_pct = rows[-1]

    # 降水量を結合
    precip_by_date: dict[date, float] = {}
    if station_code:
        cur.execute(
            """
            SELECT "observedDate", precipitation
            FROM "Weather"
            WHERE "stationCode" = %s AND "observedDate" >= %s
            ORDER BY "observedDate" ASC
            """,
            (station_code, rows[0][0]),
        )
        for d, p in cur.fetchall():
            if p is not None:
                precip_by_date[d] = float(p)

    history: list[dict] = []
    for d, pct in rows:
        history.append({
            "date": d.isoformat() if hasattr(d, "isoformat") else str(d),
            "storPcnt": float(pct),
            "precipitation": precip_by_date.get(d, 0.0),
        })

    # 無降雨日 (≤1mm) の平均減少率
    drops = []
    for i in range(1, len(history)):
        if history[i]["precipitation"] <= 1.0 and history[i - 1]["precipitation"] <= 1.0:
            d = history[i - 1]["storPcnt"] - history[i]["storPcnt"]
            drops.append(d)
    drop_rate = sum(drops) / len(drops) if drops else None

    return HistoricalContext(
        base_stor_pcnt=float(base_pct),
        base_observed_at=datetime.combine(base_date, datetime.min.time(), tzinfo=JST),
        recent_days=len(history),
        recent_drop_rate=drop_rate,
        recent_daily_history=history,
    )


def load_forecast(cur, days: int = 7) -> list[ForecastDay]:
    """最新の JMA 予報を取り出す。同一日付に複数あれば最新を採用。"""
    cur.execute(
        """
        SELECT DISTINCT ON ("targetDate")
            "targetDate", precipitation, "precipProb", "tempMax", "tempMin"
        FROM "JmaForecast"
        WHERE "targetDate" >= CURRENT_DATE
        ORDER BY "targetDate" ASC, "fetchedAt" DESC
        LIMIT %s
        """,
        (days,),
    )
    return [
        ForecastDay(
            target_date=row[0],
            precipitation_mm=float(row[1] or 0.0),
            precip_prob_pct=row[2],
            temp_max=row[3],
            temp_min=row[4],
        )
        for row in cur.fetchall()
    ]


def _project_one_scenario(
    base_pct: float,
    drop_rate: float,
    recovery_per_mm: float,
    forecast: list[ForecastDay],
    drop_mult: float,
    rain_mult: float,
    horizon_days: int,
) -> list[float]:
    """N 日先までの貯水率系列を返す (index 0 = day+1, index N-1 = day+N)。"""
    series: list[float] = []
    current = base_pct
    for i in range(horizon_days):
        if i < len(forecast):
            precip = forecast[i].precipitation_mm
        else:
            # 予報範囲外は平均見込み (季節平均なし → 0 mm 仮定)
            precip = 0.0
        delta = -drop_rate * drop_mult + precip * recovery_per_mm * rain_mult
        current = max(0.0, current + delta)
        series.append(current)
    return series


def project_scenarios(
    physics: DamPhysics,
    history: HistoricalContext,
    forecast: list[ForecastDay],
) -> ScenarioResult:
    drop_rate = history.recent_drop_rate or 0.1  # フォールバック
    base = history.base_stor_pcnt

    series = {}
    for name, (drop_m, rain_m) in SCENARIO_FACTORS.items():
        series[name] = _project_one_scenario(
            base, drop_rate, physics.recovery_pct_per_mm, forecast,
            drop_m, rain_m, horizon_days=30,
        )

    # 標準シナリオで 30% 到達日を算出 (見つからなければ None)
    std = series["standard"]
    days_to_30 = None
    for i, v in enumerate(std):
        if v <= TAKEN_LIMIT_PCT:
            days_to_30 = i + 1
            break
    if days_to_30 is None:
        # 30 日範囲を超える: 直近の減少率で線形外挿
        if std[-1] < base and base > TAKEN_LIMIT_PCT:
            avg_daily_drop = (base - std[-1]) / 30.0
            if avg_daily_drop > 0:
                days_to_30 = int((base - TAKEN_LIMIT_PCT) / avg_daily_drop)
            else:
                days_to_30 = 9999
        else:
            days_to_30 = 9999

    return ScenarioResult(
        optimistic_7d=series["optimistic"][6],
        standard_7d=series["standard"][6],
        pessimistic_7d=series["pessimistic"][6],
        optimistic_30d=series["optimistic"][29],
        standard_30d=series["standard"][29],
        pessimistic_30d=series["pessimistic"][29],
        days_to_30pct=days_to_30,
    )


# ----------------------------------------------------------------------------

INSERT_RUN_SQL = """
INSERT INTO "PredictionRun" (
    "damId", "baseStorPcnt", "baseStorLvl", "baseObservedAt",
    "recentDays", "recentDropRate", "contextJson", "generatedAt"
) VALUES (
    %(dam_id)s, %(base_pct)s, %(base_lvl)s, %(base_at)s,
    %(recent_days)s, %(drop_rate)s, %(context)s::jsonb, NOW()
)
RETURNING id
"""

INSERT_DET_SQL = """
INSERT INTO "DeterministicForecast" (
    "runId", "optimistic7d", "standard7d", "pessimistic7d",
    "optimistic30d", "standard30d", "pessimistic30d", "daysTo30pct"
) VALUES (
    %(run_id)s, %(opt7)s, %(std7)s, %(pes7)s,
    %(opt30)s, %(std30)s, %(pes30)s, %(d30)s
)
"""


def predict_one(dam_code: str) -> tuple[int, ScenarioResult, HistoricalContext, list[ForecastDay]]:
    """1 ダムの予測を生成し PredictionRun + DeterministicForecast を保存。"""
    import json as _json

    with connect() as conn, conn.cursor() as cur:
        physics = load_dam_physics(cur, dam_code)
        # priority=0 観測所
        cur.execute(
            """
            SELECT "stationCode" FROM "DamWeatherStation"
            WHERE "damId" = %s ORDER BY priority ASC LIMIT 1
            """,
            (physics.dam_id,),
        )
        sc_row = cur.fetchone()
        station_code = sc_row[0] if sc_row else None

        history = load_historical_context(cur, physics.dam_id, station_code)
        forecast = load_forecast(cur)
        result = project_scenarios(physics, history, forecast)

        # 基準貯水位 (latest observation の storLvl)
        cur.execute(
            """
            SELECT "storLvl" FROM "Observation"
            WHERE "damId" = %s AND source = 'kawabou' AND "storLvl" IS NOT NULL
            ORDER BY "observedAt" DESC LIMIT 1
            """,
            (physics.dam_id,),
        )
        lvl_row = cur.fetchone()
        base_lvl = float(lvl_row[0]) if lvl_row else None

        context = {
            "dam": {
                "code": dam_code,
                "name": physics.name,
                "totalCapacity": physics.total_capacity_thousand_m3,
                "basinArea": physics.basin_area_km2,
                "recoveryPctPerMm": physics.recovery_pct_per_mm,
            },
            "stationCode": station_code,
            "recentDays": history.recent_days,
            "recentDropRate": history.recent_drop_rate,
            "history": history.recent_daily_history,
            "forecast": [
                {
                    "date": f.target_date.isoformat(),
                    "precipitation": f.precipitation_mm,
                    "precipProb": f.precip_prob_pct,
                    "tempMax": f.temp_max,
                    "tempMin": f.temp_min,
                }
                for f in forecast
            ],
        }

        cur.execute(INSERT_RUN_SQL, {
            "dam_id": physics.dam_id,
            "base_pct": history.base_stor_pcnt,
            "base_lvl": base_lvl,
            "base_at": history.base_observed_at,
            "recent_days": history.recent_days,
            "drop_rate": history.recent_drop_rate,
            "context": _json.dumps(context, default=str, ensure_ascii=False),
        })
        run_id = cur.fetchone()[0]

        cur.execute(INSERT_DET_SQL, {
            "run_id": run_id,
            "opt7": result.optimistic_7d,
            "std7": result.standard_7d,
            "pes7": result.pessimistic_7d,
            "opt30": result.optimistic_30d,
            "std30": result.standard_30d,
            "pes30": result.pessimistic_30d,
            "d30": result.days_to_30pct,
        })
        conn.commit()
    return run_id, result, history, forecast


DAM_CODES = ["2206100700004", "2206100700005"]  # 大川瀬, 呑吐


def main() -> None:
    for code in DAM_CODES:
        run_id, result, history, forecast = predict_one(code)
        print(f"\n=== {code} (run #{run_id}) ===")
        print(f"  base storPcnt: {history.base_stor_pcnt:.1f}% (drop rate {history.recent_drop_rate})")
        print(f"  7d:  opt={result.optimistic_7d:.2f}% std={result.standard_7d:.2f}% pes={result.pessimistic_7d:.2f}%")
        print(f"  30d: opt={result.optimistic_30d:.2f}% std={result.standard_30d:.2f}% pes={result.pessimistic_30d:.2f}%")
        print(f"  days to 30%: {result.days_to_30pct}")


if __name__ == "__main__":
    main()
