from functools import wraps
from opentelemetry import trace
from typing import TYPE_CHECKING, TypeVar, Callable, Any
import json

from langwatch.attributes import AttributeKey

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
                    PromptTracing._create_span_name(span_name)
                ) as span:
                    # Set base prompt
                    span.set_attributes(
                        {
                            AttributeKey.LangWatchPromptId: self.id,
                            AttributeKey.LangWatchPromptHandle: self.handle,
                            AttributeKey.LangWatchPromptVersionId: self.version_id,
                            AttributeKey.LangWatchPromptVersionNumber: self.version,
                        }
                    )

                    # Create variables dict from args and kwargs
                    variables_dict: dict[str, Any] = {}
                    if args and args[0] is not None:
                        variables_dict.update(args[0])
                    variables_dict.update(kwargs)

                    span.set_attribute(
                        AttributeKey.LangWatchPromptVariables,
                        json.dumps(
                            {
                                "type": "json",
                                "value": variables_dict,
                            }
                        ),
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

    @staticmethod
    def _create_span_name(span_name: str) -> str:
        """Create a span name for the prompt"""
        return "Prompt" + "." + span_name


prompt_tracing = PromptTracing()
