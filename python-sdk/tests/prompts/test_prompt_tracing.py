"""
Simple test for PromptService.get tracing functionality.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from langwatch.prompts.prompt import Prompt
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from fixtures import GetPromptResponseFactory
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200_messages_item import (
    GetApiPromptsByIdResponse200MessagesItem,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200_messages_item_role import (
    GetApiPromptsByIdResponse200MessagesItemRole,
)
from langwatch.attributes import AttributeKey
from fixtures.span_exporter import MockSpanExporter, span_exporter


@pytest.fixture
def mock_config() -> GetApiPromptsByIdResponse200:
    """Type-safe configuration object from actual API response types"""
    return GetPromptResponseFactory(
        id="prompt_123",
        version=1.0,  # Use float instead of string for proper typing
        prompt="Hello {{ name }}!",
        handle="prompt_123",
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


def test_prompt_compile_creates_trace_span(
    span_exporter: MockSpanExporter, prompt: Prompt
):
    """Test that Prompt.compile creates a trace span"""
    prompt.compile(name="Alice")

    # Verify span was created
    span = span_exporter.find_span_by_name("Prompt.compile")
    assert span is not None

    # Type assertion for linter
    assert span.attributes is not None
    assert span.attributes.get(AttributeKey.LangWatchPromptId) == prompt.id
    assert span.attributes.get(AttributeKey.LangWatchPromptHandle) == prompt.handle
    assert (
        span.attributes.get(AttributeKey.LangWatchPromptVersionId) == prompt.version_id
    )


def test_prompt_compile_strict_creates_trace_span(
    span_exporter: MockSpanExporter, prompt: Prompt
):
    """Test that Prompt.compile_strict creates a trace span"""
    prompt.compile_strict(name="Alice", greeting="Hello")

    # Verify span was created
    span = span_exporter.find_span_by_name("Prompt.compile_strict")
    assert span is not None

    # Type assertion for linter
    assert span.attributes is not None
    assert span.attributes.get(AttributeKey.LangWatchPromptId) == prompt.id
    assert span.attributes.get(AttributeKey.LangWatchPromptHandle) == prompt.handle
    assert (
        span.attributes.get(AttributeKey.LangWatchPromptVersionId) == prompt.version_id
    )


def test_prompt_compile_captures_input_variables(
    span_exporter: MockSpanExporter, prompt: Prompt
):
    """Test that Prompt.compile captures input variables when automatic capture is enabled"""
    prompt.compile(name="Alice")

    # Verify span was created
    span = span_exporter.find_span_by_name("Prompt.compile")
    assert span is not None

    # Type assertion for linter
    assert span.attributes is not None

    # Check that input variables were captured
    variables_attr = span.attributes.get(AttributeKey.LangWatchPromptVariables)
    assert variables_attr is not None

    import json

    variables = json.loads(str(variables_attr))
    assert variables["type"] == "json"
    assert variables["value"] == {"name": "Alice"}


def test_prompt_compile_strict_captures_input_variables(
    span_exporter: MockSpanExporter, prompt: Prompt
):
    """Test that Prompt.compile_strict captures input variables when automatic capture is enabled"""
    prompt.compile_strict(name="Alice", greeting="Hello")

    # Verify span was created
    span = span_exporter.find_span_by_name("Prompt.compile_strict")
    assert span is not None

    # Type assertion for linter
    assert span.attributes is not None

    # Check that input variables were captured
    variables_attr = span.attributes.get(AttributeKey.LangWatchPromptVariables)
    assert variables_attr is not None

    import json

    variables = json.loads(str(variables_attr))
    assert variables["type"] == "json"
    assert variables["value"] == {"name": "Alice", "greeting": "Hello"}
