"""
LangWatch

This is the top level module for [LangWatch](https://github.com/langwatch/langwatch),
it holds the api_key and the endpoint the tracing is going to be send to.

For LLM and library-specific tracing functions, check out the other files on this module.
"""

import os

from langwatch.tracer import span, create_span, capture_rag
from langwatch.dspy import langwatch_dspy as dspy

endpoint = os.environ.get("LANGWATCH_ENDPOINT") or "https://app.langwatch.ai"
api_key = os.environ.get("LANGWATCH_API_KEY")

__all__ = ("endpoint", "api_key", "span", "create_span", "capture_rag", "dspy")
