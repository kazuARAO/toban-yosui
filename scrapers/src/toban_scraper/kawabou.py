"""kawabou JSON API（国交省 川の防災情報）を10分粒度で取得して Observation テーブルに保存。"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from .dams import DAMS
from .db import connect


JST = timezone(timedelta(hours=9))

TMLIST_URL = (
    "https://www.river.go.jp/kawabou/file/files/tmlist/dam/"
    "{ymd}/{hm}/{obs_cd}.json"
)
RW_CRNT_URL = "https://www.river.go.jp/kawabou/file/system/rwCrntTime.json"

# Ccd 値の意味（実測で確認）:
#   0   = 有効な観測値
#   140 = 閉局・観測停止中（メンテ等。値は 0 が入るが意味なし）
#   160 = データ項目自体が未対応（kawabou 改修中 等）
INVALID_CCDS = {140, 160}


def _ua() -> str:
    # kawabou は識別可能な scraper UA を Akamai でブロックするため、
    # 公開 SPA がブラウザから取得するのと同じ UA + Referer を使う。
    # 本家サイトの publish 頻度 (10 分) より遅い間隔でアクセスする運用前提。
    return os.environ.get(
        "SCRAPER_USER_AGENT",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    )


def _get_json(url: str, timeout: int = 15) -> dict[str, Any] | None:
    headers = {
        "User-Agent": _ua(),
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.river.go.jp/kawabou/pcfull/tm",
    }
    resp = requests.get(url, headers=headers, timeout=timeout)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def fetch_latest_time() -> datetime:
    """kawabou が公開している最新観測時刻を返す（JST）。"""
    data = _get_json(RW_CRNT_URL)
    if not data:
        raise RuntimeError("Failed to fetch rwCrntTime.json")
    # "2026/05/27 11:25" → datetime
    return datetime.strptime(data["crntRwTime"], "%Y/%m/%d %H:%M").replace(tzinfo=JST)


def _clean(value: Any, ccd: Any) -> float | None:
    """Ccd を見て、無効なら None、有効なら float に変換。"""
    if ccd in INVALID_CCDS:
        return None
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_tmlist(obs_cd: str, target: datetime) -> dict[str, Any] | None:
    """指定時刻の tmlist JSON（過去 8 時間分の 10 分値が入っている）を取得。"""
    ymd = target.strftime("%Y%m%d")
    hm = target.strftime("%H%M")
    url = TMLIST_URL.format(ymd=ymd, hm=hm, obs_cd=obs_cd)
    return _get_json(url)


def parse_observations(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """tmlist JSON の min10Values をパースして、DB に入れる形に整える。"""
    rows = []
    for entry in payload.get("min10Values", []):
        observed_at = datetime.strptime(entry["obsTime"], "%Y/%m/%d %H:%M").replace(
            tzinfo=JST
        )
        rows.append(
            {
                "observed_at": observed_at,
                "stor_lvl": _clean(entry.get("storLvl"), entry.get("storLvlCcd")),
                "all_sink": _clean(entry.get("allSink"), entry.get("allSinkCcd")),
                "all_disch": _clean(entry.get("allDisch"), entry.get("allDischCcd")),
                "stor_cap": _clean(entry.get("storCap"), entry.get("storCapCcd")),
                "stor_pcnt_irr": _clean(
                    entry.get("storPcntIrr"), entry.get("storPcntIrrCcd")
                ),
                "stor_pcnt_eff": _clean(
                    entry.get("storPcntEff"), entry.get("storPcntEffCcd")
                ),
                "raw_json": json.dumps(entry, ensure_ascii=False),
            }
        )
    return rows


UPSERT_OBS_SQL = """
INSERT INTO "Observation" (
    "damId", "observedAt", source,
    "storLvl", "allSink", "allDisch",
    "storCap", "storPcntIrr", "storPcntEff",
    "rawJson", "createdAt"
) VALUES (
    %(dam_id)s, %(observed_at)s, 'kawabou',
    %(stor_lvl)s, %(all_sink)s, %(all_disch)s,
    %(stor_cap)s, %(stor_pcnt_irr)s, %(stor_pcnt_eff)s,
    %(raw_json)s::jsonb, NOW()
)
ON CONFLICT ("damId", "observedAt", source) DO UPDATE SET
    "storLvl" = EXCLUDED."storLvl",
    "allSink" = EXCLUDED."allSink",
    "allDisch" = EXCLUDED."allDisch",
    "storCap" = EXCLUDED."storCap",
    "storPcntIrr" = EXCLUDED."storPcntIrr",
    "storPcntEff" = EXCLUDED."storPcntEff",
    "rawJson" = EXCLUDED."rawJson"
"""


def _floor_10min(dt: datetime) -> datetime:
    return dt.replace(minute=(dt.minute // 10) * 10, second=0, microsecond=0)


def run(target: datetime | None = None) -> int:
    """全ダムの最新 tmlist を取得して保存。target 指定で過去取得も可能。"""
    if target is None:
        target = _floor_10min(fetch_latest_time())
    else:
        target = _floor_10min(target)

    inserted = 0
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT id, code FROM "Dam"')
            dam_id_by_code = {row[1]: row[0] for row in cur.fetchall()}

            for dam in DAMS:
                dam_id = dam_id_by_code.get(dam.code)
                if dam_id is None:
                    print(f"  skip: {dam.name} not in DB (run seed first)")
                    continue

                payload = fetch_tmlist(dam.code, target)
                if payload is None:
                    print(f"  {dam.name}: HTTP 404 at {target:%Y%m%d %H%M}")
                    continue

                rows = parse_observations(payload)
                for row in rows:
                    row["dam_id"] = dam_id
                    cur.execute(UPSERT_OBS_SQL, row)
                    inserted += 1

                latest = rows[0] if rows else None
                if latest:
                    print(
                        f"  {dam.name}: {len(rows)} rows, latest {latest['observed_at']:%H:%M} "
                        f"storLvl={latest['stor_lvl']} allSink={latest['all_sink']}"
                    )
        conn.commit()

    print(f"Inserted/updated {inserted} observations.")
    return inserted


def main() -> None:
    run()


if __name__ == "__main__":
    main()
