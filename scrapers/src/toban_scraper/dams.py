"""大川瀬・呑吐ダムの諸元（kawabou JSON で確認した固定値）。"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DamMeta:
    code: str            # kawabou obsCd（15桁の観測所コード）
    name: str
    name_kana: str
    river_system: str
    river: str
    address: str
    lat: float
    lon: float
    nrml_high_stg: float | None       # 常時満水位 (m)
    dsgn_fld_lv: float | None         # 設計洪水位 (m)
    total_capacity: float | None      # 総貯水量 (千m³)
    effective_capacity: float | None  # 有効貯水量 (千m³)
    basin_area: float | None          # 流域面積 (km²)


DAMS: list[DamMeta] = [
    DamMeta(
        code="2206100700004",
        name="大川瀬ダム",
        name_kana="おおかわせだむ",
        river_system="加古川水系",
        river="加古川",
        address="兵庫県三田市大川瀬",
        lat=34.9463889,
        lon=135.1169444,
        nrml_high_stg=177.65,
        dsgn_fld_lv=178.43,
        total_capacity=8150,
        effective_capacity=None,
        basin_area=60.6,
    ),
    DamMeta(
        code="2206100700005",
        name="呑吐ダム",
        name_kana="どんどだむ",
        river_system="加古川水系",
        river="加古川",
        address="兵庫県三木市志染町三津田",
        lat=34.7733333,
        lon=135.0719444,
        nrml_high_stg=143.0,
        dsgn_fld_lv=None,
        total_capacity=17800,
        effective_capacity=None,
        basin_area=49.8,
    ),
]
