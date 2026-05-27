"""Dam テーブルに大川瀬・呑吐の諸元を投入する（idempotent: UPSERT）。"""
from __future__ import annotations

from .dams import DAMS
from .db import connect


UPSERT_SQL = """
INSERT INTO "Dam" (
    code, name, "nameKana", "riverSystem", river, address, lat, lon,
    "nrmlHighStg", "dsgnFldLv", "totalCapacity", "effectiveCapacity", "basinArea",
    "updatedAt"
) VALUES (
    %(code)s, %(name)s, %(name_kana)s, %(river_system)s, %(river)s, %(address)s,
    %(lat)s, %(lon)s,
    %(nrml_high_stg)s, %(dsgn_fld_lv)s, %(total_capacity)s, %(effective_capacity)s,
    %(basin_area)s,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    "nameKana" = EXCLUDED."nameKana",
    "riverSystem" = EXCLUDED."riverSystem",
    river = EXCLUDED.river,
    address = EXCLUDED.address,
    lat = EXCLUDED.lat,
    lon = EXCLUDED.lon,
    "nrmlHighStg" = EXCLUDED."nrmlHighStg",
    "dsgnFldLv" = EXCLUDED."dsgnFldLv",
    "totalCapacity" = EXCLUDED."totalCapacity",
    "effectiveCapacity" = EXCLUDED."effectiveCapacity",
    "basinArea" = EXCLUDED."basinArea",
    "updatedAt" = NOW()
"""


def main() -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            for dam in DAMS:
                cur.execute(UPSERT_SQL, dam.__dict__)
                print(f"  upserted: {dam.name} (code={dam.code})")
        conn.commit()
    print(f"Seeded {len(DAMS)} dams.")


if __name__ == "__main__":
    main()
