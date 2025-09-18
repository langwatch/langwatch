import json
import os
import importlib
import random
from typing import Optional, Sequence, cast
import pytest
import asyncio
import chainlit as cl
import chainlit.config as chainlit_config

import langwatch
from chainlit.context import init_http_context
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import (
    SpanExportResult,
    SpanExporter,
    SimpleSpanProcessor,
)
from opentelemetry.sdk.trace import ReadableSpan
import litellm
from litellm.files.main import ModelResponse

trace_urls: dict[str, str] = {}


chainlit_config.config.project.enable_telemetry = False


class TraceIdCapturerExporter(SpanExporter):
    def __init__(self):
        self.captured_trace_id: Optional[str] = None

    def export(self, spans: Sequence[ReadableSpan]):
        if self.captured_trace_id is None and spans:
            span = spans[0]
            context = span.get_span_context()
            if context and context.is_valid:
                self.captured_trace_id = f"{context.trace_id:032x}"
        return SpanExportResult.SUCCESS


def get_example_files():
    examples_dir = os.path.join(os.path.dirname(__file__), "..", "examples")
    opentelemetry_dir = os.path.join(examples_dir, "opentelemetry")
    return [
        f"examples/{f}"
        for f in os.listdir(examples_dir)
        if f.endswith(".py") and not f.startswith("__")
    ] + [
        f"examples/opentelemetry/{f}"
        for f in os.listdir(opentelemetry_dir)
        if f.endswith(".py")
    ]


@pytest.mark.parametrize("example_file", get_example_files())
@pytest.mark.asyncio
async def test_example(example_file: str):
    # FIXME: Reset LiteLLM global cache to prevent conflicts between tests
    # When running tests as a group, LiteLLM's global cache state gets polluted
    # causing "Cache.get_cache() got multiple values for argument 'self'" errors.
    # This doesn't happen when running individual tests (fresh Python process).
    # The cache reset prevents state pollution between different example tests.
    litellm.cache = None

    example_file = example_file.replace("examples/", "")
    if example_file.startswith("cli/"):
        pytest.skip("CLI examples are tested separately via make cli-examples")
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
    if example_file == "litellm_bot.py" and not os.getenv("CEREBRAS_API_KEY"):
        pytest.skip(
            "litellm_bot.py requires CEREBRAS_API_KEY environment variable to be set"
        )

    module_name = f"examples.{example_file[:-3].replace('/', '.')}"
    module = importlib.import_module(module_name)
    init_http_context()

    main_func = getattr(module, "main", None)
    if "fastapi" in example_file:
        main_func = getattr(module, "call_fastapi_sample_endpoint", None)
    if main_func is None:
        pytest.skip(f"No main function found in {example_file}")

    if "opentelemetry" in example_file:
        tracer_provider = trace_sdk.TracerProvider()
        # Capture trace id
        tracer_provider.add_span_processor(
            SimpleSpanProcessor(TraceIdCapturerExporter())
        )

    on_chat_start = getattr(module, "on_chat_start", None)
    if on_chat_start is not None:
        await on_chat_start()

    # Create a mock cl.Message
    if "span_evaluation" in example_file:
        content = "who is the oldest person?"
    elif "rag" in example_file:
        content = "what is LangWatch?"
    else:
        starters = [
            "when",
            "who",
            "what",
            "where",
            "why",
            "how",
            "if",
            "how much",
        ]
        starter = random.choice(starters)
        message = cast(
            ModelResponse,
            litellm.completion(
                model="gpt-4.1-nano",
                messages=[
                    {
                        "role": "system",
                        "content": f'Pretend to be a user, you are asking a question to a chatbot, any question, mundane, one short line, all lowercase, be creative. Start the question with "{starter}".',
                    }
                ],
                temperature=1.0,
                caching=False,
            ),
        )
        content = message["choices"][0]["message"]["content"]

    mock_message = content if "fastapi" in example_file else cl.Message(content=content)

    # Call the main function
    with langwatch.trace() as trace:
        try:
            if "documentation" in example_file:
                if asyncio.iscoroutinefunction(main_func):
                    await main_func()
                else:
                    main_func()
            else:
                if asyncio.iscoroutinefunction(main_func):
                    await main_func(mock_message)
                else:
                    main_func(mock_message)
        except Exception as e:
            if str(e) != "This exception will be captured by LangWatch automatically":
                # FIXME: Skip tests that depend on external ColBERTv2 service when it's unavailable
                # This is a temporary workaround for the unreliable external service at
                # http://20.102.90.50:2017/wiki17_abstracts which frequently fails due to
                # rate limiting, service overload, or connectivity issues.
                #
                # Long-term solutions should include:
                # 1. Setting up a reliable local ColBERTv2 instance
                # 2. Mocking the ColBERTv2 service for tests
                # 3. Using a different, more reliable retrieval service

                # Check if this example file uses the problematic ColBERTv2 service
                def uses_colbert_service(file_path: str) -> bool:
                    try:
                        with open(file_path, "r") as f:
                            content = f.read()
                            return "20.102.90.50:2017/wiki17_abstracts" in content
                    except Exception:
                        return False

                examples_dir = os.path.join(os.path.dirname(__file__), "..", "examples")
                full_file_path = os.path.join(examples_dir, example_file)

                if uses_colbert_service(full_file_path):
                    pytest.skip(
                        f"Skipping {example_file} due to unreliable external ColBERTv2 service: {e}"
                    )
                # FIXME: Skip tests that fail due to transient external service issues
                # OpenAI server errors, rate limiting, and other external API issues
                # should not cause CI failures as they're not code bugs
                elif any(
                    error_indicator in str(e)
                    for error_indicator in [
                        "The server had an error processing your request. Sorry about that!",  # OpenAI
                        # "Error code: 404",
                        # "This is a chat model and not supported in the v1/completions endpoint",
                        "Rate limit",
                        "API Error",
                        "Connection error",
                        "Timeout",
                    ]
                ):
                    pytest.skip(
                        f"Skipping {example_file} due to external service issue: {e}"
                    )
                else:
                    pytest.fail(f"Error running main function in {example_file}: {e!s}")
        trace.send_spans()
        trace_urls[example_file] = trace.share()
        print(json.dumps(trace_urls, indent=2))
