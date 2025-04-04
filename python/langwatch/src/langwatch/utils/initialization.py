"""Utility module for handling LangWatch initialization."""

from typing import Dict, Optional, Sequence
from opentelemetry.sdk.trace import TracerProvider

from langwatch.state import get_instance, set_instance
from langwatch.client import Client
from langwatch.types import BaseAttributes
from langwatch.typings import Instrumentor

def setup(
    api_key: Optional[str] = None,
    endpoint_url: Optional[str] = None,
    base_attributes: Optional[BaseAttributes] = None,
    tracer_provider: Optional[TracerProvider] = None,
    instrumentors: Optional[Sequence[Instrumentor]] = None,
) -> Client:
    """Initialize the LangWatch client."""
    client = Client(
        api_key=api_key,
        endpoint_url=endpoint_url,
        base_attributes=base_attributes,
        tracer_provider=tracer_provider,
        instrumentors=instrumentors,
    )
    set_instance(client)
    return client

def ensure_setup() -> None:
    """Ensure LangWatch client is setup.
    
    If no client is setup, this will create a default client using environment variables.
    """

    if get_instance() is None:
        setup()
