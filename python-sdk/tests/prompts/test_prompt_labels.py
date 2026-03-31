"""
Tests for custom label support in the Python SDK prompts module.

Covers:
- get() with label parameter (fetch by label)
- Cache key isolation with labels
- labels.assign() sub-resource
- version + label mutual exclusion
- MATERIALIZED_FIRST + label skips local files
- create/update with labels list
- PromptApiService.get() passes label as query parameter
"""
import json
from typing import Any, Dict
from unittest.mock import MagicMock, Mock, patch, call

import httpx
import pytest

import langwatch
from langwatch.prompts.prompt_api_service import PromptApiService
from langwatch.prompts.prompt_facade import PromptsFacade
from langwatch.prompts.types import FetchPolicy, PromptData, Message


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def _make_api_response_json(
    prompt_id: str = "pizza-prompt",
    version: int = 3,
    version_id: str = "version_v3",
    model: str = "openai/gpt-4",
) -> Dict[str, Any]:
    """Build a minimal valid JSON dict that matches the API schema."""
    return {
        "id": prompt_id,
        "handle": prompt_id,
        "scope": "PROJECT",
        "name": "Pizza Prompt",
        "updatedAt": "2024-01-01T00:00:00Z",
        "projectId": "project_1",
        "organizationId": "org_1",
        "versionId": version_id,
        "version": version,
        "createdAt": "2024-01-01T00:00:00Z",
        "prompt": "Make a pizza",
        "messages": [{"role": "system", "content": "You are a pizza chef"}],
        "inputs": [],
        "outputs": [],
        "model": model,
    }


def _mock_httpx_response(json_body: Dict[str, Any], status_code: int = 200) -> Mock:
    """Create a Mock object that mimics an httpx.Response."""
    mock_resp = Mock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = json_body
    mock_resp.content = json.dumps(json_body).encode()
    return mock_resp


def _rest_client_with_mocked_httpx(mock_request: Mock) -> Any:
    """Build a LangWatchRestApiClient whose internal httpx client uses mock_request."""
    from langwatch.generated.langwatch_rest_api_client.client import Client
    real_client = Client(base_url="https://api.langwatch.ai")
    httpx_client = real_client.get_httpx_client()
    httpx_client.request = mock_request
    return real_client


# ---------------------------------------------------------------------------
# PromptApiService.get() — label parameter
# ---------------------------------------------------------------------------


class TestPromptApiServiceGetWithLabel:
    """Tests for PromptApiService.get() with label parameter."""

    def test_passes_label_as_query_parameter(self):
        """
        Given a prompt API service
        When get() is called with label="production"
        Then the HTTP request includes label="production" in query params
        """
        api_response = _make_api_response_json(version=3, version_id="v3_id")
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        result = service.get("pizza-prompt", label="production")

        # Verify the HTTP call included label in query string
        assert mock_request.called
        call_kwargs = mock_request.call_args
        # The URL and params are passed through httpx; check the params
        url = call_kwargs[1].get("url") or call_kwargs[0][0] if call_kwargs[0] else ""
        params = call_kwargs[1].get("params", {})
        assert params.get("label") == "production"

    def test_passes_custom_label_string_as_query_parameter(self):
        """
        Given a prompt API service
        When get() is called with label="canary"
        Then the HTTP request includes label="canary" in query params
        """
        api_response = _make_api_response_json(version=2, version_id="v2_id")
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        result = service.get("pizza-prompt", label="canary")

        call_kwargs = mock_request.call_args
        params = call_kwargs[1].get("params", {})
        assert params.get("label") == "canary"

    def test_returns_correct_version_data_for_label(self):
        """
        Given "pizza-prompt" has production=v3
        When get() is called with label="production"
        Then the returned PromptData matches v3
        """
        api_response = _make_api_response_json(version=3, version_id="v3_id")
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        result = service.get("pizza-prompt", label="production")

        assert result.version == 3
        assert result.version_id == "v3_id"

    def test_no_label_fetches_latest(self):
        """
        Given "pizza-prompt" has latest=v4
        When get() is called without label
        Then the HTTP request omits the label query parameter
        """
        api_response = _make_api_response_json(version=4, version_id="v4_id")
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        result = service.get("pizza-prompt")

        call_kwargs = mock_request.call_args
        params = call_kwargs[1].get("params") or {}
        assert "label" not in params
        assert result.version == 4

    def test_propagates_error_for_unassigned_label(self):
        """
        Given "pizza-prompt" has no version assigned to "canary"
        When get() is called with label="canary"
        Then the API error is propagated
        """
        error_response = _mock_httpx_response(
            {"error": "Label not found"}, status_code=404
        )
        mock_request = Mock(return_value=error_response)
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        with pytest.raises(ValueError, match="not found"):
            service.get("pizza-prompt", label="canary")


