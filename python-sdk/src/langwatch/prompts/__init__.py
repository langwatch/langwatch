from .formatter import PromptFormatter, MissingPromptVariableError
from typing import Any, Dict, Optional
from lang_watch_api_client import Client
from lang_watch_api_client.api.default import get_api_prompts_by_id


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
    formatter = PromptFormatter()
    prompt_config = get_api_prompts_by_id.sync(client=client, id=prompt_id)
    
    # Convert the response object to a dict
    prompt_dict = {
        "id": prompt_config.id,
        "name": prompt_config.name,
        "model": prompt_config.model,
        "messages": [
            {
                "role": msg.role,
                "content": formatter.format(msg.content, variables)
            }
            for msg in prompt_config.messages
        ]
    }
    
    return prompt_dict

__all__ = ["get_prompt", "MissingPromptVariableError"] 