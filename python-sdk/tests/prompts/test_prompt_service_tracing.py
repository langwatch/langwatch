"""
Tests for PromptService.get tracing functionality.
"""

import json
from unittest.mock import Mock, patch
import pytest
from langwatch.prompts.prompt_api_service import PromptApiService
from langwatch.attributes import AttributeKey

from fixtures.span_exporter import MockSpanExporter, span_exporter


def _stub_httpx_response() -> Mock:
    """Build a stub httpx response that bypasses from_dict parsing.

    Uses status_code=204 so the ``if httpx_response.status_code == 200``
    guard in get() skips GetApiPromptsByIdResponse200.from_dict, allowing
    the patched unwrap_response to control the parsed result.
    """
    stub = Mock()
    stub.status_code = 204
    stub.content = b""
    stub.headers = {}
    stub.json.return_value = {}
    return stub


def _rest_client_with_mock_request(mock_request: Mock):
    """Build a LangWatchRestApiClient whose httpx client uses mock_request."""
    from langwatch.generated.langwatch_rest_api_client.client import Client
    real_client = Client(base_url="https://api.langwatch.ai")
    real_client.get_httpx_client().request = mock_request
    return real_client


def test_get_method_emits_combined_format_when_handle_and_version_present(
    span_exporter: MockSpanExporter, mock_api_response_for_tracing
):
    """Test that PromptService.get emits combined 'handle:version' format"""
    mock_request = Mock(return_value=_stub_httpx_response())
    rest_client = _rest_client_with_mock_request(mock_request)
    service = PromptApiService(rest_client)

    with patch(
        "langwatch.prompts.prompt_api_service.unwrap_response",
        return_value=mock_api_response_for_tracing,
    ):
        service.get("prompt_123")

    span = span_exporter.find_span_by_name("PromptApiService.get")
    assert span is not None

    assert span.attributes is not None
    # Combined format: "handle:version"
    assert span.attributes.get(AttributeKey.LangWatchPromptId) == "prompt_123:1"
    # Old separate attributes should NOT be present
    assert span.attributes.get(AttributeKey.LangWatchPromptHandle) is None
    assert span.attributes.get(AttributeKey.LangWatchPromptVersionId) is None


def test_get_method_emits_nothing_when_handle_missing(
    span_exporter: MockSpanExporter, mock_api_response_for_tracing
):
    """Test that PromptService.get emits no prompt id when handle is None"""
    # Override handle to None to trigger emit-nothing behavior
    mock_api_response_for_tracing.handle = None

    mock_request = Mock(return_value=_stub_httpx_response())
    rest_client = _rest_client_with_mock_request(mock_request)
    service = PromptApiService(rest_client)

    with patch(
        "langwatch.prompts.prompt_api_service.unwrap_response",
        return_value=mock_api_response_for_tracing,
    ):
        service.get("prompt_123")

    span = span_exporter.find_span_by_name("PromptApiService.get")
    assert span is not None

    assert span.attributes is not None
    # No prompt id attribute should be set
    assert span.attributes.get(AttributeKey.LangWatchPromptId) is None
    assert span.attributes.get(AttributeKey.LangWatchPromptHandle) is None
    assert span.attributes.get(AttributeKey.LangWatchPromptVersionId) is None


def test_get_method_emits_nothing_when_version_missing(
    span_exporter: MockSpanExporter, mock_api_response_for_tracing
):
    """Test that PromptService.get emits no prompt id when version is None"""
    # Override version to None to trigger emit-nothing behavior
    mock_api_response_for_tracing.version = None

    mock_request = Mock(return_value=_stub_httpx_response())
    rest_client = _rest_client_with_mock_request(mock_request)
    service = PromptApiService(rest_client)

    with patch(
        "langwatch.prompts.prompt_api_service.unwrap_response",
        return_value=mock_api_response_for_tracing,
    ):
        service.get("prompt_123")

    span = span_exporter.find_span_by_name("PromptApiService.get")
    assert span is not None

    assert span.attributes is not None
    # No prompt id attribute should be set
    assert span.attributes.get(AttributeKey.LangWatchPromptId) is None
    assert span.attributes.get(AttributeKey.LangWatchPromptHandle) is None
    assert span.attributes.get(AttributeKey.LangWatchPromptVersionId) is None
