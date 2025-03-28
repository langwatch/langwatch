from typing import Dict, Optional, Sequence

from .client import Client
from .typings import Instrumentor
from .observability.tracing import trace
from .observability.span import span
from .state import set_instance, get_endpoint
from .types import BaseAttributes
from .__version__ import __version__

from opentelemetry.sdk.trace import TracerProvider

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

# Export the endpoint getter function
endpoint = get_endpoint

__all__ = [
    "setup",
    "trace",
    "span",
    "endpoint",
    "login",
    "__version__",
]
