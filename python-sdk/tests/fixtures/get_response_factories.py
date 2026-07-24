"""
Simple factory for creating GetPrompt API response fixtures.

Usage:
    # Basic usage with defaults
    response = GetPromptResponseFactory()

    # Custom attributes
    response = GetPromptResponseFactory(
        id="custom_prompt_123",
        version=2.0,
        prompt="Hello {{ user }}!"
    )
"""

from datetime import datetime

from factory.base import Factory
from factory.declarations import Sequence, LazyFunction

# Import actual API response types
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200_messages_item import (
    GetApiPromptsByIdResponse200MessagesItem,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200_scope import (
    PostApiPromptsResponse200Scope,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200_messages_item_role import (
    GetApiPromptsByIdResponse200MessagesItemRole,
)


class GetPromptResponseFactory(Factory[GetApiPromptsByIdResponse200]):
    """Simple factory for creating GetPrompt API response fixtures."""

    class Meta:
        model = GetApiPromptsByIdResponse200

    # Simple defaults
    id = Sequence(lambda n: f"prompt_{n}")
    handle = None
    scope = PostApiPromptsResponse200Scope.PROJECT
    name = "Test Prompt"
    updated_at = LazyFunction(lambda: datetime.now().isoformat() + "Z")
    project_id = Sequence(lambda n: f"project_{n}")
    organization_id = Sequence(lambda n: f"org_{n}")
    version = 1.0
    version_id = Sequence(lambda n: f"version_{n}")
    model = "gpt-4"
    prompt = "Hello {{ name }}!"
    response_format = None
    author_id = None
    created_at = LazyFunction(lambda: datetime.now().isoformat() + "Z")
    inputs = []
    outputs = []

    # Provide default messages as a factory attribute instead of post_generation
    messages = [
        GetApiPromptsByIdResponse200MessagesItem(
            role=GetApiPromptsByIdResponse200MessagesItemRole.SYSTEM,
            content="You are a helpful assistant",
        ),
        GetApiPromptsByIdResponse200MessagesItem(
            role=GetApiPromptsByIdResponse200MessagesItemRole.ASSISTANT,
            content="{{ greeting }}, {{ name }}!",
        ),
    ]
