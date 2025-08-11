from functools import wraps
from opentelemetry import trace
from typing import TYPE_CHECKING, TypeVar, Callable

if TYPE_CHECKING:
    from langwatch.prompts.prompt import Prompt, CompiledPrompt

T = TypeVar("T")


class PromptTracing:
    """Namespace for Prompt method tracing decorators"""

    @staticmethod
    def compile(
        func: Callable[..., "CompiledPrompt"]
    ) -> Callable[..., "CompiledPrompt"]:
        """Decorator for Prompt.compile method with OpenTelemetry tracing"""

        @wraps(func)
        def wrapper(self: "Prompt", *args, **kwargs) -> "CompiledPrompt":
            with trace.get_tracer(__name__).start_as_current_span("compile") as span:
                span.set_attributes({"langwatch.prompt.type": "prompt"})
                span.set_attribute("langwatch.prompt.id", self._config.id)
                span.set_attribute(
                    "langwatch.prompt.version.id", self._config.version_id
                )
                span.set_attribute(
                    "langwatch.prompt.version.number", int(self._config.version)
                )

                try:
                    result = func(self, *args, **kwargs)
                    return result
                except Exception as ex:
                    span.record_exception(ex)
                    raise

        return wrapper


prompt_tracing = PromptTracing()
