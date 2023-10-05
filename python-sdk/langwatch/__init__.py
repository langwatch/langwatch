"""
LangWatch

This is the top level module for [LangWatch](https://github.com/langwatch/langwatch),
all the core classes and functions are made available to be imported from here.
"""

import os


endpoint = "https://app.langwatch.ai/api/trace"
api_key = os.environ.get("LANGWATCH_API_KEY")

import langwatch.openai as openai

__all__ = ("endpoint", "api_key", "openai")
