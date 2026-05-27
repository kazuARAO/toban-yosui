"""気象庁アメダス気象データを取得。

10 分粒度の生データを WeatherObservation テーブルに保存し、
日次集計（合計降水量・平均/最高/最低気温）を Weather テーブルに保存する。
kawabou (10 分粒度) と同期して扱える。
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
    # JMA も将来 bot block する可能性があるのでブラウザ UA を使う
    return os.environ.get(
        "SCRAPER_USER_AGENT",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    )


def _get_json(url: str, timeout: int = 15) -> dict[str, Any] | None:
    headers = {
        "User-Agent": _ua(),
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.jma.go.jp/bosai/amedas/",
    }
    resp = requests.get(url, headers=headers, timeout=timeout)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def fetch_slot_data(station_id: str, target_date: date, slot: str) -> dict[str, Any] | None:
    """指定 station × 日付 × スロット (3 時間分) の 10 分毎データを取得。

    レスポンス: { "YYYYMMDDHHMMSS": {"temp": [v, qc], "precipitation10m": [v, qc], ...}, ... }
    """
    url = HOURLY_URL.format(station=station_id, ymd=target_date.strftime("%Y%m%d"), slot=slot)
    return _get_json(url)


def _q_clean(field: list | None) -> float | None:
    """[value, qcflag] -> 数値 (qcflag=0 のみ有効)。"""
    if not field:
        return None
    val, qc = field[0], field[1] if len(field) > 1 else None
    if val is None:
        return None
    if qc != 0:  # 0 = 正常値、それ以外は欠測等
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def parse_observations(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """JMA レスポンスをパースして 10 分観測値のリストを返す。"""
    rows: list[dict[str, Any]] = []
    for ts_str, rec in payload.items():
        # ts_str は "YYYYMMDDHHMMSS" 形式 (JST)
        try:
            ts = datetime.strptime(ts_str, "%Y%m%d%H%M%S").replace(tzinfo=JST)
        except ValueError:
            continue
        rows.append({
            "observed_at": ts,
            "precipitation_10m": _q_clean(rec.get("precipitation10m")),
            "precipitation_1h": _q_clean(rec.get("precipitation1h")),
            "temperature": _q_clean(rec.get("temp")),
            "humidity": _q_clean(rec.get("humidity")),
        })
    return rows


def fetch_daily(station_id: str, target: date) -> dict[str, float | None]:
    """日次集計（後方互換用）。WeatherObservation から再集計するならこれは不要だが、
    Weather テーブル用に残しておく。
    """
    rain_sum: float = 0.0
    temps: list[float] = []
    for slot in SLOTS:
        data = fetch_slot_data(station_id, target, slot)
        if not data:
            continue
        for ts_str, rec in data.items():
            p = _q_clean(rec.get("precipitation1h"))
            t = _q_clean(rec.get("temp"))
            if p is not None:
                rain_sum += p
            if t is not None:
                temps.append(t)
    return {
        "precipitation": rain_sum,
        "temperature_avg": sum(temps) / len(temps) if temps else None,
        "temperature_max": max(temps) if temps else None,
        "temperature_min": min(temps) if temps else None,
    }


UPSERT_OBS_SQL = """
INSERT INTO "WeatherObservation" (
    "stationCode", "observedAt", "precipitation10m", "precipitation1h",
    temperature, humidity, "createdAt"
) VALUES (
    %(station_code)s, %(observed_at)s, %(precipitation_10m)s, %(precipitation_1h)s,
    %(temperature)s, %(humidity)s, NOW()
)
ON CONFLICT ("stationCode", "observedAt") DO UPDATE SET
    "precipitation10m" = EXCLUDED."precipitation10m",
    "precipitation1h" = EXCLUDED."precipitation1h",
    temperature = EXCLUDED.temperature,
    humidity = EXCLUDED.humidity
"""

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

# DailyReport ↔ Weather 集計を、WeatherObservation から動的に算出する SQL
AGGREGATE_DAILY_SQL = """
INSERT INTO "Weather" (
    "stationCode", "observedDate", precipitation,
    "temperatureAvg", "temperatureMax", "temperatureMin", "createdAt"
)
SELECT
    "stationCode",
    DATE("observedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo') AS observed_date,
    COALESCE(SUM("precipitation10m"), 0) AS precipitation,
    AVG(temperature) AS temp_avg,
    MAX(temperature) AS temp_max,
    MIN(temperature) AS temp_min,
    NOW()
FROM "WeatherObservation"
WHERE "stationCode" = %(station_code)s
  AND "observedAt" >= %(from_ts)s AND "observedAt" < %(to_ts)s
GROUP BY "stationCode", observed_date
ON CONFLICT ("stationCode", "observedDate") DO UPDATE SET
    precipitation = EXCLUDED.precipitation,
    "temperatureAvg" = EXCLUDED."temperatureAvg",
    "temperatureMax" = EXCLUDED."temperatureMax",
    "temperatureMin" = EXCLUDED."temperatureMin"
"""


def _floor_3h(dt: datetime) -> tuple[date, str]:
    """JMA の 3 時間スロット (00,03,06,09,12,15,18,21) と日付を返す。"""
    jst = dt.astimezone(JST)
    slot_hour = (jst.hour // 3) * 3
    return jst.date(), f"{slot_hour:02d}"


def run(target: date | None = None) -> int:
    """指定日付（または現在 + 過去 3 時間程度）の 10 分データを取得して
    WeatherObservation に保存し、影響を受ける日付の Weather を再集計する。

    target=None の場合 = 直近モード:
      - 現在の 3 時間スロット + 前の 3 時間スロット (両日跨ぎ対応) を取得
      - 既存値があれば上書き
    """
    stations = _load_stations_from_db()
    if not stations:
        print("No weather stations linked to any dam. Run weather_stations.py first.")
        return 0

    if target is None:
        now = datetime.now(JST)
        cur_date, cur_slot = _floor_3h(now)
        prev = now - timedelta(hours=3)
        prev_date, prev_slot = _floor_3h(prev)
        targets = [(prev_date, prev_slot), (cur_date, cur_slot)]
    else:
        # 指定日 1 日分の全 8 スロット
        targets = [(target, s) for s in SLOTS]

    inserted = 0
    affected_dates: set[date] = set()
    with connect() as conn, conn.cursor() as cur:
        for name, station_code in stations.items():
            for target_date, slot in targets:
                payload = fetch_slot_data(station_code, target_date, slot)
                if not payload:
                    continue
                rows = parse_observations(payload)
                for r in rows:
                    cur.execute(UPSERT_OBS_SQL, {"station_code": station_code, **r})
                    affected_dates.add(r["observed_at"].astimezone(JST).date())
                    inserted += 1
            print(f"  {name} ({station_code}): collected so far for slots {targets}")

        # 影響した日付の Weather (日次集計) を再構築
        for d in sorted(affected_dates):
            from_ts = datetime.combine(d, datetime.min.time(), tzinfo=JST)
            to_ts = from_ts + timedelta(days=1)
            for _, station_code in stations.items():
                cur.execute(AGGREGATE_DAILY_SQL, {
                    "station_code": station_code,
                    "from_ts": from_ts,
                    "to_ts": to_ts,
                })
        conn.commit()

    print(f"Inserted/updated {inserted} 10-min observations across {len(affected_dates)} days.")
    return inserted


def main() -> None:
    n = run()
    print(f"Saved {n} weather rows.")


if __name__ == "__main__":
    main()
