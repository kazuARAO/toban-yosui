"""3 LLM (Claude / OpenAI / Gemini) で並列に独立予測を生成し LLMForecast に保存。

CLAUDE.md の賢さ最優先方針に従って:
  Claude: claude-opus-4-7
  OpenAI: gpt-5.5 + reasoning_effort=high
  Gemini: gemini-3.1-pro-preview
"""
from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

from .db import connect


CLAUDE_MODEL = "claude-opus-4-7"
OPENAI_MODEL = "gpt-5.5"
GEMINI_MODEL = "gemini-3.1-pro-preview"


SYSTEM_PROMPT = (
    "あなたは日本の農業用ダム水位予測の専門アシスタントです。"
    "提供される過去の貯水率データ・降水量・気象庁週間予報を分析し、"
    "7 日後と 30 日後の貯水率 (%) を冷静に予測してください。"
    "出力は必ず JSON のみ。"
    "推測には根拠を併記し、不確実性が高い場合はその旨を理由に含めること。"
)


USER_PROMPT_TEMPLATE = """以下のダム監視データから 7 日後・30 日後の貯水率を予測し、警戒レベルを判定してください。

## ダム情報
- 名称: {dam_name}
- 総貯水量: {capacity} 千m³
- 流域面積: {basin_area} km²
- 取水制限ライン: 30%

## 現状
- 基準日: {base_date}
- 貯水率: {base_pct}%
- 直近の貯水率減少率（無降雨日平均, pt/日）: {drop_rate}

## 過去 {history_days} 日の日次データ (古い順)
{history_table}

## 気象庁 週間予報 (これから)
{forecast_table}

## 出力フォーマット (JSON only, 他のテキストは出さない)
{{
  "predicted7d": 数値（%）,
  "predicted30d": 数値（%）,
  "warningLevel": "low" | "mid" | "high",
  "reasoning": "200 字以内で根拠と注目点。降水量・気温・季節要因への言及推奨。"
}}
"""


@dataclass
class LLMResponse:
    provider: str
    model: str
    predicted7d: float | None
    predicted30d: float | None
    warning_level: str | None
    reasoning: str | None
    raw_response: str | None
    error: str | None
    elapsed_ms: int


# ----------------------------------------------------------------------------
# プロンプト構築
# ----------------------------------------------------------------------------

def _format_history(history: list[dict]) -> str:
    lines = ["日付       | 貯水率(%) | 降水量(mm)"]
    for h in history:
        lines.append(f"{h['date']} | {h['storPcnt']:>9.1f} | {h['precipitation']:>10.1f}")
    return "\n".join(lines)


def _format_forecast(forecast: list[dict]) -> str:
    lines = ["日付       | 降水量推定(mm) | 降水確率(%) | 最高/最低気温(℃) | 天気"]
    for f in forecast:
        lines.append(
            f"{f['date']} | {(f.get('precipitation') or 0):>14.1f} | "
            f"{(f.get('precipProb') or 0):>11.0f} | "
            f"{(f.get('tempMax') or 0):>5}/{(f.get('tempMin') or 0):<5} | "
            f"{f.get('weatherText') or '-'}"
        )
    return "\n".join(lines)


def build_user_prompt(context: dict[str, Any]) -> str:
    dam = context["dam"]
    history = context.get("history", [])
    forecast = context.get("forecast", [])
    return USER_PROMPT_TEMPLATE.format(
        dam_name=dam.get("name", "-"),
        capacity=dam.get("totalCapacity", "-"),
        basin_area=dam.get("basinArea", "-"),
        base_date=history[-1]["date"] if history else "-",
        base_pct=history[-1]["storPcnt"] if history else "-",
        drop_rate=context.get("recentDropRate"),
        history_days=len(history),
        history_table=_format_history(history),
        forecast_table=_format_forecast(forecast),
    )


# ----------------------------------------------------------------------------
# LLM クライアント (それぞれ独立、失敗してもサイレント)
# ----------------------------------------------------------------------------

def _parse_json_response(text: str) -> dict[str, Any] | None:
    """LLM の出力から JSON を抽出してパース。前後の言葉も許容。"""
    text = text.strip()
    # ```json fence 除去
    if text.startswith("```"):
        lines = text.splitlines()
        lines = [l for l in lines if not l.startswith("```")]
        text = "\n".join(lines).strip()
    # 最初の { から最後の } まで
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        return json.loads(text[start : end + 1])
    except Exception:
        return None


def call_claude(prompt: str) -> LLMResponse:
    start = time.time()
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        msg = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in msg.content if hasattr(b, "text"))
        parsed = _parse_json_response(text) or {}
        return LLMResponse(
            provider="claude",
            model=CLAUDE_MODEL,
            predicted7d=parsed.get("predicted7d"),
            predicted30d=parsed.get("predicted30d"),
            warning_level=parsed.get("warningLevel"),
            reasoning=parsed.get("reasoning"),
            raw_response=text,
            error=None,
            elapsed_ms=int((time.time() - start) * 1000),
        )
    except Exception as e:
        return LLMResponse(
            provider="claude", model=CLAUDE_MODEL,
            predicted7d=None, predicted30d=None,
            warning_level=None, reasoning=None,
            raw_response=None, error=f"{type(e).__name__}: {e}",
            elapsed_ms=int((time.time() - start) * 1000),
        )


