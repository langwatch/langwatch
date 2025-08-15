from functools import wraps
from opentelemetry import trace
from typing import TYPE_CHECKING, TypeVar, Callable, Any
import json

from langwatch.attributes import AttributeKey

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
            with trace.get_tracer(__name__).start_as_current_span(
                PromptServiceTracing._create_span_name("get")
            ) as span:
                variables_dict: dict[str, Any] = {"prompt_id": prompt_id}
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
                    result = func(self, prompt_id)

                    span.set_attributes(
                        {
                            AttributeKey.LangWatchPromptId: result.id,
                            AttributeKey.LangWatchPromptVersionId: result.version_id,
                            AttributeKey.LangWatchPromptHandle: result.handle,
                        }
                    )
                    return result
                except Exception as ex:
                    span.record_exception(ex)
                    raise

        return wrapper

    @staticmethod
    def _create_span_name(span_name: str) -> str:
        """Create a span name for the prompt"""
        return "PromptService" + "." + span_name


prompt_service_tracing = PromptServiceTracing()
