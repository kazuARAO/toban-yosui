"""気象庁週間予報を取得して JmaForecast テーブルに保存。

兵庫県南部の area code "280000" を使用。
- 詳細予報 (今日+明日+明後日): report[0]
- 週間予報 (今日 〜 7 日後): report[1]
  - timeSeries[0]: weatherCodes + pops (降水確率%) - 兵庫県単位
  - timeSeries[1]: tempsMin / tempsMax - 神戸観測点

降水量見込みは API に存在しないので、降水確率からの簡易推定で補完:
  pop 0-30%   → 0 mm
  pop 30-60%  → 5 mm
  pop 60-100% → 15 mm
"""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

import requests

from .db import connect


FORECAST_URL = "https://www.jma.go.jp/bosai/forecast/data/forecast/{area}.json"
HYOGO_AREA = "280000"


def _ua() -> str:
    return (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    )


def fetch_forecast(area_code: str = HYOGO_AREA) -> list[dict[str, Any]]:
    resp = requests.get(
        FORECAST_URL.format(area=area_code),
        headers={"User-Agent": _ua()},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def _pop_to_precipitation(pop: float | None) -> float | None:
    if pop is None:
        return None
    if pop < 30:
        return 0.0
    if pop < 60:
        return 5.0
    return 15.0


def parse_weekly(payload: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """週間予報部分 (report[1]) から日付別の予報を抽出。"""
    if len(payload) < 2:
        return []
    weekly = payload[1]
    series = weekly.get("timeSeries", [])
    if len(series) < 2:
        return []

    # 1 つ目: weatherCodes + pops (兵庫県)
    pop_series = series[0]
    pop_dates = [datetime.fromisoformat(t).date() for t in pop_series["timeDefines"]]
    area_pop = pop_series["areas"][0]
    pops = area_pop.get("pops", [])
    weather_codes = area_pop.get("weatherCodes", [])

    # 2 つ目: 神戸の気温
    temp_series = series[1]
    temp_dates = [datetime.fromisoformat(t).date() for t in temp_series["timeDefines"]]
    area_temp = temp_series["areas"][0]
    temps_min = area_temp.get("tempsMin", [])
    temps_max = area_temp.get("tempsMax", [])

    by_date: dict[date, dict[str, Any]] = {}
    for i, d in enumerate(pop_dates):
        try:
            pop_val = float(pops[i]) if pops[i] else None
        except (ValueError, IndexError):
            pop_val = None
        code = weather_codes[i] if i < len(weather_codes) else None
        by_date.setdefault(d, {}).update({
            "precipProb": pop_val,
            "precipitation": _pop_to_precipitation(pop_val),
            "weatherCode": code,
        })
    for i, d in enumerate(temp_dates):
        try:
            tmin = float(temps_min[i]) if i < len(temps_min) and temps_min[i] else None
        except (ValueError, IndexError):
            tmin = None
        try:
            tmax = float(temps_max[i]) if i < len(temps_max) and temps_max[i] else None
        except (ValueError, IndexError):
            tmax = None
        by_date.setdefault(d, {}).update({"tempMin": tmin, "tempMax": tmax})

    return [
        {"target_date": d, **vals}
        for d, vals in sorted(by_date.items())
    ]


# JMA 天気コード抜粋 (代表的なもののみ)
WEATHER_CODE_TO_TEXT: dict[str, str] = {
    "100": "晴れ",
    "101": "晴れ時々曇り",
    "102": "晴れ一時雨",
    "200": "曇り",
    "201": "曇り時々晴れ",
    "202": "曇り一時雨",
    "203": "曇り時々雨",
    "300": "雨",
    "313": "雨時々曇り",
}


def _weather_text(code: Any) -> str | None:
    if code is None:
        return None
    return WEATHER_CODE_TO_TEXT.get(str(code))


UPSERT_SQL = """
INSERT INTO "JmaForecast" (
    "areaCode", "targetDate", precipitation, "precipProb",
    "tempMax", "tempMin", "weatherText", "rawJson", "fetchedAt"
) VALUES (
    %(area_code)s, %(target_date)s, %(precipitation)s, %(precip_prob)s,
    %(temp_max)s, %(temp_min)s, %(weather_text)s, %(raw_json)s::jsonb, NOW()
)
"""


def run(area_code: str = HYOGO_AREA) -> int:
    payload = fetch_forecast(area_code)
    rows = parse_weekly(payload)
    if not rows:
        print("No weekly forecast rows.")
        return 0
    inserted = 0
    with connect() as conn, conn.cursor() as cur:
        for r in rows:
            cur.execute(
                UPSERT_SQL,
                {
                    "area_code": area_code,
                    "target_date": r["target_date"],
                    "precipitation": r.get("precipitation"),
                    "precip_prob": r.get("precipProb"),
                    "temp_max": r.get("tempMax"),
                    "temp_min": r.get("tempMin"),
                    "weather_text": _weather_text(r.get("weatherCode")),
                    "raw_json": json.dumps(r, default=str, ensure_ascii=False),
                },
            )
            inserted += 1
            print(
                f"  {r['target_date']}: pop={r.get('precipProb')}% "
                f"precip(est)={r.get('precipitation')}mm "
                f"temp={r.get('tempMin')}-{r.get('tempMax')}℃ "
                f"({_weather_text(r.get('weatherCode')) or 'n/a'})"
            )
        conn.commit()
    return inserted


def main() -> None:
    n = run()
    print(f"Saved {n} forecast rows.")


if __name__ == "__main__":
    main()
