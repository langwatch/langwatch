import json
import os
import importlib
import sys
from typing import Optional, cast
import pytest
import asyncio
import chainlit as cl

from chainlit.context import init_http_context
from langwatch.tracer import ContextTrace
from opentelemetry.sdk.trace.export import (
    SpanExportResult,
    SpanExporter,
    SimpleSpanProcessor,
)


last_trace: Optional[ContextTrace] = None
trace_urls: dict[str, str] = {}


original_init = ContextTrace.__init__


def patched_init(self, *args, **kwargs):
    global last_trace
    last_trace = self
    self._force_sync = True

    return original_init(self, *args, **kwargs)


ContextTrace.__init__ = patched_init


class TraceIdCapturerExporter(SpanExporter):
    def export(self, spans):
        global last_trace

        context = spans[0].get_span_context()
        if context is not None:
            trace_id = context.trace_id.to_bytes(16, "big").hex()
            last_trace = ContextTrace(trace_id=trace_id)
        return SpanExportResult.SUCCESS


def get_example_files():
    examples_dir = os.path.join(os.path.dirname(__file__), "..", "examples")
    opentelemetry_dir = os.path.join(examples_dir, "opentelemetry")
    return [
        f
        for f in os.listdir(examples_dir)
        if f.endswith(".py") and not f.startswith("__")
    ] + [
        "opentelemetry/" + f for f in os.listdir(opentelemetry_dir) if f.endswith(".py")
    ]


@pytest.mark.parametrize("example_file", get_example_files())
@pytest.mark.asyncio
async def test_example(example_file):
    if example_file == "batch_evalutation.py":
        pytest.skip("batch_evalutation.py is not a runnable example")
    if example_file == "opentelemetry/openllmetry_anthropic_bot.py":
        pytest.skip(
            "openllmetry anthropic has a bug starting another async process inside"
        )
    if example_file == "opentelemetry/openllmetry_openai_bot.py":
        pytest.skip(
            "openllmetry openai has a bug starting another async process inside"
        )
    if example_file == "langchain_rag_bot_vertex_ai.py":
        pytest.skip(
            "langchain_rag_bot_vertex_ai.py is broken due to a bug in current langchain version of global state mutation when running together with other langchain"
        )

    global last_trace
    last_trace = None

    # Dynamically import the main function from the example file
    module_name = (
        f"examples.{example_file[:-3].replace('/', '.')}"  # Remove .py extension
    )
    module = importlib.import_module(module_name)
    init_http_context()

    # Skip if there's no main function
    main_func = getattr(module, "main", None)
    if "fastapi" in example_file:
        main_func = getattr(module, "call_fastapi_sample_endpoint", None)
    if main_func is None:
        pytest.skip(f"No main function found in {example_file}")

    if "opentelemetry" in example_file:
        tracer_provider = getattr(module, "tracer_provider")
        # Remove console printing exporter
        tracer_provider._active_span_processor._span_processors = (
            tracer_provider._active_span_processor._span_processors[0],
        )
        # Capture trace id
        tracer_provider.add_span_processor(
            SimpleSpanProcessor(TraceIdCapturerExporter())
        )

    on_chat_start = getattr(module, "on_chat_start", None)
    if on_chat_start is not None:
        await on_chat_start()

    # Create a mock cl.Message
    content = (
        "who is the oldest person?"
        if "span_evaluation" in example_file
        else "what is LangWatch?" if "rag" in example_file else "hello"
    )
    mock_message = content if "fastapi" in example_file else cl.Message(content=content)

    # Call the main function
    try:
        if asyncio.iscoroutinefunction(main_func):
            await main_func(mock_message)
        else:
            main_func(mock_message)
    except Exception as e:
        if str(e) != "This exception will be captured by LangWatch automatically":
            pytest.fail(f"Error running main function in {example_file}: {str(e)}")

    if last_trace is not None:
        last_trace = cast(ContextTrace, last_trace)
        last_trace.send_spans()
        trace_urls[example_file] = last_trace.share()
        print(json.dumps(trace_urls, indent=2))


@pytest.mark.asyncio
async def test_example_legacy_langchain_pydantic_bot():
    import subprocess

    result = subprocess.run(
        ["poetry", "run", ".venv/bin/python", "legacy_langchain_pydantic_bot.py"],
        cwd="examples/legacy",
        capture_output=True,
        text=True,
        check=False,
    )

    print(result.stdout)

    if result.returncode != 0:
        pytest.fail(f"Failed to run legacy_langchain_pydantic_bot.py: {result.stderr}")
