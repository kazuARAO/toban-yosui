"""toban-yosui.jp の「ダム貯水状況」記事をパースして DailyReport に保存。

kawabou が貯水率（storPcntIrr）を未対応のため、ここから補完する。
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable

import requests
from bs4 import BeautifulSoup

from .db import connect


TOPICS_URL = "http://toban-yosui.jp/cgi-bin/bbs/update.cgi?dir=topics"

# 「ダム貯水状況   2026/5/26」のような見出し（半角・全角の空白混在に対応）
HEADING_DATE_RE = re.compile(
    r"ダム貯水状況\s*([0-9]{4})[/／]([0-9]{1,2})[/／]([0-9]{1,2})"
)

# 「大川瀬ダム： \n 7,038千ｍ3（86.4％）」のような断片に対応
# 千m3/千ｍ3/千m³ のゆらぎ、％/% のゆらぎを許容
DAM_VALUE_RE = re.compile(
    r"(大川瀬|呑吐)ダム[：:]?\s*"
    r"([0-9,]+)\s*千[mｍ][3³]\s*[（(]\s*([0-9]+(?:\.[0-9]+)?)\s*[％%]\s*[）)]"
)


@dataclass
class ReportEntry:
    report_date: date
    dam_name: str   # 大川瀬 / 呑吐
    stor_cap: float
    stor_pcnt_irr: float
    raw_html: str


def _ua() -> str:
    return os.environ.get(
        "SCRAPER_USER_AGENT",
        "toban-yosui-watcher/0.1 (+https://github.com/kazuARAO/toban-yosui)",
    )


def fetch_topics_html() -> str:
    resp = requests.get(TOPICS_URL, headers={"User-Agent": _ua()}, timeout=30)
    resp.encoding = "shift_jis"
    resp.raise_for_status()
    return resp.text


def parse_reports(html: str) -> list[ReportEntry]:
    """ページ内の「ダム貯水状況」記事をすべて拾う（最新ページに通常 1 件あるが、念のため複数対応）。"""
    soup = BeautifulSoup(html, "lxml")
    entries: list[ReportEntry] = []

    # 各「記事」は外側 table の中の見出し行 + 本文行という構造。
    # 安全策として、ページ全体のテキストから日付見出しを探し、その直後の本文ブロックを文字列で取る。
    full_text = soup.get_text("\n", strip=False)
    for m in HEADING_DATE_RE.finditer(full_text):
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        report_date = date(y, mo, d)
        # 見出しから次の見出し（または EOF）までの範囲を本文として走査
        start = m.end()
        next_m = HEADING_DATE_RE.search(full_text, start)
        block = full_text[start : next_m.start() if next_m else len(full_text)]
        for dm in DAM_VALUE_RE.finditer(block):
            entries.append(
                ReportEntry(
                    report_date=report_date,
                    dam_name=dm.group(1),
                    stor_cap=float(dm.group(2).replace(",", "")),
                    stor_pcnt_irr=float(dm.group(3)),
                    raw_html=block[: min(2000, len(block))],
                )
            )
    return entries


UPSERT_DAILY_SQL = """
INSERT INTO "DailyReport" (
    "damId", "reportDate", "storCap", "storPcntIrr", "sourceUrl", "rawHtml", "createdAt"
) VALUES (
    %(dam_id)s, %(report_date)s, %(stor_cap)s, %(stor_pcnt_irr)s,
    %(source_url)s, %(raw_html)s, NOW()
)
ON CONFLICT ("damId", "reportDate") DO UPDATE SET
    "storCap" = EXCLUDED."storCap",
    "storPcntIrr" = EXCLUDED."storPcntIrr",
    "sourceUrl" = EXCLUDED."sourceUrl",
    "rawHtml" = EXCLUDED."rawHtml"
"""


def _dam_id_map(cur) -> dict[str, int]:
    cur.execute('SELECT id, name FROM "Dam"')
    return {row[1].replace("ダム", ""): row[0] for row in cur.fetchall()}


def save(entries: Iterable[ReportEntry]) -> int:
    inserted = 0
    with connect() as conn:
        with conn.cursor() as cur:
            id_map = _dam_id_map(cur)
            for e in entries:
                dam_id = id_map.get(e.dam_name)
                if dam_id is None:
                    print(f"  skip: {e.dam_name} not in DB (run seed first)")
                    continue
                cur.execute(
                    UPSERT_DAILY_SQL,
                    {
                        "dam_id": dam_id,
                        "report_date": e.report_date,
                        "stor_cap": e.stor_cap,
                        "stor_pcnt_irr": e.stor_pcnt_irr,
                        "source_url": TOPICS_URL,
                        "raw_html": e.raw_html,
                    },
                )
                print(
                    f"  {e.report_date} {e.dam_name}ダム: "
                    f"{e.stor_cap:,.0f}千m³ ({e.stor_pcnt_irr}%)"
                )
                inserted += 1
        conn.commit()
    return inserted


def run() -> int:
    html = fetch_topics_html()
    entries = parse_reports(html)
    if not entries:
        print("No 'ダム貯水状況' article found on the page.")
        return 0
    return save(entries)


def main() -> None:
    n = run()
    print(f"Saved {n} daily reports.")


if __name__ == "__main__":
    main()
