"""
LangWatch

This is the top level module for [LangWatch](https://github.com/langwatch/langwatch),
it holds the api_key and the endpoint the tracing is going to be send to.

For LLM and library-specific tracing functions, check out the other files on this module.
"""

import os
from warnings import warn

from langwatch.tracer import (
    trace,
    span,
    get_current_trace,
    get_current_span,
    create_span,
    capture_rag,
)
from langwatch.login import login

endpoint = os.environ.get("LANGWATCH_ENDPOINT") or "https://app.langwatch.ai"
api_key = os.environ.get("LANGWATCH_API_KEY")
debug = False

dspy_available = False
try:
    import dspy

    dspy_available = True
except ImportError:
    pass

dspy = None
if dspy_available:
    try:
        from langwatch.dspy import langwatch_dspy

        dspy = langwatch_dspy
    except ImportError:
        warn(
            "DSPy seems to be installed but we couldn't import langwatch.dspy, please check your dspy dependency installation."
        )

langchain_available = False
try:
    import langchain

    langchain_available = True
except ImportError:
    pass

langchain = None
if langchain_available:
    try:
        import langwatch.langchain as langchain
    except ImportError:
        warn(
            "LangChain seems to be installed but we couldn't import langwatch.langchain, please check your langchain dependency installation."
        )

__all__ = (
    "endpoint",
    "api_key",
    "trace",
    "span",
    "get_current_trace",
    "get_current_span",
    "create_span",
    "capture_rag",
    "langchain",
    "dspy",
    "login",
)
