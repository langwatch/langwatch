from typing import Optional, Protocol
from opentelemetry.sdk.trace import TracerProvider

class Instrumentor(Protocol):
    """Protocol defining the interface for instrumentors in LangWatch.
    
    Instrumentors are responsible for setting up OpenTelemetry instrumentation
    for specific libraries or frameworks.
    """

    def instrument(self, tracer_provider: Optional[TracerProvider] = None) -> None:
        """Instrument the target library/framework with OpenTelemetry.
        
        Args:
            tracer_provider: Optional TracerProvider to use for instrumentation.
                           If None, the global TracerProvider will be used.
        """
        ...
