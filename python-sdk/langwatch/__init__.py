"""
LangWatch

This is the top level module for [LangWatch](https://github.com/langwatch/langwatch),
it holds the api_key and the endpoint the tracing is going to be send to.

For LLM and library-specific tracing functions, check out the other files on this module.
"""

import os
from warnings import warn

from langwatch.tracer import span, create_span, capture_rag

endpoint = (
    os.environ.get("LANGWATCH_ENDPOINT") or "https://app.langwatch.ai/api/collector"
)
api_key = os.environ.get("LANGWATCH_API_KEY")

if not api_key:
    warn("LANGWATCH_API_KEY is not set, LLMs traces will not be sent, go to https://langwatch.ai to set it up")

__all__ = ("endpoint", "api_key", "span", "create_span")
