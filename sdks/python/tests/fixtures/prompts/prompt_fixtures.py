"""Prompt-specific test fixtures."""

import pytest
from unittest.mock import Mock

from langwatch.prompts.prompt import Prompt
from langwatch.prompts.types import PromptData
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200_scope import (
    PostApiPromptsResponse200Scope,
)
from ..get_response_factories import GetPromptResponseFactory


@pytest.fixture
def mock_config():
    """Create a mock API response using the existing factory"""
    return GetPromptResponseFactory()


@pytest.fixture
def prompt_data(mock_config):
    """Create PromptData from mock API response"""
    return PromptData.from_api_response(mock_config)


@pytest.fixture
def prompt(prompt_data):
    """Create a Prompt instance from PromptData"""
    return Prompt(prompt_data)


@pytest.fixture
def mock_api_response_for_tracing():
    """Create a properly structured mock for API service tracing tests"""
    mock_response = Mock()
    mock_response.id = "prompt_123"
    mock_response.handle = "prompt_123"
    mock_response.model = "openai/gpt-4"
    mock_response.version_id = "prompt_version_3"
    mock_response.version = 1
    mock_response.scope = PostApiPromptsResponse200Scope.PROJECT
    mock_response.prompt = "Test prompt"
    mock_response.temperature = 0.7
    mock_response.max_tokens = None
    mock_response.response_format = None

    # Mock messages as an iterable
    mock_msg = Mock()
    mock_msg.role.value = "system"
    mock_msg.content = "You are helpful"
    mock_response.messages = [mock_msg]

    return mock_response
