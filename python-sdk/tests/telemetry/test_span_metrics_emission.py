"""Regression test: `span.update(metrics={...})` must emit
`gen_ai.usage.prompt_tokens` / `gen_ai.usage.completion_tokens` alongside the
JSON `langwatch.metrics` blob, so LangWatch's cost-fold pipeline can roll cost
up from numeric OTel attributes (the JSON path has silently swallowed malformed
payloads in the past).
"""

from __future__ import annotations

import contextlib
import os

import pytest
from opentelemetry import trace as trace_api
from opentelemetry.sdk import trace as trace_sdk

import langwatch
from langwatch.telemetry.tracing import LangWatchTrace


pytestmark = pytest.mark.unit


@pytest.fixture(scope="module", autouse=True)
def _ensure_tracer_installed():
    prev_env_api_key = os.environ.get("LANGWATCH_API_KEY")
    prev_api_key = getattr(langwatch, "_api_key", None)
    prev_endpoint = getattr(langwatch, "_endpoint", None)

    os.environ["LANGWATCH_API_KEY"] = "test-key-for-metrics-emission"
    langwatch._api_key = "test-key-for-metrics-emission"
    langwatch._endpoint = "http://localhost:5560"
    with contextlib.suppress(Exception):
        langwatch.setup()
    if not hasattr(trace_api.get_tracer_provider(), "add_span_processor"):
        trace_api.set_tracer_provider(trace_sdk.TracerProvider())
    try:
        yield
    finally:
        if prev_env_api_key is None:
            os.environ.pop("LANGWATCH_API_KEY", None)
        else:
            os.environ["LANGWATCH_API_KEY"] = prev_env_api_key
        langwatch._api_key = prev_api_key
        langwatch._endpoint = prev_endpoint


class TestSpanMetricsEmitsGenAiUsage:
    def test_update_with_metrics_sets_both_json_and_gen_ai_usage(self):
        trace = LangWatchTrace()
        with trace:
            trace.root_span.update(
                type="llm",
                model="openai/gpt-5-mini",
                metrics={"prompt_tokens": 40, "completion_tokens": 25},
            )
            attrs = dict(trace.root_span._span.attributes)

        assert attrs.get("gen_ai.usage.prompt_tokens") == 40
        assert attrs.get("gen_ai.usage.completion_tokens") == 25
        assert "langwatch.metrics" in attrs
        assert attrs.get("langwatch.span.type") == "llm"
        assert attrs.get("gen_ai.request.model") == "openai/gpt-5-mini"

    def test_update_preserves_existing_metrics_across_calls(self):
        trace = LangWatchTrace()
        with trace:
            trace.root_span.update(type="llm", metrics={"prompt_tokens": 10})
            trace.root_span.update(metrics={"completion_tokens": 7})
            attrs = dict(trace.root_span._span.attributes)

        assert attrs.get("gen_ai.usage.prompt_tokens") == 10
        assert attrs.get("gen_ai.usage.completion_tokens") == 7

    def test_update_without_metrics_does_not_emit_gen_ai_usage(self):
        trace = LangWatchTrace()
        with trace:
            trace.root_span.update(type="llm", model="openai/gpt-5-mini")
            attrs = dict(trace.root_span._span.attributes)

        assert "gen_ai.usage.prompt_tokens" not in attrs
        assert "gen_ai.usage.completion_tokens" not in attrs

    def test_float_token_counts_are_coerced_to_int(self):
        trace = LangWatchTrace()
        with trace:
            trace.root_span.update(
                type="llm", metrics={"prompt_tokens": 12.0, "completion_tokens": 9.7}
            )
            attrs = dict(trace.root_span._span.attributes)

        assert attrs.get("gen_ai.usage.prompt_tokens") == 12
        assert attrs.get("gen_ai.usage.completion_tokens") == 9
