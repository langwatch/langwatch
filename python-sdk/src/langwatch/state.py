"""Module for storing global state."""

import os
from typing import Optional
from .types import LangWatchClientProtocol

# Singleton instance of the client
__instance: Optional[LangWatchClientProtocol] = None

def get_instance() -> Optional[LangWatchClientProtocol]:
    """Get the current LangWatch client instance."""
    return __instance

def set_instance(client: LangWatchClientProtocol) -> None:
    """Set the current LangWatch client instance."""
    global __instance
    __instance = client

def get_endpoint() -> str:
    """Get the current endpoint URL of the LangWatch client."""
    if __instance is None:
        return os.getenv("LANGWATCH_ENDPOINT") or "https://app.langwatch.ai"
    return __instance.endpoint_url

def get_api_key() -> str:
    """Get the current API key of the LangWatch client."""
    if __instance is None:
        return os.getenv("LANGWATCH_API_KEY", "")
    return __instance.api_key

def set_api_key(api_key: str) -> None:
    """Set the current API key of the LangWatch client."""
    instance = get_instance()
    if instance is None:
        raise RuntimeError("LangWatch client has not been initialized. Call setup() first.")
    instance.api_key = api_key
