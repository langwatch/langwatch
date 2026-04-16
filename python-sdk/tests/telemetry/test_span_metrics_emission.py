"""Regression test: `LangWatchSpan.update(metrics={...})` must emit
`gen_ai.usage.prompt_tokens` / `gen_ai.usage.completion_tokens` alongside the
JSON `langwatch.metrics` blob, so LangWatch's cost-fold pipeline can roll
cost up from numeric OTel attributes (the JSON path has silently swallowed
malformed payloads in the past).

Drives OTel directly via a self-owned TracerProvider so this test does not
care what global provider langwatch.setup() left behind.
"""

from __future__ import annotations

import contextlib
import os

import pytest
from opentelemetry.sdk import trace as trace_sdk

import langwatch
from langwatch.telemetry.span import LangWatchSpan


pytestmark = pytest.mark.unit


@pytest.fixture(scope="module", autouse=True)
def _setup_langwatch():
    prev_env_api_key = os.environ.get("LANGWATCH_API_KEY")
    prev_api_key = getattr(langwatch, "_api_key", None)
    prev_endpoint = getattr(langwatch, "_endpoint", None)

    os.environ["LANGWATCH_API_KEY"] = "test-key-for-metrics-emission"
    langwatch._api_key = "test-key-for-metrics-emission"
    langwatch._endpoint = "http://localhost:5560"
    with contextlib.suppress(Exception):
        langwatch.setup()
    try:
        yield
    finally:
        if prev_env_api_key is None:
            os.environ.pop("LANGWATCH_API_KEY", None)
        else:
            os.environ["LANGWATCH_API_KEY"] = prev_env_api_key
        langwatch._api_key = prev_api_key
        langwatch._endpoint = prev_endpoint


@pytest.fixture
def otel_span() -> trace_sdk.Span:
    """Start a real recording span from a self-owned TracerProvider so
    attribute assertions don't depend on the global provider state."""
    provider = trace_sdk.TracerProvider()
    tracer = provider.get_tracer("test-span-metrics-emission")
    return tracer.start_span("test-span")


def _attrs(span: trace_sdk.Span) -> dict:
    return dict(span.attributes or {})


class TestSpanMetricsEmitsGenAiUsage:
    def test_update_with_metrics_sets_both_json_and_gen_ai_usage(self, otel_span):
        wrapped = LangWatchSpan.wrap_otel_span(otel_span)
        wrapped.update(
            type="llm",
            model="openai/gpt-5-mini",
            metrics={"prompt_tokens": 40, "completion_tokens": 25},
        )
        attrs = _attrs(otel_span)
        assert attrs.get("gen_ai.usage.prompt_tokens") == 40
        assert attrs.get("gen_ai.usage.completion_tokens") == 25
        assert "langwatch.metrics" in attrs
        assert attrs.get("langwatch.span.type") == "llm"
        assert attrs.get("gen_ai.request.model") == "openai/gpt-5-mini"

    def test_update_preserves_existing_metrics_across_calls(self, otel_span):
        wrapped = LangWatchSpan.wrap_otel_span(otel_span)
        wrapped.update(type="llm", metrics={"prompt_tokens": 10})
        wrapped.update(metrics={"completion_tokens": 7})

        attrs = _attrs(otel_span)
        assert attrs.get("gen_ai.usage.prompt_tokens") == 10
        assert attrs.get("gen_ai.usage.completion_tokens") == 7

    def test_update_without_metrics_does_not_emit_gen_ai_usage(self, otel_span):
        wrapped = LangWatchSpan.wrap_otel_span(otel_span)
        wrapped.update(type="llm", model="openai/gpt-5-mini")

        attrs = _attrs(otel_span)
        assert "gen_ai.usage.prompt_tokens" not in attrs
        assert "gen_ai.usage.completion_tokens" not in attrs

    def test_float_token_counts_are_coerced_to_int(self, otel_span):
        wrapped = LangWatchSpan.wrap_otel_span(otel_span)
        wrapped.update(
            type="llm", metrics={"prompt_tokens": 12.0, "completion_tokens": 9.7}
        )

        attrs = _attrs(otel_span)
        assert attrs.get("gen_ai.usage.prompt_tokens") == 12
        assert attrs.get("gen_ai.usage.completion_tokens") == 9
