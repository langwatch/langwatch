from .formatter import PromptFormatter, MissingPromptVariableError
from .prompt import Prompt
from typing import Any, Dict, Optional
from ..langwatch_api_client import Client
from ..langwatch_api_client.api.default import get_api_prompts_by_id


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
    
    return prompt

__all__ = ["get_prompt", "MissingPromptVariableError"] 