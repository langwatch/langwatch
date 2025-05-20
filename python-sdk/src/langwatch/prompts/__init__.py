from .formatter import PromptFormatter, MissingPromptVariableError
from .prompt import Prompt
from typing import Any, Dict, Optional
from opentelemetry import trace
from ..langwatch_api_client import Client
from ..langwatch_api_client.api.default import get_api_prompts_by_id
from langwatch.telemetry.context import get_current_span
from langwatch.attributes import AttributeKey
from langwatch.state import get_instance


tracer = trace.get_tracer(__name__)

def get_prompt(prompt_id: str, version_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetches a prompt config and formats it with the provided variables.
    Returns a dict ready for OpenAI's client.
    Raises MissingPromptVariableError if required variables are missing.
    """
    with tracer.start_as_current_span("get_prompt") as span:
        span.set_attribute("inputs.prompt_id", prompt_id)
        span.set_attribute("inputs.version_id", version_id) if version_id else None

        try:
            client = get_instance()
            api_client = client.api_client
            prompt_config = get_api_prompts_by_id.sync(client=api_client, id=prompt_id)
            prompt = Prompt(prompt_config)

            span.set_attributes(
                {
                    AttributeKey.LangWatchPromptId: prompt.id,
                    AttributeKey.LangWatchPromptVersionId: prompt.version_id,
                    AttributeKey.LangWatchPromptVersionNumber: prompt.version_number,
                }
            )
        except Exception as ex:
            span.record_exception(ex)
            raise ex

        return prompt

__all__ = ["get_prompt", "MissingPromptVariableError"] 