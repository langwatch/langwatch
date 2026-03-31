from functools import wraps
from opentelemetry import trace
from typing import TYPE_CHECKING, Literal, Optional, TypeVar, Callable
import json

from langwatch.attributes import AttributeKey

if TYPE_CHECKING:
    from langwatch.prompts.prompt import Prompt

T = TypeVar("T")


class PromptServiceTracing:
    """Namespace for PromptService method tracing decorators"""

    @staticmethod
    def get(func: Callable[..., "Prompt"]) -> Callable[..., "Prompt"]:
        """
        Type-safe decorator for PromptService.get method with OpenTelemetry tracing

        Expected function signature:
        def get(self: T, prompt_id: str, version_number: Optional[int] = None,
                label: Optional[Literal["production", "staging"]] = None) -> PromptData
        """

        @wraps(func)
        def wrapper(
            self: T,
            prompt_id: str,
            version_number: Optional[int] = None,
            label: Optional[Literal["production", "staging"]] = None,
        ) -> "Prompt":
            with trace.get_tracer(__name__).start_as_current_span(
                PromptServiceTracing._create_span_name("get")
            ) as span:
                variables_dict: dict[str, str] = {"prompt_id": prompt_id}
                if label is not None:
                    variables_dict["label"] = label
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
                    result = func(self, prompt_id, version_number, label=label)

                    # Only emit combined format when both handle and version are available
                    if result.handle is not None and result.version is not None:
                        span.set_attribute(
                            AttributeKey.LangWatchPromptId,
                            f"{result.handle}:{result.version}",
                        )
                    return result
                except Exception as ex:
                    span.record_exception(ex)
                    raise

        return wrapper

    @staticmethod
    def _create_span_name(span_name: str) -> str:
        """Create a span name for the prompt"""
        return "PromptApiService" + "." + span_name


prompt_service_tracing = PromptServiceTracing()