# ---------------------------------------------------------------------------
# PromptApiService.assign_label()
# ---------------------------------------------------------------------------


class TestPromptApiServiceAssignLabel:
    """Tests for PromptApiService.assign_label()."""

    def test_calls_put_endpoint_with_correct_path_and_body(self):
        """
        Given a prompt API service
        When assign_label() is called for "pizza-prompt" version "v3_id" label "production"
        Then the HTTP request is PUT /api/prompts/pizza-prompt/labels/production
        And the body contains versionId
        """
        assign_response = {
            "configId": "config_abc",
            "versionId": "v3_id",
            "label": "production",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        }
        mock_request = Mock(return_value=_mock_httpx_response(assign_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        result = service.assign_label(
            prompt_id="pizza-prompt",
            label="production",
            version_id="v3_id",
        )

        call_kwargs = mock_request.call_args
        method = call_kwargs[1].get("method") or ""
        url = call_kwargs[1].get("url") or ""
        body = call_kwargs[1].get("json") or {}

        assert method == "put"
        assert "/api/prompts/pizza-prompt/labels/production" in url
        assert body.get("versionId") == "v3_id"

    def test_calls_put_with_custom_label_string(self):
        """
        Given a prompt API service
        When assign_label() is called with label="canary"
        Then the URL path includes "canary"
        """
        assign_response = {
            "configId": "config_abc",
            "versionId": "v3_id",
            "label": "canary",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        }
        mock_request = Mock(return_value=_mock_httpx_response(assign_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        service.assign_label(
            prompt_id="pizza-prompt",
            label="canary",
            version_id="v3_id",
        )

        call_kwargs = mock_request.call_args
        url = call_kwargs[1].get("url") or ""
        assert "/labels/canary" in url

    def test_returns_assignment_result_with_all_fields(self):
        """
        Given assign_label() succeeds
        When the API returns configId, versionId, label, updatedAt
        Then the result dict contains all four fields
        """
        assign_response = {
            "configId": "config_abc",
            "versionId": "v3_id",
            "label": "production",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        }
        mock_request = Mock(return_value=_mock_httpx_response(assign_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        result = service.assign_label(
            prompt_id="pizza-prompt",
            label="production",
            version_id="v3_id",
        )

        assert result["config_id"] == "config_abc"
        assert result["version_id"] == "v3_id"
        assert result["label"] == "production"
        assert result["updated_at"] == "2026-01-01T00:00:00.000Z"

    def test_propagates_error_on_api_failure(self):
        """
        Given the API returns a 404 error
        When assign_label() is called
        Then a ValueError is raised
        """
        error_response = _mock_httpx_response(
            {"error": "Prompt not found"}, status_code=404
        )
        mock_request = Mock(return_value=error_response)
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        with pytest.raises((ValueError, RuntimeError)):
            service.assign_label(
                prompt_id="pizza-prompt",
                label="production",
                version_id="v3_id",
            )


# ---------------------------------------------------------------------------
# PromptApiService.create() and update() with labels
# ---------------------------------------------------------------------------


class TestPromptApiServiceCreateUpdateWithLabels:
    """Tests for create() and update() with optional labels list."""

    def test_create_includes_labels_in_request_body(self):
        """
        When create() is called with labels=["production"]
        Then the API request body includes the labels list
        """
        api_response = _make_api_response_json()
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        service.create(handle="pizza-prompt", labels=["production"])

        call_kwargs = mock_request.call_args
        body = call_kwargs[1].get("json") or {}
        assert body.get("labels") == ["production"]

    def test_create_without_labels_omits_field(self):
        """
        When create() is called without labels
        Then the generated client is called and the body it receives has no labels field
        """
        from langwatch.generated.langwatch_rest_api_client.api.default import (
            post_api_prompts,
        )
        from langwatch.generated.langwatch_rest_api_client.client import Client

        real_client = Client(base_url="https://api.langwatch.ai")
        service = PromptApiService(real_client)

        mock_post_response = Mock()
        mock_post_response.parsed = Mock()
        # Satisfy PromptData.from_api_response
        mock_post_response.parsed.id = "pizza-prompt"
        mock_post_response.parsed.handle = "pizza-prompt"
        mock_post_response.parsed.model = "openai/gpt-4"
        mock_post_response.parsed.version = 1
        mock_post_response.parsed.version_id = "v1"
        mock_post_response.parsed.scope = Mock()
        mock_post_response.parsed.scope.value = "PROJECT"
        mock_post_response.parsed.prompt = None
        mock_post_response.parsed.temperature = None
        mock_post_response.parsed.max_tokens = None
        mock_post_response.parsed.response_format = None
        mock_post_response.parsed.messages = []

        with patch(
            "langwatch.prompts.prompt_api_service.post_api_prompts"
        ) as mock_module:
            mock_module.sync_detailed.return_value = mock_post_response
            with patch(
                "langwatch.prompts.prompt_api_service.unwrap_response",
                return_value=mock_post_response.parsed,
            ):
                service.create(handle="pizza-prompt")

        mock_module.sync_detailed.assert_called_once()
        body_arg = mock_module.sync_detailed.call_args[1]["body"]
        body_dict = body_arg.to_dict()
        assert "labels" not in body_dict

    def test_update_includes_labels_in_request_body(self):
        """
        When update() is called with labels=["staging"]
        Then the API request body includes the labels list
        """
        api_response = _make_api_response_json()
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)

        service = PromptApiService(rest_client)
        service.update(
            prompt_id_or_handle="pizza-prompt",
            scope="PROJECT",
            commit_message="update labels",
            labels=["staging"],
        )

        call_kwargs = mock_request.call_args
        body = call_kwargs[1].get("json") or {}
        assert body.get("labels") == ["staging"]


# ---------------------------------------------------------------------------
# PromptsFacade.get() — label parameter and mutual exclusion
# ---------------------------------------------------------------------------


class TestPromptsFacadeGetWithLabel:
    """Tests for PromptsFacade.get() with label parameter."""

    def _make_facade_with_mock(self, mock_request: Mock) -> PromptsFacade:
        rest_client = _rest_client_with_mocked_httpx(mock_request)
        return PromptsFacade(rest_client)

    def test_raises_value_error_when_both_version_and_label_provided(self):
        """
        When get() is called with both version_number=3 and label="production"
        Then a ValueError is raised before any API call
        """
        mock_request = Mock()
        facade = self._make_facade_with_mock(mock_request)

        with pytest.raises(ValueError, match="version_number.*label|label.*version_number"):
            facade.get("pizza-prompt", version_number=3, label="production")

        mock_request.assert_not_called()

    def test_fetches_from_api_with_label_parameter(self):
        """
        Given "pizza-prompt" has production=v3
        When get() is called with label="production"
        Then the API is called with label="production"
        And v3 data is returned
        """
        api_response = _make_api_response_json(version=3, version_id="v3_id")
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        facade = self._make_facade_with_mock(mock_request)

        result = facade.get("pizza-prompt", label="production", fetch_policy=FetchPolicy.ALWAYS_FETCH)

        assert result.version == 3
        call_kwargs = mock_request.call_args
        params = call_kwargs[1].get("params", {})
        assert params.get("label") == "production"

    def test_fetches_from_api_with_custom_label(self):
        """
        Given "pizza-prompt" has custom label "canary" pointing to v2
        When get() is called with label="canary"
        Then v2 data is returned
        """
        api_response = _make_api_response_json(version=2, version_id="v2_id")
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        facade = self._make_facade_with_mock(mock_request)

        result = facade.get("pizza-prompt", label="canary", fetch_policy=FetchPolicy.ALWAYS_FETCH)

        assert result.version == 2

    def test_no_label_unchanged_behavior(self):
        """
        When get() is called without label
        Then latest prompt is returned (unchanged behavior)
        """
        api_response = _make_api_response_json(version=4, version_id="v4_id")
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        facade = self._make_facade_with_mock(mock_request)

        result = facade.get("pizza-prompt", fetch_policy=FetchPolicy.ALWAYS_FETCH)

        assert result.version == 4
        call_kwargs = mock_request.call_args
        params = call_kwargs[1].get("params") or {}
        assert "label" not in params


# ---------------------------------------------------------------------------
# PromptsFacade fetch policy + label edge cases
# ---------------------------------------------------------------------------


class TestPromptsFacadeEdgeCasesWithLabel:
    """Edge cases for PromptsFacade fetch policies combined with label parameter."""

    def _make_facade_with_mock(self, mock_request: Mock) -> PromptsFacade:
        rest_client = _rest_client_with_mocked_httpx(mock_request)
        return PromptsFacade(rest_client)

    def test_materialized_only_with_label_raises_value_error(self):
        """
        When get() is called with MATERIALIZED_ONLY + label
        Then a ValueError is raised before any API call
        (labels are server-side only; MATERIALIZED_ONLY cannot resolve them)
        """
        mock_request = Mock()
        facade = self._make_facade_with_mock(mock_request)

        with pytest.raises(ValueError, match="MATERIALIZED_ONLY"):
            facade.get(
                "pizza-prompt",
                label="production",
                fetch_policy=FetchPolicy.MATERIALIZED_ONLY,
            )

        mock_request.assert_not_called()

    def test_always_fetch_with_label_and_api_failure_raises_error(self):
        """
        When get() is called with ALWAYS_FETCH + label and the API fails
        Then the error propagates (no local fallback when label is provided)
        """
        mock_request = Mock(
            return_value=_mock_httpx_response({"error": "Server error"}, status_code=500)
        )
        facade = self._make_facade_with_mock(mock_request)

        with pytest.raises(Exception):
            facade.get(
                "pizza-prompt",
                label="production",
                fetch_policy=FetchPolicy.ALWAYS_FETCH,
            )

    def test_cache_ttl_with_label_and_api_failure_raises_error(self):
        """
        When get() is called with CACHE_TTL + label and the API fails (cache miss)
        Then the error propagates (no local fallback when label is provided)
        """
        mock_request = Mock(
            return_value=_mock_httpx_response({"error": "Server error"}, status_code=500)
        )
        facade = self._make_facade_with_mock(mock_request)

        with pytest.raises(Exception):
            facade.get(
                "pizza-prompt",
                label="production",
                fetch_policy=FetchPolicy.CACHE_TTL,
            )


# ---------------------------------------------------------------------------
# MATERIALIZED_FIRST + label skips local files
# ---------------------------------------------------------------------------


class TestMaterializedFirstWithLabel:
    """Tests that label=... skips local file lookup with MATERIALIZED_FIRST."""

    def test_skips_local_file_lookup_when_label_provided(self, tmp_path):
        """
        Given "pizza-prompt" exists in materialized local files
        And the API has "pizza-prompt" with label "production" pointing to v3
        When get() is called with label="production"
        Then the SDK fetches from API, not from local files
        """
        # Create a local prompt file that would be loaded otherwise
        langwatch_dir = tmp_path / ".langwatch" / "prompts"
        langwatch_dir.mkdir(parents=True)
        (langwatch_dir / "pizza-prompt.json").write_text(
            json.dumps({
                "id": "pizza-prompt",
                "handle": "pizza-prompt",
                "model": "openai/local-model",
                "version": 99,
                "messages": [],
            })
        )

        api_response = _make_api_response_json(version=3, version_id="v3_id")
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)
        facade = PromptsFacade(rest_client, prompts_path=str(tmp_path))

        result = facade.get("pizza-prompt", label="production")

        # Should have called the API (not used local file)
        assert mock_request.called
        # Should return v3, not the local v99
        assert result.version == 3


# ---------------------------------------------------------------------------
# Cache key isolation with labels
# ---------------------------------------------------------------------------


class TestCacheKeyWithLabels:
    """Tests for cache key format when label is provided."""

    def test_cache_key_includes_label(self):
        """
        When get() is called with label="production" and CACHE_TTL
        Then the cache key includes "::label:production"
        """
        api_response = _make_api_response_json(version=3)
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)
        facade = PromptsFacade(rest_client)

        with patch("time.time", return_value=0):
            facade.get("pizza-prompt", label="production", fetch_policy=FetchPolicy.CACHE_TTL)

        assert any("::label:production" in k for k in facade._cache.keys())

    def test_cache_key_without_label_unchanged(self):
        """
        When get() is called without label and CACHE_TTL
        Then the cache key does NOT include "::label:"
        """
        api_response = _make_api_response_json(version=4)
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)
        facade = PromptsFacade(rest_client)

        with patch("time.time", return_value=0):
            facade.get("pizza-prompt", fetch_policy=FetchPolicy.CACHE_TTL)

        assert all("::label:" not in k for k in facade._cache.keys())

    def test_different_labels_cached_independently(self):
        """
        When fetching with label="production" then label="staging"
        Then both are cached under separate keys
        """
        production_resp = _make_api_response_json(version=3, version_id="v3")
        staging_resp = _make_api_response_json(version=4, version_id="v4")

        call_count = [0]

        def side_effect(**kwargs):
            params = kwargs.get("params", {})
            label = params.get("label")
            if label == "production":
                return _mock_httpx_response(production_resp)
            elif label == "staging":
                return _mock_httpx_response(staging_resp)
            return _mock_httpx_response(production_resp)

        mock_request = Mock(side_effect=lambda *args, **kwargs: side_effect(**kwargs))
        rest_client = _rest_client_with_mocked_httpx(mock_request)
        facade = PromptsFacade(rest_client)

        with patch("time.time", return_value=0):
            r1 = facade.get(
                "pizza-prompt", label="production", fetch_policy=FetchPolicy.CACHE_TTL
            )
            r2 = facade.get(
                "pizza-prompt", label="staging", fetch_policy=FetchPolicy.CACHE_TTL
            )

        production_key = next(
            k for k in facade._cache.keys() if "::label:production" in k
        )
        staging_key = next(k for k in facade._cache.keys() if "::label:staging" in k)

        assert production_key != staging_key
        assert facade._cache[production_key]["data"].version == 3
        assert facade._cache[staging_key]["data"].version == 4

    def test_label_cache_hit_does_not_call_api_again(self):
        """
        When the same label is requested twice within TTL
        Then the API is called only once
        """
        api_response = _make_api_response_json(version=3)
        mock_request = Mock(return_value=_mock_httpx_response(api_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)
        facade = PromptsFacade(rest_client)

        with patch("time.time", return_value=0):
            facade.get(
                "pizza-prompt",
                label="production",
                fetch_policy=FetchPolicy.CACHE_TTL,
                cache_ttl_minutes=5,
            )
            facade.get(
                "pizza-prompt",
                label="production",
                fetch_policy=FetchPolicy.CACHE_TTL,
                cache_ttl_minutes=5,
            )

        assert mock_request.call_count == 1


# ---------------------------------------------------------------------------
# PromptsFacade.labels.assign() sub-resource
# ---------------------------------------------------------------------------


class TestPromptsFacadeLabelsAssign:
    """Tests for the labels.assign() sub-resource on PromptsFacade."""

    def test_labels_assign_calls_api_with_correct_url_and_body(self):
        """
        When prompts.labels.assign("pizza-prompt", label="production", version_id="v3_id") is called
        Then the API receives PUT /api/prompts/pizza-prompt/labels/production
        And the body contains versionId="v3_id"
        """
        assign_response = {
            "configId": "config_abc",
            "versionId": "v3_id",
            "label": "production",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        }
        mock_request = Mock(return_value=_mock_httpx_response(assign_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)
        facade = PromptsFacade(rest_client)

        result = facade.labels.assign(
            "pizza-prompt", label="production", version_id="v3_id"
        )

        call_kwargs = mock_request.call_args
        assert call_kwargs[1].get("method") == "put"
        assert "/labels/production" in call_kwargs[1].get("url", "")
        assert call_kwargs[1].get("json", {}).get("versionId") == "v3_id"

    def test_labels_assign_returns_confirmation_with_all_fields(self):
        """
        When labels.assign() succeeds
        Then the result contains config_id, version_id, label, updated_at
        """
        assign_response = {
            "configId": "config_abc",
            "versionId": "v3_id",
            "label": "production",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        }
        mock_request = Mock(return_value=_mock_httpx_response(assign_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)
        facade = PromptsFacade(rest_client)

        result = facade.labels.assign(
            "pizza-prompt", label="production", version_id="v3_id"
        )

        assert result["config_id"] == "config_abc"
        assert result["version_id"] == "v3_id"
        assert result["label"] == "production"
        assert result["updated_at"] == "2026-01-01T00:00:00.000Z"

    def test_labels_assign_works_with_custom_label(self):
        """
        When labels.assign() is called with label="canary"
        Then the URL path includes "canary"
        """
        assign_response = {
            "configId": "config_abc",
            "versionId": "v3_id",
            "label": "canary",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        }
        mock_request = Mock(return_value=_mock_httpx_response(assign_response))
        rest_client = _rest_client_with_mocked_httpx(mock_request)
        facade = PromptsFacade(rest_client)

        facade.labels.assign("pizza-prompt", label="canary", version_id="v3_id")

        call_kwargs = mock_request.call_args
        assert "/labels/canary" in call_kwargs[1].get("url", "")


# ---------------------------------------------------------------------------
# Integration with langwatch.prompts (global interface)
# ---------------------------------------------------------------------------


class TestLangwatchPromptsGlobalInterface:
    """Tests that langwatch.prompts exposes the labels sub-resource."""

    def test_langwatch_prompts_has_labels_attribute(self, clean_langwatch):
        """langwatch.prompts.labels exists and has an assign method."""
        assert hasattr(langwatch.prompts, "labels")
        assert callable(getattr(langwatch.prompts.labels, "assign", None))