def call_openai(prompt: str) -> LLMResponse:
    start = time.time()
    try:
        from openai import OpenAI

        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        # reasoning_effort=high を含む responses API
        resp = client.responses.create(
            model=OPENAI_MODEL,
            input=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            reasoning={"effort": "high"},
        )
        text = resp.output_text  # type: ignore[attr-defined]
        parsed = _parse_json_response(text) or {}
        return LLMResponse(
            provider="openai",
            model=OPENAI_MODEL,
            predicted7d=parsed.get("predicted7d"),
            predicted30d=parsed.get("predicted30d"),
            warning_level=parsed.get("warningLevel"),
            reasoning=parsed.get("reasoning"),
            raw_response=text,
            error=None,
            elapsed_ms=int((time.time() - start) * 1000),
        )
    except Exception as e:
        return LLMResponse(
            provider="openai", model=OPENAI_MODEL,
            predicted7d=None, predicted30d=None,
            warning_level=None, reasoning=None,
            raw_response=None, error=f"{type(e).__name__}: {e}",
            elapsed_ms=int((time.time() - start) * 1000),
        )


def call_gemini(prompt: str) -> LLMResponse:
    start = time.time()
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        resp = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=f"{SYSTEM_PROMPT}\n\n{prompt}",
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        text = resp.text or ""
        parsed = _parse_json_response(text) or {}
        return LLMResponse(
            provider="gemini",
            model=GEMINI_MODEL,
            predicted7d=parsed.get("predicted7d"),
            predicted30d=parsed.get("predicted30d"),
            warning_level=parsed.get("warningLevel"),
            reasoning=parsed.get("reasoning"),
            raw_response=text,
            error=None,
            elapsed_ms=int((time.time() - start) * 1000),
        )
    except Exception as e:
        return LLMResponse(
            provider="gemini", model=GEMINI_MODEL,
            predicted7d=None, predicted30d=None,
            warning_level=None, reasoning=None,
            raw_response=None, error=f"{type(e).__name__}: {e}",
            elapsed_ms=int((time.time() - start) * 1000),
        )


def call_all_parallel(prompt: str) -> list[LLMResponse]:
    callers = [call_claude, call_openai, call_gemini]
    results: list[LLMResponse] = []
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(c, prompt): c.__name__ for c in callers}
        for fut in as_completed(futs):
            results.append(fut.result())
    return results


# ----------------------------------------------------------------------------
# DB 保存
# ----------------------------------------------------------------------------

INSERT_LLM_SQL = """
INSERT INTO "LLMForecast" (
    "runId", provider, model, "predicted7d", "predicted30d",
    "warningLevel", reasoning, "promptInput", "rawResponse",
    "generationMs", "errorMessage", "generatedAt"
) VALUES (
    %(run_id)s, %(provider)s, %(model)s, %(p7)s, %(p30)s,
    %(warn)s, %(reasoning)s, %(prompt)s::jsonb, %(raw)s,
    %(ms)s, %(err)s, NOW()
)
"""


def save_results(run_id: int, prompt: str, responses: list[LLMResponse]) -> None:
    with connect() as conn, conn.cursor() as cur:
        for r in responses:
            cur.execute(INSERT_LLM_SQL, {
                "run_id": run_id,
                "provider": r.provider,
                "model": r.model,
                "p7": r.predicted7d,
                "p30": r.predicted30d,
                "warn": r.warning_level,
                "reasoning": r.reasoning,
                "prompt": json.dumps({"system": SYSTEM_PROMPT, "user": prompt}, ensure_ascii=False),
                "raw": r.raw_response,
                "ms": r.elapsed_ms,
                "err": r.error,
            })
        conn.commit()


def run_for_runId(run_id: int) -> list[LLMResponse]:
    """既存の PredictionRun に LLM 予測を追加。"""
    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "contextJson" FROM "PredictionRun" WHERE id = %s', (run_id,))
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"PredictionRun id={run_id} not found")
        context = row[0]

    prompt = build_user_prompt(context)
    responses = call_all_parallel(prompt)
    save_results(run_id, prompt, responses)
    return responses


def main() -> None:
    """全ダムの最新 PredictionRun に LLM 予測を追加。"""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON ("damId") id, "damId"
            FROM "PredictionRun"
            ORDER BY "damId", "generatedAt" DESC
            """,
        )
        runs = list(cur.fetchall())

    for run_id, dam_id in runs:
        print(f"\n=== PredictionRun id={run_id} (damId={dam_id}) ===")
        responses = run_for_runId(run_id)
        for r in responses:
            if r.error:
                print(f"  ❌ {r.provider} ({r.model}) [{r.elapsed_ms}ms]: {r.error}")
            else:
                print(
                    f"  ✓ {r.provider} ({r.model}) [{r.elapsed_ms}ms]: "
                    f"7d={r.predicted7d} 30d={r.predicted30d} warn={r.warning_level}"
                )
                if r.reasoning:
                    print(f"      → {r.reasoning[:120]}")


if __name__ == "__main__":
    main()
