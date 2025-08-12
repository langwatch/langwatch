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

import factory
from datetime import datetime

# Import actual API response types
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200 import (
    PostApiPromptsResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200_messages_item import (
    PostApiPromptsResponse200MessagesItem,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200_messages_item_role import (
    PostApiPromptsResponse200MessagesItemRole,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200_scope import (
    PostApiPromptsResponse200Scope,
)


class GetPromptResponseFactory(factory.Factory):
    """Simple factory for creating GetPrompt API response fixtures."""

    class Meta:
        model = PostApiPromptsResponse200

    # Simple defaults
    id = factory.Sequence(lambda n: f"prompt_{n}")
    handle = None
    scope = PostApiPromptsResponse200Scope.PROJECT
    name = "Test Prompt"
    updated_at = factory.LazyFunction(lambda: datetime.now().isoformat() + "Z")
    project_id = factory.Sequence(lambda n: f"project_{n}")
    organization_id = factory.Sequence(lambda n: f"org_{n}")
    version = 1.0
    version_id = factory.Sequence(lambda n: f"version_{n}")
    version_created_at = factory.LazyFunction(lambda: datetime.now().isoformat() + "Z")
    model = "gpt-4"
    prompt = "Hello {{ name }}!"
    response_format = None

    # Provide default messages as a factory attribute instead of post_generation
    messages = factory.LazyAttribute(
        lambda obj: [
            PostApiPromptsResponse200MessagesItem(
                role=PostApiPromptsResponse200MessagesItemRole.USER,
                content="Say {{ greeting }} to {{ name }}",
            ),
            PostApiPromptsResponse200MessagesItem(
                role=PostApiPromptsResponse200MessagesItemRole.ASSISTANT,
                content="{{ greeting }}, {{ name }}!",
            ),
        ]
    )
