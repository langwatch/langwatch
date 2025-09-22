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


# Fixtures are now centralized in tests/conftest.py


def test_prompt_delegates_config_attributes(prompt: Prompt, prompt_data):
    """Test that Prompt has the expected attributes from PromptData"""
    # Test that key attributes are accessible on the Prompt instance
    assert prompt.id == prompt_data["id"]
    assert prompt.model == prompt_data["model"]
    assert prompt.version == prompt_data["version"]
    assert prompt.handle == prompt_data["handle"]
    assert prompt.messages == prompt_data["messages"]

    # Test that the raw data is accessible
    assert prompt.raw == prompt_data


def test_compile_with_variables(prompt: Prompt):
    """Test compile method with variables"""
    variables = {"name": "World", "greeting": "Hello"}
    compiled = prompt.compile(variables)

    assert compiled is not None
    assert hasattr(compiled, "original")
    assert compiled.original == prompt
    assert compiled.prompt == "Hello World!"  # Compiled with variables
    assert len(compiled.messages) == 2  # Factory creates system + assistant messages
    # Check message roles and that variables were compiled in the assistant message
    assert compiled.messages[0]["role"] == "system"
    assert compiled.messages[0]["content"] == "You are a helpful assistant"
    assert compiled.messages[1]["role"] == "assistant"
    assert compiled.messages[1]["content"] == "Hello, World!"


def test_compile_without_variables(prompt: Prompt):
    """Test compile method without variables (lenient mode)"""
    compiled = prompt.compile()
    assert compiled is not None


def test_compile_strict_with_valid_variables(prompt: Prompt):
    """Test compile_strict with all required variables"""
    variables = {"name": "World", "greeting": "Hello"}
    compiled = prompt.compile_strict(variables)
    assert compiled is not None
    assert compiled.prompt == "Hello World!"  # Compiled with variables
    assert len(compiled.messages) == 2  # Factory creates system + assistant messages
    # Check that variables were compiled in the assistant message
    assert compiled.messages[1]["content"] == "Hello, World!"


def test_compile_strict_with_missing_variables(prompt: Prompt):
    """Test compile_strict raises error with missing variables"""
    variables = {"name": "World"}  # missing 'greeting'

    with pytest.raises(PromptCompilationError):
        prompt.compile_strict(variables)


def test_prompt_attribute_error(prompt: Prompt):
    """Test that accessing non-existent attributes raises AttributeError"""
    with pytest.raises(AttributeError):
        _ = prompt.nonexistent_attribute
