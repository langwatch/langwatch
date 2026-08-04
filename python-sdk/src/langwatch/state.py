"""Module for storing global state."""

import os
from typing import Optional
from .types import LangWatchClientProtocol

DEFAULT_ENDPOINT = "https://app.langwatch.ai"

# Singleton instance of the client
__instance: Optional[LangWatchClientProtocol] = None

def get_instance() -> Optional[LangWatchClientProtocol]:
    """Get the current LangWatch client instance."""
    return __instance

def set_instance(client: LangWatchClientProtocol) -> None:
    """Set the current LangWatch client instance."""
    global __instance
    __instance = client

def normalize_endpoint(endpoint: str) -> str:
    """Trim surrounding whitespace and drop any trailing slashes.

    Request URLs are built by appending paths that already carry a leading
    slash, so an endpoint written as ``https://app.langwatch.ai/`` would
    produce ``https://app.langwatch.ai//api/experiment/init``. The router does
    not match that, and the caller gets an opaque 404 with nothing pointing at
    the endpoint as the cause.
    """
    return endpoint.strip().rstrip("/")


def get_endpoint() -> str:
    """Get the current endpoint URL of the LangWatch client."""
    if __instance is None:
        return normalize_endpoint(os.getenv("LANGWATCH_ENDPOINT") or "") or DEFAULT_ENDPOINT
    return normalize_endpoint(__instance.endpoint_url) or DEFAULT_ENDPOINT

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
