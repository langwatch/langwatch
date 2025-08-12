from functools import wraps
from opentelemetry import trace
from typing import TYPE_CHECKING, TypeVar, Callable, Any

if TYPE_CHECKING:
    from langwatch.prompts.prompt import Prompt, CompiledPrompt

T = TypeVar("T", bound="Prompt")


class PromptTracing:
    """Namespace for Prompt method tracing decorators"""

    @staticmethod
    def _create_compile_decorator(
        span_name: str,
    ) -> Callable[[Callable[..., "CompiledPrompt"]], Callable[..., "CompiledPrompt"]]:
        """Internal method to create compile decorators with specified span name"""

        def decorator(
            func: Callable[..., "CompiledPrompt"]
        ) -> Callable[..., "CompiledPrompt"]:
            @wraps(func)
            def wrapper(self: "Prompt", *args: Any, **kwargs: Any) -> "CompiledPrompt":
                with trace.get_tracer(__name__).start_as_current_span(
                    span_name
                ) as span:
                    span.set_attributes({"langwatch.prompt.type": "prompt"})
                    span.set_attribute("langwatch.prompt.id", self.id)
                    span.set_attribute("langwatch.prompt.version.id", self.version_id)
                    span.set_attribute(
                        "langwatch.prompt.version.number", int(self.version)
                    )

                    try:
                        result = func(self, *args, **kwargs)
                        return result
                    except Exception as ex:
                        span.record_exception(ex)
                        raise

            return wrapper

        return decorator

    @staticmethod
    def compile(
        func: Callable[..., "CompiledPrompt"]
    ) -> Callable[..., "CompiledPrompt"]:
        """Decorator for Prompt.compile method with OpenTelemetry tracing"""
        return PromptTracing._create_compile_decorator("compile")(func)

    @staticmethod
    def compile_strict(
        func: Callable[..., "CompiledPrompt"]
    ) -> Callable[..., "CompiledPrompt"]:
        """Decorator for Prompt.compile_strict method with OpenTelemetry tracing"""
        return PromptTracing._create_compile_decorator("compile_strict")(func)


prompt_tracing = PromptTracing()
