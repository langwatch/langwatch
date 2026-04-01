"""
Tests for PromptService.get tracing functionality.
"""

import json
from unittest.mock import Mock
import pytest
from langwatch.prompts.prompt_api_service import PromptApiService
from langwatch.attributes import AttributeKey

from fixtures.span_exporter import MockSpanExporter, span_exporter

pytestmark = pytest.mark.unit


def _make_api_json(handle="prompt_123", version=1):
    """Build a valid API response JSON dict."""
    return {
        "id": handle or "prompt_123",
        "handle": handle,
        "scope": "PROJECT",
        "name": "Test",
        "updatedAt": "2024-01-01T00:00:00Z",
        "projectId": "p1",
        "organizationId": "o1",
        "versionId": "v1",
        "version": version,
        "createdAt": "2024-01-01T00:00:00Z",
        "prompt": "test",
        "messages": [],
        "inputs": [],
        "outputs": [],
        "model": "openai/gpt-4",
    }


def _mock_httpx_response(json_body):
    """Create a Mock httpx 200 response."""
    stub = Mock()
    stub.status_code = 200
    stub.json.return_value = json_body
    stub.content = json.dumps(json_body).encode()
    return stub


def _rest_client_with_mock_request(mock_request):
    """Build a LangWatchRestApiClient whose httpx client uses mock_request."""
    from langwatch.generated.langwatch_rest_api_client.client import Client
    real_client = Client(base_url="https://api.langwatch.ai")
    real_client.get_httpx_client().request = mock_request
    return real_client


def test_get_method_emits_combined_format_when_handle_and_version_present(
    span_exporter: MockSpanExporter,
):
    """Test that PromptService.get emits combined 'handle:version' format"""
    api_json = _make_api_json(handle="prompt_123", version=1)
    mock_request = Mock(return_value=_mock_httpx_response(api_json))
    rest_client = _rest_client_with_mock_request(mock_request)
    service = PromptApiService(rest_client)

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
    span_exporter: MockSpanExporter,
):
    """Test that PromptService.get emits no prompt id when handle is None"""
    api_json = _make_api_json(handle=None, version=1)
    mock_request = Mock(return_value=_mock_httpx_response(api_json))
    rest_client = _rest_client_with_mock_request(mock_request)
    service = PromptApiService(rest_client)

    service.get("prompt_123")

    span = span_exporter.find_span_by_name("PromptApiService.get")
    assert span is not None

    assert span.attributes is not None
    # No prompt id attribute should be set
    assert span.attributes.get(AttributeKey.LangWatchPromptId) is None
    assert span.attributes.get(AttributeKey.LangWatchPromptHandle) is None
    assert span.attributes.get(AttributeKey.LangWatchPromptVersionId) is None


def test_get_method_emits_nothing_when_version_missing(
    span_exporter: MockSpanExporter,
):
    """Test that PromptService.get emits no prompt id when version is None"""
    api_json = _make_api_json(handle="prompt_123", version=None)
    mock_request = Mock(return_value=_mock_httpx_response(api_json))
    rest_client = _rest_client_with_mock_request(mock_request)
    service = PromptApiService(rest_client)

    service.get("prompt_123")

    span = span_exporter.find_span_by_name("PromptApiService.get")
    assert span is not None

    assert span.attributes is not None
    # No prompt id attribute should be set
    assert span.attributes.get(AttributeKey.LangWatchPromptId) is None
    assert span.attributes.get(AttributeKey.LangWatchPromptHandle) is None
    assert span.attributes.get(AttributeKey.LangWatchPromptVersionId) is None
