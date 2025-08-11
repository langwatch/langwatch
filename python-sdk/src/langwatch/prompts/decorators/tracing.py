from functools import wraps
from opentelemetry import trace
from typing import TYPE_CHECKING, TypeVar, Callable, Any

if TYPE_CHECKING:
    from langwatch.prompts.prompt import Prompt

T = TypeVar("T")


class PromptServiceTracing:
    """Namespace for PromptService method tracing decorators"""

    @staticmethod
    def get(func: Callable[[T, str], "Prompt"]) -> Callable[[T, str], "Prompt"]:
        """Type-safe decorator for PromptService.get method with OpenTelemetry tracing"""

        @wraps(func)
        def wrapper(self: T, prompt_id: str) -> "Prompt":
            with trace.get_tracer(__name__).start_as_current_span("prompt.get") as span:
                span.set_attributes({"langwatch.prompt.type": "prompt"})
                span.set_attribute("langwatch.prompt.id", prompt_id)

                try:
                    result = func(self, prompt_id)
                    span.set_attribute("langwatch.prompt.version.id", result.version_id)
                    return result
                except Exception as ex:
                    span.record_exception(ex)
                    raise

        return wrapper

    @staticmethod
    def create(func: Callable[..., "Prompt"]) -> Callable[..., "Prompt"]:
        """Decorator for PromptService.create method with OpenTelemetry tracing"""

        @wraps(func)
        def wrapper(self: Any, handle: str, *args: Any, **kwargs: Any) -> "Prompt":
            with trace.get_tracer(__name__).start_as_current_span(
                "prompt.create"
            ) as span:
                span.set_attributes({"langwatch.prompt.type": "prompt"})
                span.set_attribute("langwatch.prompt.handle", handle)

                try:
                    result = func(self, handle, *args, **kwargs)
                    span.set_attribute("langwatch.prompt.id", result.id)
                    return result
                except Exception as ex:
                    span.record_exception(ex)
                    raise

        return wrapper


prompt_service_tracing = PromptServiceTracing()
