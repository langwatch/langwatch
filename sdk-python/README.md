# LangWatch Python SDK

The LangWatch Python SDK allows you to integrate LangWatch into your Python application to start observing your LLM interactions. This guide covers the setup and basic usage of the LangWatch Python SDK.

[![LangWatch Python SDK version](https://img.shields.io/pypi/v/langwatch)](https://pypi.org/project/langwatch/)
[![LangWatch Repo](https://img.shields.io/github/stars/langwatch/langwatch?style=social)](https://github.com/langwatch/langwatch)


## Get your LangWatch API Key

First, you need a LangWatch API key. Sign up at [app.langwatch.ai](https://app.langwatch.ai) and find your API key in your project settings. The SDK will automatically use the `LANGWATCH_API_KEY` environment variable if it is set.

## Installation

Ensure you have the SDK installed:

```bash
pip install langwatch
```

## Getting Started

Initialize LangWatch early in your application, typically where you configure services:

```python
import langwatch

# The SDK will automatically use the LANGWATCH_API_KEY environment variable
# Or you can pass it explicitly: langwatch.setup(api_key="your_api_key")
langwatch.setup()

# Your application code...
```

If you have an existing OpenTelemetry setup in your application, please see the "Full Setup" section below for how to integrate.

### Capturing Messages: Traces and Spans

LangWatch uses the concepts of Traces and Spans to capture your LLM pipeline:

*   **Trace**: Represents a single, end-to-end operation, like processing a user message. Each message triggering your LLM pipeline as a whole is captured with a Trace.
*   **Span**: Represents a specific step or unit of work within a Trace. This could be an LLM call, a database query for RAG retrieval, or a simple function transformation.
    *   Different types of Spans capture different parameters.
    *   Spans can be nested to capture the pipeline structure.

Traces can be grouped together on the LangWatch Dashboard by having the same `thread_id` in their metadata, making individual messages part of a conversation. It is also recommended to provide the `user_id` metadata to track user analytics.

### Creating a Trace

To capture an end-to-end operation, you can wrap the main function or entry point with the `@langwatch.trace()` decorator. This automatically creates a root span for the entire operation.

```python
import langwatch
from openai import OpenAI
# import chainlit as cl # Assuming cl.Message is from chainlit

client = OpenAI()

@langwatch.trace()
async def handle_message(message_content: str): # Changed cl.Message to str for a generic example
    # This whole function execution is now a single trace
    # For specific integrations like OpenAI, you can enable auto-tracking
    langwatch.get_current_trace().autotrack_openai_calls(client) # Automatically capture OpenAI calls

    # ... rest of your message handling logic ...
    print(f"Handling message: {message_content}")
    pass

# Example usage:
# import asyncio
# asyncio.run(handle_message("Hello LangWatch!"))
```

You can customize the trace name and add initial metadata:

```python
@langwatch.trace(name="My Custom Trace Name", metadata={"user_query": "message_content_placeholder"})
async def handle_custom_message(message_content: str):
    langwatch.get_current_trace().update(metadata={"user_query": message_content})
    # ...
    pass
```

Within a traced function, you can access the current trace context using `langwatch.get_current_trace()`.

### Capturing a Span

To instrument specific parts of your pipeline within a trace (like an LLM operation, RAG retrieval, or external API call), use the `@langwatch.span()` decorator.

```python
import langwatch
from langwatch.types import RAGChunk # Make sure RAGChunk is correctly imported

@langwatch.span(type="rag", name="RAG Document Retrieval") # Add type and custom name
def rag_retrieval(query: str):
    # ... logic to retrieve documents ...
    search_results = [
        {"id": "doc-1", "content": "Document 1 content about " + query},
        {"id": "doc-2", "content": "Document 2 content related to " + query}
    ]

    # Add specific context data to the span
    # Ensure RAGChunk is defined or imported correctly if you use it.
    # For simplicity, metadata is shown directly.
    current_span = langwatch.get_current_span()
    if current_span:
        current_span.update(
            contexts=[ # Assuming RAGChunk is a type you've defined or imported
                RAGChunk(document_id=doc["id"], content=doc["content"])
                for doc in search_results
            ],
            metadata={"retrieval_strategy": "vector_search"} # Add custom metadata
        )

    return search_results

@langwatch.trace()
async def handle_message_with_rag(message_content: str):
    # ...
    print(f"Processing with RAG: {message_content}")
    retrieved_docs = rag_retrieval(message_content) # This call creates a nested span
    # ...
    print(f"Retrieved docs: {retrieved_docs}")

# Example usage:
# import asyncio
# asyncio.run(handle_message_with_rag("Tell me about LangWatch."))
```

The `@langwatch.span()` decorator automatically captures the decorated function's arguments as the span's input and its return value as the output. This behavior can be controlled via the `capture_input` and `capture_output` arguments (both default to `True`).

Spans created within a function decorated with `@langwatch.trace()` will automatically be nested under the main trace span. You can add additional type, name, metadata, and events, or override the automatic input/output using decorator arguments or the `update()` method on the span object obtained via `langwatch.get_current_span()`.

For detailed guidance on manually creating traces and spans using context managers or direct start/end calls, see the (Manual Instrumentation Tutorial - link to be added).

## Full Setup

Here's an example of a more comprehensive setup:

```python
import os
import langwatch
from langwatch.attributes import AttributeKey # Ensure this is the correct import path
from langwatch.domain import SpanProcessingExcludeRule # Ensure this is the correct import path

# Example: Define your instrumentor if it's custom, or import from a community/library path
# from community.instrumentors import OpenAIInstrumentor # This is an example path
# If using standard OpenTelemetry instrumentors, they might be configured differently
# or LangWatch might provide its own wrappers.
# For this example, let's assume a placeholder or that it's handled by LangWatch internally
# if not explicitly provided or if using LangWatch's own instrumentors.

from opentelemetry.sdk.trace import TracerProvider

# Example: Providing an existing TracerProvider
# existing_provider = TracerProvider()

# Example: Defining exclude rules
exclude_rules = [
    SpanProcessingExcludeRule(
      field_name=["span_name"], # Ensure field_name is a list if required by the type
      match_value="GET /health_check",
      match_operation="exact_match"
    ),
]

langwatch.setup(
    api_key=os.getenv("LANGWATCH_API_KEY"),
    endpoint_url=os.getenv("LANGWATCH_ENDPOINT_URL", "https://app.langwatch.ai"), # Optional: Defaults to env var or cloud
    base_attributes={
      AttributeKey.ServiceName: "my-awesome-service",
      AttributeKey.ServiceVersion: "1.2.3",
      # Add other custom attributes here
    },
    # instrumentors=[OpenAIInstrumentor()], # Optional: List of instrumentors.
                                            # Ensure OpenAIInstrumentor is correctly defined/imported.
                                            # LangWatch might have its own list of built-in instrumentors or ways to enable them.
    # tracer_provider=existing_provider, # Optional: Provide your own TracerProvider
    debug=os.getenv("LANGWATCH_DEBUG", "false").lower() == "true", # Optional: Enable debug logging
    disable_sending=False, # Optional: Disable sending traces
    flush_on_exit=True, # Optional: Flush traces on exit (default: True)
    span_exclude_rules=exclude_rules, # Optional: Rules to exclude spans
    ignore_global_tracer_provider_override_warning=False # Optional: Silence warning if global provider exists
)

# Your application code...
print("LangWatch SDK fully configured.")
```

### `langwatch.setup()` Options

*   **`api_key`** (`str | None`): Your LangWatch API key. If not provided, it uses the `LANGWATCH_API_KEY` environment variable.
*   **`endpoint_url`** (`str | None`): The LangWatch endpoint URL. Defaults to the `LANGWATCH_ENDPOINT` environment variable or `https://app.langwatch.ai`.
*   **`base_attributes`** (`dict[str, Any] | None`): A dictionary of attributes to add to all spans (e.g., service name, version). Automatically includes SDK name, version, and language.
*   **`instrumentors`** (`Sequence[Instrumentor] | None`): A list of automatic instrumentors (e.g., `OpenAIInstrumentor`, `LangChainInstrumentor`) to capture data from supported libraries. Ensure these conform to the `Instrumentor` protocol expected by LangWatch.
*   **`tracer_provider`** (`TracerProvider | None`): An existing OpenTelemetry `TracerProvider`. If provided, LangWatch will use it (adding its exporter) instead of creating a new one. If not provided, LangWatch checks the global provider or creates a new one.
*   **`debug`** (`bool`, default: `False`): Enable debug logging for LangWatch. Defaults to `False` or checks if the `LANGWATCH_DEBUG` environment variable is set to `"true"`.
*   **`disable_sending`** (`bool`, default: `False`): If `True`, disables sending traces to the LangWatch server. Useful for testing or development.
*   **`flush_on_exit`** (`bool`, default: `True`): If `True` (the default), the tracer provider will attempt to flush all pending spans when the program exits via `atexit`.
*   **`span_exclude_rules`** (`List[SpanProcessingExcludeRule] | None`): If provided, the SDK will exclude spans from being exported to LangWatch based on the rules defined in the list (e.g., matching span names).
*   **`ignore_global_tracer_provider_override_warning`** (`bool`, default: `False`): If `True`, suppresses the warning message logged when an existing global `TracerProvider` is detected and LangWatch attaches its exporter to it instead of overriding it.

## Python SDK Integrations

Our Python SDK supports the following auto-instrumentors.

- [OpenAI](https://docs.langwatch.ai/integration/python/guide#open-ai)
- [Azure](https://docs.langwatch.ai/integration/python/guide#azure)
- [LiteLLM](https://docs.langwatch.ai/integration/python/guide#lite-llm)
- [DSPy](https://docs.langwatch.ai/integration/python/guide#ds-py)
- [LangChain](https://docs.langwatch.ai/integration/python/guide#lang-chain)

Though OpenTelemetry, we also support all the frameworks and providers that support them, such as:

- AWS Bedrock
- Haystack
- CrewAI
- Autogen
- Grok
- …and many more

You can find a [full guide](https://docs.langwatch.ai/integration/opentelemetry/guide) on our docs.


## Resources

*   [LangWatch Python GitHub Repo](https://github.com/langwatch/langwatch) (Assuming this is the correct repo for the SDK)
*   [LangWatch Website](https://langwatch.ai)
*   [LangWatch Dashboard](https://app.langwatch.ai)
