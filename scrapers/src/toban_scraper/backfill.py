"""kawabou の過去データを 6時間刻みで遡って取得し DB に蓄積する。

tmlist の 1 ファイルは最新 50 件（≒8 時間分の 10 分値）。
6 時間刻みで取得すれば重複しつつ全 10 分スロットがカバーされる。
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta

from .kawabou import JST, run


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill kawabou observations.")
    parser.add_argument("--days", type=int, default=7, help="遡る日数 (default: 7)")
    parser.add_argument(
        "--step-hours", type=int, default=6, help="ステップ間隔 (default: 6)"
    )
    args = parser.parse_args()

    now = datetime.now(JST).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(days=args.days)

    cursor = start
    total = 0
    while cursor <= now:
        print(f"[{cursor:%Y-%m-%d %H:%M}]")
        try:
            n = run(target=cursor)
            total += n
        except Exception as e:
            print(f"  error: {e}")
        cursor += timedelta(hours=args.step_hours)

    print(f"\nBackfill done. Total upserts: {total}")


if __name__ == "__main__":
    main()
