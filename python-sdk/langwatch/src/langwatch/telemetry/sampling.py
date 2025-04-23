import opentelemetry.trace as trace_api

__all__ = ["sampling_rate"]

from typing import Any, Callable, TypeVar


T = TypeVar("T", bound=Callable[..., Any])

class SamplingRateDescriptor:
    """Property descriptor for getting the sampling rate from the root tracer provider."""

    def __get__(self, obj, objtype=None) -> float:
        """Get the sampling rate from the root OpenTelemetry tracer provider.

        Returns:
            The sampling rate as a float between 0 and 1. Returns 1.0 if:
            - No tracer provider is set
            - The tracer provider doesn't have a sampler
            - The tracer provider is a NoOpTracerProvider
            - The sampling rate cannot be determined
        """
        tracer_provider = trace_api.get_tracer_provider()
        if not tracer_provider or isinstance(tracer_provider, trace_api.NoOpTracerProvider):
            return 1.0
            
        try:
            # Access the sampler from the tracer provider
            sampler = tracer_provider.sampler
            if hasattr(sampler, 'rate'):
                return float(sampler.rate)
            elif hasattr(sampler, 'sampling_rate'):
                return float(sampler.sampling_rate)
            return 1.0
        except Exception:
            return 1.0

sampling_rate = SamplingRateDescriptor()
