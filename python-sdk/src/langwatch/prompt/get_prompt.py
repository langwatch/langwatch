from .prompt import Prompt
from typing import Optional
from opentelemetry import trace
from langwatch.generated.langwatch_rest_api_client.api.default import get_api_prompts_by_id
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_400 import GetApiPromptsByIdResponse400
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_401 import GetApiPromptsByIdResponse401
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_404 import GetApiPromptsByIdResponse404
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_500 import GetApiPromptsByIdResponse500

from langwatch.attributes import AttributeKey
from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance

tracer = trace.get_tracer(__name__)


def get_prompt(prompt_id: str, version_id: Optional[str] = None) -> Prompt:
    """
    Fetches and returns a Prompt object for the given prompt ID and version ID.

    Args:
        prompt_id: The ID of the prompt to fetch
        version_id: Optional version ID to fetch a specific version

    Returns:
        Prompt: A configured Prompt object

    Raises:
        Exception: If there's an error fetching or configuring the prompt
    """
    _setup()

    with tracer.start_as_current_span("get_prompt") as span:
        span.set_attribute("inputs.prompt_id", prompt_id)
        if version_id:
            span.set_attribute("inputs.version_id", version_id)

        try:
            client = get_instance()
            response = get_api_prompts_by_id.sync_detailed(
                id=prompt_id,
                client=client.rest_api_client,
            )

            if isinstance(response.parsed, GetApiPromptsByIdResponse404):
                raise Exception(response.parsed.error)
            elif isinstance(response.parsed, GetApiPromptsByIdResponse400):
                raise Exception(response.parsed.error)
            elif isinstance(response.parsed, GetApiPromptsByIdResponse401):
                raise Exception(response.parsed.error)
            elif isinstance(response.parsed, GetApiPromptsByIdResponse500):
                raise Exception(response.parsed.error)
            elif isinstance(response.parsed, GetApiPromptsByIdResponse200):
                prompt = Prompt(response.parsed)
                _set_prompt_attributes(span, prompt)
                return prompt
            else:
                raise Exception(f"Unknown response type: {type(response.parsed)}")

        except Exception as ex:
            span.record_exception(ex)
            raise

async def async_get_prompt(prompt_id: str, version_id: Optional[str] = None) -> Prompt:
    """
    Async version of get_prompt.

    Args:
        prompt_id: The ID of the prompt to fetch
        version_id: Optional version ID to fetch a specific version

    Returns:
        Prompt: A configured Prompt object

    Raises:
        Exception: If there's an error fetching or configuring the prompt
        ValueError: If the prompt is not found (404) or invalid request (400)
        RuntimeError: If there's an authentication error (401) or server error (500)
    """
    _setup()

    with tracer.start_as_current_span("async_get_prompt") as span:
        span.set_attribute("inputs.prompt_id", prompt_id)
        if version_id:
            span.set_attribute("inputs.version_id", version_id)

        try:
            client = get_instance()
            response = await get_api_prompts_by_id.asyncio(
                client=client.rest_api_client,
                id=prompt_id
            )
            prompt = _handle_response(response, prompt_id)
            _set_prompt_attributes(span, prompt)
            return prompt

        except Exception as ex:
            span.record_exception(ex)
            raise

def _setup():
    """
    Ensure LangWatch client is setup.

    If no client is setup, this will create a default client using environment variables.
    Validates that we have a working tracer provider to prevent silent failures.
    """
    ensure_setup()

def _handle_response(response, prompt_id: str) -> Prompt:
    """
    Handle API response and return Prompt object.

    Args:
        response: API response object
        prompt_id: ID of the prompt being fetched

    Returns:
        Prompt: Configured Prompt object

    Raises:
        ValueError: For 404 or 400 status codes
        RuntimeError: For 401, 500 or other non-200 status codes
    """
    if response.status_code == 404:
        raise ValueError(f"Prompt with ID {prompt_id} not found. Response: {response.parsed}")
    elif response.status_code == 400:
        raise ValueError(f"Invalid request for prompt ID {prompt_id}. Response: {response.parsed}")
    elif response.status_code == 401:
        raise RuntimeError(f"Authentication error - please check your API key. Response: {response.parsed}")
    elif response.status_code == 500:
        raise RuntimeError(f"Server error occurred while fetching prompt. Response: {response.parsed}")
    elif response.status_code != 200:
        raise RuntimeError(f"Unexpected status code: {response.status_code}. Response: {response.parsed}")

    return Prompt(response.parsed)

def _set_prompt_attributes(span, prompt: Prompt):
    """Set prompt attributes on span."""
    span.set_attributes({
        AttributeKey.LangWatchPromptId: prompt.id,
        AttributeKey.LangWatchPromptVersionId: prompt.version_id,
        AttributeKey.LangWatchPromptVersionNumber: prompt.version_number,
    })