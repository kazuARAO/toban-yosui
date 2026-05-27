"""気象庁アメダス日次データを取得して Weather テーブルに保存。

気象庁の bosai-amedas API（公開・無認証）を使用。
- 観測地点: 三木 / 神戸 / 三田（東播用水流域カバー）
- 日次の代表値: 降水量合計・平均/最高/最低気温
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

from .db import connect


JST = timezone(timedelta(hours=9))

# アメダス観測所コード（気象庁 bosai-amedas/const/amedastable.json から取得）
STATIONS: dict[str, str] = {
    "三木": "63461",
    "神戸": "63518",
    "三田": "63411",
}

# 日次データ JSON：年月日の hourly を集約する
# https://www.jma.go.jp/bosai/amedas/data/point/{station}/{YYYYMMDD}_{HH}.json (3時間ごとファイル)
# 簡易には日報 API を使う：daily_a1 etc. があるが、ここでは時別データを集約。
HOURLY_URL = "https://www.jma.go.jp/bosai/amedas/data/point/{station}/{ymd}_{slot}.json"

SLOTS = ["00", "03", "06", "09", "12", "15", "18", "21"]


def _ua() -> str:
    return os.environ.get(
        "SCRAPER_USER_AGENT",
        "toban-yosui-watcher/0.1 (+https://github.com/kazuARAO/toban-yosui)",
    )


def _get_json(url: str, timeout: int = 15) -> dict[str, Any] | None:
    resp = requests.get(url, headers={"User-Agent": _ua()}, timeout=timeout)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def fetch_daily(station_id: str, target: date) -> dict[str, float | None]:
    """指定日のアメダス時別データを集約して、日次の代表値を返す。"""
    ymd = target.strftime("%Y%m%d")
    rain_sum: float = 0.0
    temps: list[float] = []

    for slot in SLOTS:
        url = HOURLY_URL.format(station=station_id, ymd=ymd, slot=slot)
        data = _get_json(url)
        if not data:
            continue
        for _, record in data.items():
            # record は {"temp": [value, qcflag], "precipitation10m": [...], ...} 形式
            precip = record.get("precipitation1h")
            if precip and precip[0] is not None and precip[1] == 0:
                rain_sum += float(precip[0])
            temp = record.get("temp")
            if temp and temp[0] is not None and temp[1] == 0:
                temps.append(float(temp[0]))

    return {
        "precipitation": rain_sum if rain_sum > 0 else 0.0,
        "temperature_avg": sum(temps) / len(temps) if temps else None,
        "temperature_max": max(temps) if temps else None,
        "temperature_min": min(temps) if temps else None,
    }


UPSERT_WEATHER_SQL = """
INSERT INTO "Weather" (
    station, "observedDate", precipitation,
    "temperatureAvg", "temperatureMax", "temperatureMin", "createdAt"
) VALUES (
    %(station)s, %(observed_date)s, %(precipitation)s,
    %(temperature_avg)s, %(temperature_max)s, %(temperature_min)s, NOW()
)
ON CONFLICT (station, "observedDate") DO UPDATE SET
    precipitation = EXCLUDED.precipitation,
    "temperatureAvg" = EXCLUDED."temperatureAvg",
    "temperatureMax" = EXCLUDED."temperatureMax",
    "temperatureMin" = EXCLUDED."temperatureMin"
"""


def run(target: date | None = None) -> int:
    """指定日（省略時は昨日）のデータを各観測所について保存。"""
    if target is None:
        target = (datetime.now(JST) - timedelta(days=1)).date()

    inserted = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for name, station_id in STATIONS.items():
                summary = fetch_daily(station_id, target)
                cur.execute(
                    UPSERT_WEATHER_SQL,
                    {
                        "station": name,
                        "observed_date": target,
                        **summary,
                    },
                )
                inserted += 1
                print(
                    f"  {target} {name}: rain={summary['precipitation']:.1f}mm "
                    f"tempAvg={summary['temperature_avg']}"
                )
        conn.commit()
    return inserted


def main() -> None:
    n = run()
    print(f"Saved {n} weather rows.")


if __name__ == "__main__":
    main()
