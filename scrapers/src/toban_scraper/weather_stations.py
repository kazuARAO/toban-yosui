"""AMeDAS 観測所カタログ (WeatherStation) のシード + ダム連結 (DamWeatherStation) を管理。

- AMeDAS テーブル全国 1300 局のうち、東播用水関連地域 (兵庫・京都南部・大阪北部) を抽出して DB に保存。
- デフォルトのダム連結を流域近接で設定。
- 連結は後から DB 更新で自由に変更可能（CLAUDE.md 参照）。
"""
from __future__ import annotations

import json
import math
from typing import Iterable

import requests

from .db import connect


AMEDAS_TABLE_URL = (
    "https://www.jma.go.jp/bosai/amedas/const/amedastable.json"
)

# シードする緯度経度の範囲（兵庫＋京都南＋大阪北＋徳島北＋淡路）
LAT_MIN, LAT_MAX = 34.0, 35.5
LON_MIN, LON_MAX = 134.0, 136.0

# デフォルトのダム ↔ 観測所連結（priority 0 = 主、1 = 副）
# 三木市吉川町米田の利用者視点 + ダム集水域の近接で選定（2026-05-27）。
# 後から DB 更新で変更可能（README / CLAUDE.md 参照）。
DEFAULT_LINKS: list[tuple[str, str, int, str | None]] = [
    # (dam_code, station_code, priority, label)
    ("2206100700004", "63411", 0, "三田 (主, 大川瀬流域近)"),  # 大川瀬
    ("2206100700004", "63331", 1, "西脇 (副, 北部上流)"),
    ("2206100700005", "63461", 0, "三木 (主, 呑吐流域内)"),    # 呑吐
    ("2206100700005", "63518", 1, "神戸 (副)"),
]


def _to_decimal(coord: list[float]) -> float:
    """JMA 形式 [deg, min.frac] → 10進。"""
    return coord[0] + coord[1] / 60.0


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r1, r2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    h = math.sin(dlat / 2) ** 2 + math.cos(r1) * math.cos(r2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def fetch_amedas_table() -> dict:
    resp = requests.get(AMEDAS_TABLE_URL, timeout=15)
    resp.raise_for_status()
    return resp.json()


UPSERT_STATION_SQL = """
INSERT INTO "WeatherStation" (
    code, name, "nameKana", prefecture, lat, lon, type, active, "updatedAt"
) VALUES (
    %(code)s, %(name)s, %(name_kana)s, %(prefecture)s, %(lat)s, %(lon)s,
    %(type)s, true, NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    "nameKana" = EXCLUDED."nameKana",
    prefecture = EXCLUDED.prefecture,
    lat = EXCLUDED.lat,
    lon = EXCLUDED.lon,
    type = EXCLUDED.type,
    "updatedAt" = NOW()
"""

UPSERT_LINK_SQL = """
INSERT INTO "DamWeatherStation" ("damId", "stationCode", priority, label)
SELECT d.id, %(station_code)s, %(priority)s, %(label)s
FROM "Dam" d WHERE d.code = %(dam_code)s
ON CONFLICT ("damId", "stationCode") DO UPDATE SET
    priority = EXCLUDED.priority,
    label    = EXCLUDED.label
"""


def seed_stations() -> int:
    table = fetch_amedas_table()
    rows = 0
    with connect() as conn, conn.cursor() as cur:
        for code, info in table.items():
            lat = _to_decimal(info["lat"])
            lon = _to_decimal(info["lon"])
            if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
                continue
            cur.execute(
                UPSERT_STATION_SQL,
                {
                    "code": code,
                    "name": info.get("kjName"),
                    "name_kana": info.get("knName"),
                    "prefecture": None,  # JMA 表に都道府県は無いのでスキップ
                    "lat": lat,
                    "lon": lon,
                    "type": info.get("type"),
                },
            )
            rows += 1
        conn.commit()
    print(f"Seeded {rows} weather stations (within lat[{LAT_MIN},{LAT_MAX}] lon[{LON_MIN},{LON_MAX}]).")
    return rows


def seed_links() -> int:
    rows = 0
    with connect() as conn, conn.cursor() as cur:
        for dam_code, station_code, priority, label in DEFAULT_LINKS:
            cur.execute(
                UPSERT_LINK_SQL,
                {
                    "dam_code": dam_code,
                    "station_code": station_code,
                    "priority": priority,
                    "label": label,
                },
            )
            rows += cur.rowcount
        conn.commit()
    print(f"Upserted {rows} dam-station links.")
    return rows


def list_links() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.name, ws.name, ws.code, dws.priority, dws.label,
                   ws.lat, ws.lon
            FROM "DamWeatherStation" dws
            JOIN "Dam" d ON d.id = dws."damId"
            JOIN "WeatherStation" ws ON ws.code = dws."stationCode"
            ORDER BY d.name, dws.priority
            """
        )
        for row in cur.fetchall():
            d, sn, sc, pr, lb, la, lo = row
            print(f"  {d}  ← (priority={pr}) {sn} ({sc})  {lb or ''}")


def main() -> None:
    seed_stations()
    seed_links()
    print("--- current links ---")
    list_links()


if __name__ == "__main__":
    main()
