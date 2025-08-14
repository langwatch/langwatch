import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from langwatch.prompts.prompt import Prompt, PromptCompilationError
from fixtures import GetPromptResponseFactory
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200_messages_item import (
    GetApiPromptsByIdResponse200MessagesItem,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200_messages_item_role import (
    GetApiPromptsByIdResponse200MessagesItemRole,
)


@pytest.fixture
def mock_config():
    """Type-safe configuration object from actual API response types"""
    return GetPromptResponseFactory(
        id="prompt_123",
        version=1.0,  # Use float instead of string for proper typing
        prompt="Hello {{ name }}!",
        messages=[
            GetApiPromptsByIdResponse200MessagesItem(
                role=GetApiPromptsByIdResponse200MessagesItemRole.USER,
                content="Say {{ greeting }} to {{ name }}",
            ),
        ],
    )


@pytest.fixture
def prompt(mock_config: GetApiPromptsByIdResponse200) -> Prompt:
    """Create a Prompt instance with factory-generated config"""
    return Prompt(mock_config)


def test_prompt_delegates_config_attributes(
    prompt: Prompt, mock_config: GetApiPromptsByIdResponse200
):
    """Test that Prompt delegates attribute access to config"""
    # Test all config attributes are properly delegated
    for attr in [
        "id",
        "scope",
        "version",
        "prompt",
        "messages",
        "name",
        "updated_at",
        "project_id",
        "organization_id",
        "version_id",
        "version_created_at",
        "model",
        "response_format",
        "handle",
    ]:
        if hasattr(mock_config, attr):
            assert getattr(prompt, attr) == getattr(mock_config, attr)


def test_compile_with_variables(prompt: Prompt):
    """Test compile method with variables"""
    variables = {"name": "World", "greeting": "Hello"}
    compiled = prompt.compile(variables)

    assert compiled is not None
    assert hasattr(compiled, "original")
    assert compiled.original == prompt
    assert compiled.prompt == "Hello World!"
    assert len(compiled.messages) == 1
    assert compiled.messages[0]["role"] == "user"
    assert compiled.messages[0]["content"] == "Say Hello to World"


def test_compile_without_variables(prompt: Prompt):
    """Test compile method without variables (lenient mode)"""
    compiled = prompt.compile()
    assert compiled is not None


def test_compile_strict_with_valid_variables(prompt: Prompt):
    """Test compile_strict with all required variables"""
    variables = {"name": "World", "greeting": "Hello"}
    compiled = prompt.compile_strict(variables)
    assert compiled is not None
    assert compiled.prompt == "Hello World!"
    assert len(compiled.messages) == 1
    assert compiled.messages[0]["role"] == "user"
    assert compiled.messages[0]["content"] == "Say Hello to World"


def test_compile_strict_with_missing_variables(prompt: Prompt):
    """Test compile_strict raises error with missing variables"""
    variables = {"name": "World"}  # missing 'greeting'

    with pytest.raises(PromptCompilationError):
        prompt.compile_strict(variables)


def test_prompt_attribute_error(prompt: Prompt):
    """Test that accessing non-existent attributes raises AttributeError"""
    with pytest.raises(AttributeError):
        _ = prompt.nonexistent_attribute
