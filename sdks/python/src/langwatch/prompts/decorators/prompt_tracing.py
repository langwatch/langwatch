from functools import wraps
from opentelemetry import trace
from opentelemetry.trace import Span
from typing import TYPE_CHECKING, TypeVar, Callable, Any, Optional, Union, Dict
import json

from langwatch.attributes import AttributeKey

if TYPE_CHECKING:
    from langwatch.prompts.prompt import Prompt, CompiledPrompt

T = TypeVar("T", bound="Prompt")


def _set_attribute_if_not_none(
    span: Span, key: str, value: Optional[Union[str, int, float, bool]]
) -> None:
    """Set span attribute only if value is not None."""
    if value is not None:
        span.set_attribute(key, value)


class PromptTracing:
    """Namespace for Prompt method tracing decorators"""

    @staticmethod
    def _set_prompt_attributes(span: Span, prompt: "Prompt") -> None:
        """Set prompt-related attributes on the span."""
        _set_attribute_if_not_none(
            span, AttributeKey.LangWatchPromptId, getattr(prompt, "id", None)
        )
        _set_attribute_if_not_none(
            span, AttributeKey.LangWatchPromptHandle, getattr(prompt, "handle", None)
        )
        _set_attribute_if_not_none(
            span,
            AttributeKey.LangWatchPromptVersionId,
            getattr(prompt, "version_id", None),
        )
        _set_attribute_if_not_none(
            span,
            AttributeKey.LangWatchPromptVersionNumber,
            getattr(prompt, "version", None),
        )

    @staticmethod
    def _create_compile_decorator(
        span_name: str,
    ) -> Callable[[Callable[..., "CompiledPrompt"]], Callable[..., "CompiledPrompt"]]:
        """Internal method to create compile decorators with specified span name"""

        def decorator(
            func: Callable[..., "CompiledPrompt"],
        ) -> Callable[..., "CompiledPrompt"]:
            @wraps(func)
            def wrapper(self: "Prompt", *args: Any, **kwargs: Any) -> "CompiledPrompt":
                with trace.get_tracer(__name__).start_as_current_span(
                    PromptTracing._create_span_name(span_name)
                ) as span:
                    # Set prompt attributes
                    PromptTracing._set_prompt_attributes(span, self)

                    # Create variables dict from args and kwargs
                    variables_dict: Dict[str, Any] = {}
                    if args:
                        first_arg = args[0]
                        if first_arg is not None and hasattr(first_arg, "update"):
                            variables_dict.update(first_arg)
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
        func: Callable[..., "CompiledPrompt"],
    ) -> Callable[..., "CompiledPrompt"]:
        """Decorator for Prompt.compile method with OpenTelemetry tracing"""
        return PromptTracing._create_compile_decorator("compile")(func)

    @staticmethod
    def compile_strict(
        func: Callable[..., "CompiledPrompt"],
    ) -> Callable[..., "CompiledPrompt"]:
        """Decorator for Prompt.compile_strict method with OpenTelemetry tracing"""
        return PromptTracing._create_compile_decorator("compile_strict")(func)

    @staticmethod
    def _create_span_name(span_name: str) -> str:
        """Create a span name for the prompt"""
        return f"Prompt.{span_name}"


prompt_tracing = PromptTracing()
