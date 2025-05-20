from .formatter import PromptFormatter, MissingPromptVariableError
from .prompt import Prompt
from typing import Any, Dict, Optional
from ..langwatch_api_client import Client
from ..langwatch_api_client.api.default import get_api_prompts_by_id
from langwatch.telemetry.context import get_current_span
from langwatch.attributes import AttributeKey


client = Client(
    base_url="https://app.langwatch.ai",
    # httpx_args={"event_hooks": {"request": [log_request], "response": [log_response]}},
    headers={"X-Auth-Token": "sk-lw-nWN8d7mRUPVZ9kuPqOGjKlpdWEmjReGA41DKkDYO0zLJNPOe"}
)
def get_prompt(prompt_id: str, version_id: Optional[str] = None, **variables: Any) -> Dict[str, Any]:
    """
    Fetches a prompt config and formats it with the provided variables.
    Returns a dict ready for OpenAI's client.
    Raises MissingPromptVariableError if required variables are missing.
    """
    prompt_config = get_api_prompts_by_id.sync(client=client, id=prompt_id)
    prompt = Prompt(prompt_config)
    _track_prompt_event(prompt_id=prompt.id, version_id=prompt.version_number)
    return prompt


def _track_prompt_event(prompt_id: str, version_id: int) -> None:
    """
    Private method to track prompt events in the current span.
    
    Args:
        prompt_id: The ID of the prompt being tracked
        version_id: Optional version ID of the prompt
    """
    try:
        span = get_current_span()
        if span:
            span.add_event(
                AttributeKey.LangWatchEventFetchPrompt,
                {
                    "prompt_id": prompt_id,
                    "version_number": version_id,
                }
            )
    except:
        # Silently fail if we can't track the prompt
        pass

__all__ = ["get_prompt", "MissingPromptVariableError"] 