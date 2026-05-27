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

def _load_stations_from_db() -> dict[str, str]:
    """DamWeatherStation を介してダムに紐付いた WeatherStation を全部取得。

    戻り値: {表示名: 観測所コード} の辞書（active=true のみ）。
    """
    from .db import connect

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ws.name, ws.code
            FROM "WeatherStation" ws
            WHERE ws.active = true
              AND EXISTS (
                SELECT 1 FROM "DamWeatherStation" dws
                WHERE dws."stationCode" = ws.code
              )
            ORDER BY ws.name
            """
        )
        return {row[0]: row[1] for row in cur.fetchall()}

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
    "stationCode", "observedDate", precipitation,
    "temperatureAvg", "temperatureMax", "temperatureMin", "createdAt"
) VALUES (
    %(station_code)s, %(observed_date)s, %(precipitation)s,
    %(temperature_avg)s, %(temperature_max)s, %(temperature_min)s, NOW()
)
ON CONFLICT ("stationCode", "observedDate") DO UPDATE SET
    precipitation = EXCLUDED.precipitation,
    "temperatureAvg" = EXCLUDED."temperatureAvg",
    "temperatureMax" = EXCLUDED."temperatureMax",
    "temperatureMin" = EXCLUDED."temperatureMin"
"""


def run(target: date | None = None) -> int:
    """指定日のデータを DB 上の全紐付け観測所について保存。

    target=None の場合は **今日 + 昨日の 2 日分** を取得して upsert する。
    （cron 実行頻度が遅延しても、当日中の雨を当日中に反映できるように）
    """
    stations = _load_stations_from_db()
    if not stations:
        print("No weather stations linked to any dam. Run weather_stations.py first.")
        return 0

    if target is None:
        today = datetime.now(JST).date()
        targets = [today - timedelta(days=1), today]
    else:
        targets = [target]

    inserted = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for t in targets:
                for name, station_code in stations.items():
                    summary = fetch_daily(station_code, t)
                    cur.execute(
                        UPSERT_WEATHER_SQL,
                        {
                            "station_code": station_code,
                            "observed_date": t,
                            **summary,
                        },
                    )
                    inserted += 1
                    print(
                        f"  {t} {name} ({station_code}): "
                        f"rain={summary['precipitation']:.1f}mm "
                        f"tempAvg={summary['temperature_avg']}"
                    )
        conn.commit()
    return inserted


def main() -> None:
    n = run()
    print(f"Saved {n} weather rows.")


if __name__ == "__main__":
    main()
