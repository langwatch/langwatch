from typing import Dict, Any, Optional, Sequence

from .client import Client
from .typings import Instrumentor
from .open_telemetry.tracer import trace
from .open_telemetry.span import span

from opentelemetry.sdk.trace import TracerProvider

# Singleton instance of the client
__instance: Optional[Client] = None

def setup(
    api_key: Optional[str] = None,
    endpoint_url: Optional[str] = None,
    base_attributes: Optional[Dict[str, Any]] = None,
    tracer_provider: Optional[TracerProvider] = None,
    instrumentors: Optional[Sequence[Instrumentor]] = None,
):
    __instance = Client(
        api_key=api_key,
        endpoint_url=endpoint_url,
        base_attributes=base_attributes,
        tracer_provider=tracer_provider,
        instrumentors=instrumentors,
    )
    
    return __instance

__all__ = ["setup", "trace", "span"]
