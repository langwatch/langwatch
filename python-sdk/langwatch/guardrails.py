from contextlib import contextmanager
from typing import List, Optional

import httpx

from langwatch.evaluations import handle_response, prepare_data
from langwatch.tracer import get_current_trace
from langwatch.types import (
    RAGChunk,
    SpanTypes,
)


def evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
    settings: Optional[dict] = None,
):
    with _optional_create_span(name=slug, type="guardrail") as span:
        request_params = prepare_data(
            slug,
            input,
            output,
            contexts,
            settings=settings,
            span=span,
            as_guardrail=True,
        )
        try:
            with httpx.Client() as client:
                response = client.post(**request_params)
                response.raise_for_status()
        except Exception as e:
            return handle_response(
                {
                    "status": "error",
                    "message": str(e),
                    "passed": True,
                },
                span,
            )

        return handle_response(response.json(), span)


@contextmanager
def _optional_create_span(name: str, type: SpanTypes):
    trace = None
    try:
        trace = get_current_trace()
    except:
        pass
    if trace:
        with trace.span(name=name, type=type) as span:
            yield span
    else:
        yield None


async def async_evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
    settings: Optional[dict] = None,
):
    trace = None
    try:
        trace = get_current_trace()
    except:
        pass

    span = trace.span(name=slug, type="guardrail") if trace else None

    request_params = prepare_data(
        slug, input, output, contexts, settings=settings, span=span, as_guardrail=True
    )
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(**request_params)
            response.raise_for_status()
    except Exception as e:
        return handle_response(
            {
                "status": "error",
                "message": str(e),
                "passed": True,
            },
            span,
        )

    response = handle_response(response.json(), span)

    if span:
        span.end()

    return response
