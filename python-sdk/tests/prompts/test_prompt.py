import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import Mock

import pytest
from langwatch.prompts.prompt import Prompt, PromptCompilationError
from langwatch.prompts.types import PromptData
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
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200_scope import (
    PostApiPromptsResponse200Scope,
)


# Fixtures are now centralized in tests/conftest.py


def test_prompt_delegates_config_attributes(prompt: Prompt, prompt_data):
    """Test that Prompt has the expected attributes from PromptData"""
    # Test that key attributes are accessible on the Prompt instance
    assert prompt.id == prompt_data.id
    assert prompt.model == prompt_data.model
    assert prompt.version == prompt_data.version
    assert prompt.handle == prompt_data.handle
    assert prompt.messages == prompt_data.messages

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


def test_from_api_response_extracts_response_format_json_schema():
    """
    GIVEN an API response with a response_format containing json_schema
    WHEN PromptData.from_api_response() is called
    THEN it extracts the json_schema from the response_format object
    """
    mock_response = Mock()
    mock_response.id = "prompt_1"
    mock_response.handle = "my-prompt"
    mock_response.model = "openai/gpt-4"
    mock_response.version_id = "v1"
    mock_response.version = 1
    mock_response.scope = PostApiPromptsResponse200Scope.PROJECT
    mock_response.prompt = "Test"
    mock_response.temperature = None
    mock_response.max_tokens = None
    mock_response.messages = []

    # Simulate the API response_format structure
    mock_json_schema = {"name": "my_schema", "schema": {"type": "object", "properties": {"answer": {"type": "string"}}}}
    mock_response.response_format = Mock()
    mock_response.response_format.json_schema = mock_json_schema

    result = PromptData.from_api_response(mock_response)

    assert result.response_format is not None
    assert result.response_format.type == "json_schema"
    assert result.response_format.json_schema == mock_json_schema
    assert result.response_format.json_schema["name"] == "my_schema"


def test_from_api_response_handles_none_response_format():
    """
    GIVEN an API response with response_format=None
    WHEN PromptData.from_api_response() is called
    THEN response_format is None
    """
    mock_response = Mock()
    mock_response.id = "prompt_1"
    mock_response.handle = "my-prompt"
    mock_response.model = "openai/gpt-4"
    mock_response.version_id = "v1"
    mock_response.version = 1
    mock_response.scope = PostApiPromptsResponse200Scope.PROJECT
    mock_response.prompt = "Test"
    mock_response.temperature = None
    mock_response.max_tokens = None
    mock_response.messages = []
    mock_response.response_format = None

    result = PromptData.from_api_response(mock_response)

    assert result.response_format is None
