# LangWatch Python SDK Examples

This directory contains examples demonstrating various LangWatch SDK features. Each example is a runnable Python script that shows real-world usage patterns.

## 📋 Categories

### 🤖 Core Bot Examples

Basic chatbot implementations showing fundamental LangWatch tracing:

| Example | Description | Key Features |
|---------|-------------|--------------|
| [`generic_bot.py`](generic_bot.py) | Simple synchronous chatbot | Basic tracing, metadata |
| [`generic_bot_sync_function.py`](generic_bot_sync_function.py) | Sync function usage | Function-level tracing |
| [`generic_bot_async_streaming.py`](generic_bot_async_streaming.py) | Async streaming responses | Streaming support, async/await |
| [`generic_bot_streaming.py`](generic_bot_streaming.py) | Synchronous streaming | Streaming without async |
| [`generic_bot_span_context_manager.py`](generic_bot_span_context_manager.py) | Manual span management | Context managers, custom spans |
| [`generic_bot_span_low_level.py`](generic_bot_span_low_level.py) | Low-level span control | Direct span manipulation |

### 🔗 Framework Integrations

Examples showing integration with popular AI frameworks:

| Example | Framework | Features |
|---------|-----------|----------|
| [`langchain_bot.py`](langchain_bot.py) | LangChain | LCEL, chains, agents |
| [`langchain_bot_with_memory.py`](langchain_bot_with_memory.py) | LangChain + Memory | Conversation history |
| [`langchain_rag_bot.py`](langchain_rag_bot.py) | LangChain RAG | Retrieval-augmented generation |
| [`langchain_rag_bot_with_threads.py`](langchain_rag_bot_with_threads.py) | LangChain RAG + Threads | Multi-threading |
| [`langchain_rag_bot_vertex_ai.py`](langchain_rag_bot_vertex_ai.py) | LangChain + Vertex AI | Google Cloud integration |
| [`langgraph_rag_bot_with_threads.py`](langgraph_rag_bot_with_threads.py) | LangGraph | Graph-based workflows |
| [`haystack_bot.py`](haystack_bot.py) | Haystack | Document search, pipelines |
| [`dspy_bot.py`](dspy_bot.py) | DSPy | Programmatic prompting |
| [`litellm_bot.py`](litellm_bot.py) | LiteLLM | Multi-provider support |

### 🌐 Web Framework Examples

Examples showing web application integration:

| Example | Framework | Features |
|---------|-----------|----------|
| [`fastapi_app.py`](fastapi_app.py) | FastAPI | Web API with tracing |
| [`prompt_management_fastapi.py`](prompt_management_fastapi.py) | FastAPI | Prompt management API |
| [`streamlit_openai_assistants_api_bot.py`](streamlit_openai_assistants_api_bot.py) | Streamlit | UI with assistants API |

### 📊 Evaluation & Analysis

Examples focused on evaluation and analytics:

| Example | Purpose | Features |
|---------|---------|----------|
| [`evaluation_manual_call.py`](evaluation_manual_call.py) | Manual evaluation | Custom evaluation logic |
| [`span_evaluation.py`](span_evaluation.py) | Span-based evaluation | Automatic span analysis |
| [`custom_evaluation_bot.py`](custom_evaluation_bot.py) | Custom evaluators | User-defined metrics |

### 🛡️ Safety & Reliability

Examples demonstrating guardrails and error handling:

| Example | Focus | Features |
|---------|-------|----------|
| [`guardrails.py`](guardrails.py) | Content safety | Input/output filtering |
| [`guardrails_parallel.py`](guardrails_parallel.py) | Parallel guardrails | Concurrent safety checks |
| [`guardrails_without_tracing.py`](guardrails_without_tracing.py) | Standalone guardrails | Safety without tracing |
| [`generic_bot_exception.py`](generic_bot_exception.py) | Error handling | Exception tracing |

### 🔍 RAG & Retrieval Examples

Advanced retrieval-augmented generation patterns:

| Example | Approach | Features |
|---------|----------|----------|
| [`generic_bot_rag.py`](generic_bot_rag.py) | Basic RAG | Document retrieval |
| [`generic_bot_rag_multithreaded.py`](generic_bot_rag_multithreaded.py) | Multi-threaded RAG | Concurrent processing |
| [`openai_bot_rag.py`](openai_bot_rag.py) | OpenAI + RAG | Embeddings, vector search |

### 📈 Advanced Features

Specialized functionality examples:

| Example | Feature | Description |
|---------|---------|-------------|
| [`fetch_policies_example.py`](fetch_policies_example.py) | Fetch policies | Prompt retrieval strategies |
| [`distributed_tracing.py`](distributed_tracing.py) | Distributed tracing | Multi-service tracing |
| [`dataset_kitchen_sink.py`](dataset_kitchen_sink.py) | Dataset operations | Full dataset workflow |
| [`offline_evaluation.ipynb`](offline_evaluation.ipynb) | Offline analysis | Jupyter notebook evaluation |

### 🔧 Specialized Integrations

Examples for specific use cases and integrations:

| Example | Integration | Purpose |
|---------|-------------|---------|
| [`azure_openai_stream_bot.py`](azure_openai_stream_bot.py) | Azure OpenAI | Cloud provider integration |
| [`strands_bot.py`](strands_bot.py) | Strands | Multi-agent systems |

## 🚀 Running Examples

### Prerequisites
```bash
# Install dependencies
uv sync

# Set API keys (varies by example)
export OPENAI_API_KEY="your-key"
export LANGWATCH_API_KEY="your-langwatch-key"
```

### Run Individual Examples
```bash
# Basic bot
python examples/generic_bot.py

# LangChain integration
python examples/langchain_bot.py

# FastAPI web app
uvicorn examples.fastapi_app:app --reload
```

### Run All Examples (Testing)
```bash
# Run all examples as tests
pytest tests/test_examples.py

# Run specific example
pytest tests/test_examples.py -k "generic_bot"
```

## 📁 Directory Structure

```text
examples/
├── README.md              # This file
├── *.py                   # Individual examples
├── cli/                   # CLI-specific examples
│   └── README.md
├── data/                  # Example data files
├── documentation/         # Documentation examples
├── openinference/         # OpenInference integration
├── opentelemetry/         # OpenTelemetry integration
├── prompt_cli/           # Prompt CLI examples
├── sanity/               # Setup/sanity check examples
├── test_utils/           # Utilities for testing examples
└── weaviate_setup/       # Weaviate-specific setup
```

## 🎯 Example Categories

- **Beginner**: `generic_bot.py`, `generic_bot_sync_function.py`
- **Intermediate**: Framework integrations, basic RAG
- **Advanced**: Multi-threading, distributed tracing, custom evaluations, fetch policies
- **Integration**: Web frameworks, cloud providers, specialized tools

## 📝 Contributing

When adding new examples:
1. Follow naming convention: `{feature/framework}_bot.py`
2. Include docstring explaining what it demonstrates
3. Add to appropriate category in this README
4. Ensure it runs with `pytest tests/test_examples.py`

## 🔗 Related Documentation

- [Main SDK Documentation](../README.md)
- [Testing Guidelines](../TESTING.md)
- [Agent Guidelines](../AGENTS.md)
