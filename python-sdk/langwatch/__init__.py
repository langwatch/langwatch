"""
LangWatch

This is the top level module for [LangWatch](https://github.com/langwatch/langwatch),
it holds the api_key and the endpoint the tracing is going to be send to.

For LLM and library-specific tracing functions, check out the other files on this module.
"""

import os

from langwatch.tracer import span

endpoint = "https://app.langwatch.ai/api/trace"
api_key = os.environ.get("LANGWATCH_API_KEY")

__all__ = ("endpoint", "api_key", "span")
