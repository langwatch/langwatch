from typing import List, Literal, Optional, Union, cast
from warnings import warn

from pydantic import BaseModel
import requests

import langwatch
import langwatch.tracer
from langwatch.tracer import get_current_tracer
from langwatch.types import GuardrailResult, RAGChunk, TypedValueGuardrailResult


class GuardrailResultModel(BaseModel):
    status: Literal["processed", "skipped", "error"]
    passed: bool = True
    score: Optional[float] = None
    details: Optional[str] = None


def evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
):
    current_tracer = get_current_tracer()
    if not langwatch.api_key:
        warn(
            f"LANGWATCH_API_KEY is not set, {slug} guardrail is being skipped, go to https://langwatch.ai to set it up"
        )
        return GuardrailResultModel(
            status="skipped", passed=True, details="API key not set"
        )

    with langwatch.tracer.create_span(name=slug, type="guardrail") as span:
        data = {}
        if input:
            data["input"] = input
        if output:
            data["output"] = output
        if contexts and len(contexts) > 0:
            data["contexts"] = contexts
        span.input = data

        response = requests.post(
            langwatch.endpoint + f"/api/guardrails/{slug}/evaluate",
            json={
                "trace_id": current_tracer.trace_id if current_tracer else None,
                "data": data,
            },
            headers={"X-Auth-Token": str(langwatch.api_key)},
        )
        response.raise_for_status()

        result = GuardrailResultModel.model_validate(response.json())
        if result.status == "error":
            result.details = response.json()["message"]
        span.output = TypedValueGuardrailResult(
            type="guardrail_result", value=cast(GuardrailResult, result.model_dump())
        )
        return result
