from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider, Tracer
from typing import Optional, Callable, Any, TypeVar, Dict
import contextvars

stored_tracer = contextvars.ContextVar('stored_langwatch_tracer')

__all__ = ["trace"]

T = TypeVar("T", bound=Callable[..., Any])

class Trace:
    def __init__(
        self,
        instrumenting_module_name: str,
        instrumenting_library_version: Optional[str] = None,
        tracer_provider: Optional[TracerProvider] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[Dict[str, Any]] = None
    ) -> None:
        self.instrumenting_module_name = instrumenting_module_name
        self.instrumenting_library_version = instrumenting_library_version
        self.tracer_provider = tracer_provider
        self.schema_url = schema_url
        self.attributes = attributes

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        tracer = trace_api.get_tracer(
            instrumenting_module_name=self.instrumenting_module_name,
            instrumenting_library_version=self.instrumenting_library_version,
            tracer_provider=self.tracer_provider,
            schema_url=self.schema_url,
            attributes=self.attributes,
        )

        if len(args) == 1 and callable(args[0]) and not kwargs:
            with set_tracer_value(tracer):
                func: Callable[..., Any] = args[0]
                def wrapper(*wargs: Any, **wkwargs: Any) -> Any:
                    result = func(*wargs, **wkwargs)
                    return result

                return wrapper  # type: ignore

        return tracer

    def __enter__(self) -> "Trace":
        return self

    def __exit__(self, exc_type: Optional[type], exc_value: Optional[BaseException], traceback: Any) -> bool:
        return False

def trace(
    instrumenting_module_name: Optional[str] = None,
    instrumenting_library_version: Optional[str] = None,
    tracer_provider: Optional[TracerProvider] = None,
    schema_url: Optional[str] = None,
    attributes: Optional[Dict[str, Any]] = None
) -> Trace:
    return Trace(
        instrumenting_module_name=instrumenting_module_name or "langwatch.tracer",
        instrumenting_library_version=instrumenting_library_version,
        tracer_provider=tracer_provider,
        schema_url=schema_url,
        attributes=attributes
    )

# TODO(afr): Add error handling here based on the previous library's contexter
class set_tracer_value:
    tracer: Optional[Tracer] = None
    token: Optional[contextvars.Token] = None

    def __init__(self, tracer: Tracer):
        self.tracer = tracer

    def __enter__(self):
        self.token = stored_tracer.set(self.tracer)
        return self.tracer

    def __exit__(self, exc_type, exc_value, traceback):
        stored_tracer.reset(self.token)
