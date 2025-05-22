from .formatter import PromptFormatter, MissingPromptVariableError
from .prompt import Prompt
from typing import Optional
from opentelemetry import trace
from langwatch.generated.langwatch_rest_api_client.api.default import get_api_prompts_by_id
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
            prompt_config = get_api_prompts_by_id.sync(
                client=client.rest_api_client,
                id=prompt_id
            )
            prompt = Prompt(prompt_config)

            span.set_attributes({
                AttributeKey.LangWatchPromptId: prompt.id,
                AttributeKey.LangWatchPromptVersionId: prompt.version_id,
                AttributeKey.LangWatchPromptVersionNumber: prompt.version_number,
            })

            return prompt

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
    """
    _setup()

    with tracer.start_as_current_span("async_get_prompt") as span:
        span.set_attribute("inputs.prompt_id", prompt_id)
        if version_id:
            span.set_attribute("inputs.version_id", version_id)

        try:
            client = get_instance()
            prompt_config = await get_api_prompts_by_id.asyncio(
                client=client.rest_api_client,
                id=prompt_id
            )
            prompt = Prompt(prompt_config)

            span.set_attributes({
                AttributeKey.LangWatchPromptId: prompt.id,
                AttributeKey.LangWatchPromptVersionId: prompt.version_id,
                AttributeKey.LangWatchPromptVersionNumber: prompt.version_number,
            })

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