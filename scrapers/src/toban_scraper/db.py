"""DB 接続ヘルパー。.env から DATABASE_URL を読み、psycopg で接続。"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from dotenv import load_dotenv

_ENV_LOADED = False


def _load_env() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    project_root = Path(__file__).resolve().parents[3]
    load_dotenv(project_root / ".env")
    _ENV_LOADED = True


def _normalize_url(url: str) -> str:
    """Prisma 形式の URL から query 部（?schema=public 等）を除外し、psycopg 互換にする。"""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


def connect() -> psycopg.Connection:
    _load_env()
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set. Copy .env.example to .env and configure.")
    return psycopg.connect(_normalize_url(url))
