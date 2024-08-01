import json
import os
import importlib
from typing import Optional, cast
import pytest
import asyncio
import chainlit as cl

from chainlit.context import init_http_context
import langwatch
from langwatch.tracer import ContextTrace


last_trace: Optional[ContextTrace] = None
trace_urls: dict[str, str] = {}


original_init = ContextTrace.__init__


def patched_init(self, *args, **kwargs):
    global last_trace
    last_trace = self

    return original_init(self, *args, **kwargs)


ContextTrace.__init__ = patched_init


def get_example_files():
    examples_dir = os.path.join(os.path.dirname(__file__), "..", "examples")
    return [f for f in os.listdir(examples_dir) if f.endswith(".py")]


@pytest.mark.parametrize("example_file", get_example_files())
@pytest.mark.asyncio
async def test_example_main_functions(example_file):
    if example_file == "batch_evalutation.py":
        pytest.skip("batch_evalutation.py is not a runnable example")

    global last_trace
    last_trace = None

    # Dynamically import the main function from the example file
    module_name = f"examples.{example_file[:-3]}"  # Remove .py extension
    module = importlib.import_module(module_name)
    init_http_context()

    # Skip if there's no main function
    main_func = getattr(module, "main", None)
    if "fastapi" in example_file:
        main_func = getattr(module, "call_fastapi_sample_endpoint", None)
    if main_func is None:
        pytest.skip(f"No main function found in {example_file}")

    on_chat_start = getattr(module, "on_chat_start", None)
    if on_chat_start is not None:
        await on_chat_start()

    # Create a mock cl.Message
    content = "what is LangWatch?" if "rag" in example_file else "hello"
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
