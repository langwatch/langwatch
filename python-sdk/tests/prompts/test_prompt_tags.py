"""
Tests for tag support in the Python SDK prompts module.

Covers:
- get() with tag parameter (fetch by tag)
- Cache key isolation with tags
- tags.assign() sub-resource
- MATERIALIZED_FIRST + tag skips local files
- create/update with tags list
- PromptApiService.get() passes tag as query parameter
- Backward-compatible labels alias
"""
import json
from unittest.mock import Mock, patch

import pytest

import langwatch
from langwatch.prompts.prompt_api_service import PromptApiService
from langwatch.prompts.prompt_facade import PromptsFacade
from langwatch.prompts.types import FetchPolicy

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------


def _make_api_response_200(
    prompt_id: str = "pizza-prompt",
    version: int = 3,
    version_id: str = "version_v3",
    model: str = "openai/gpt-4",
):
    """Build a mock parsed GetApiPromptsByIdResponse200 object."""
    from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
        GetApiPromptsByIdResponse200,
    )

    return GetApiPromptsByIdResponse200.from_dict({
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
    })


def _mock_sync_detailed_response(parsed, status_code=200):
    """Create a mock Response object wrapping a parsed model."""
    from http import HTTPStatus
    from langwatch.generated.langwatch_rest_api_client.types import Response

    return Response(
        status_code=HTTPStatus(status_code),
        content=json.dumps({}).encode() if parsed else b"",
        headers={},
        parsed=parsed,
    )


# ---------------------------------------------------------------------------
# PromptApiService.get() -- tag parameter
# ---------------------------------------------------------------------------


class TestPromptApiServiceGetWithTag:
    """Tests for PromptApiService.get() with tag parameter."""

    def test_passes_tag_as_query_parameter(self):
        """
        Given a prompt API service
        When get() is called with tag="production"
        Then get_api_prompts_by_id.sync_detailed is called with tag="production"
        """
        parsed = _make_api_response_200(version=3, version_id="v3_id")
        mock_resp = _mock_sync_detailed_response(parsed)

        with patch(
            "langwatch.prompts.prompt_api_service.get_api_prompts_by_id"
        ) as mock_module:
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            service.get("pizza-prompt", tag="production")

            mock_module.sync_detailed.assert_called_once()
            call_kwargs = mock_module.sync_detailed.call_args[1]
            assert call_kwargs.get("tag") == "production"

    def test_passes_custom_tag_string(self):
        """
        Given a prompt API service
        When get() is called with tag="canary"
        Then the generated client is called with tag="canary"
        """
        parsed = _make_api_response_200(version=2, version_id="v2_id")
        mock_resp = _mock_sync_detailed_response(parsed)

        with patch(
            "langwatch.prompts.prompt_api_service.get_api_prompts_by_id"
        ) as mock_module:
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            service.get("pizza-prompt", tag="canary")

            call_kwargs = mock_module.sync_detailed.call_args[1]
            assert call_kwargs.get("tag") == "canary"

    def test_returns_correct_version_data_for_tag(self):
        """
        Given "pizza-prompt" has production=v3
        When get() is called with tag="production"
        Then the returned PromptData matches v3
        """
        parsed = _make_api_response_200(version=3, version_id="v3_id")
        mock_resp = _mock_sync_detailed_response(parsed)

        with patch(
            "langwatch.prompts.prompt_api_service.get_api_prompts_by_id"
        ) as mock_module:
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            result = service.get("pizza-prompt", tag="production")

            assert result.version == 3
            assert result.version_id == "v3_id"

    def test_no_tag_uses_unset(self):
        """
        Given "pizza-prompt" has latest=v4
        When get() is called without tag
        Then tag is passed as UNSET to the generated client
        """
        from langwatch.generated.langwatch_rest_api_client.types import UNSET

        parsed = _make_api_response_200(version=4, version_id="v4_id")
        mock_resp = _mock_sync_detailed_response(parsed)

        with patch(
            "langwatch.prompts.prompt_api_service.get_api_prompts_by_id"
        ) as mock_module:
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            result = service.get("pizza-prompt")

            call_kwargs = mock_module.sync_detailed.call_args[1]
            assert call_kwargs.get("tag") is UNSET
            assert result.version == 4

    def test_propagates_error_for_unassigned_tag(self):
        """
        Given "pizza-prompt" has no version assigned to "canary"
        When get() is called with tag="canary"
        Then the API error is propagated
        """
        from http import HTTPStatus
        from langwatch.generated.langwatch_rest_api_client.types import Response
        from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_404 import (
            GetApiPromptsByIdResponse404,
        )

        parsed_404 = GetApiPromptsByIdResponse404.from_dict({"error": "Not found"})
        mock_resp = Response(
            status_code=HTTPStatus(404),
            content=json.dumps({"error": "Not found"}).encode(),
            headers={},
            parsed=parsed_404,
        )

        with patch(
            "langwatch.prompts.prompt_api_service.get_api_prompts_by_id"
        ) as mock_module:
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            with pytest.raises(ValueError, match="not found"):
                service.get("pizza-prompt", tag="canary")


# ---------------------------------------------------------------------------
# PromptApiService.assign_tag()
# ---------------------------------------------------------------------------


class TestPromptApiServiceAssignTag:
    """Tests for PromptApiService.assign_tag()."""

    def test_calls_generated_client_with_correct_params(self):
        """
        Given a prompt API service
        When assign_tag() is called for "pizza-prompt" version "v3_id" tag "production"
        Then put_api_prompts_by_id_labels_by_label.sync_detailed is called correctly
        """
        from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_labels_by_label_response_200 import (
            PutApiPromptsByIdLabelsByLabelResponse200,
        )

        parsed = PutApiPromptsByIdLabelsByLabelResponse200(
            config_id="config_abc",
            version_id="v3_id",
            updated_at="2026-01-01T00:00:00.000Z",
            tag="production",
        )
        mock_resp = _mock_sync_detailed_response(parsed)

        with patch(
            "langwatch.prompts.prompt_api_service.put_api_prompts_by_id_labels_by_label"
        ) as mock_module:
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            service.assign_tag(
                prompt_id="pizza-prompt",
                tag="production",
                version_id="v3_id",
            )

            mock_module.sync_detailed.assert_called_once()
            call_kwargs = mock_module.sync_detailed.call_args[1]
            assert call_kwargs.get("tag") == "production"
            body = call_kwargs.get("body")
            assert body.version_id == "v3_id"

    def test_calls_with_custom_tag(self):
        """
        Given a prompt API service
        When assign_tag() is called with tag="canary"
        Then the generated client is called with tag="canary"
        """
        from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_labels_by_label_response_200 import (
            PutApiPromptsByIdLabelsByLabelResponse200,
        )

        parsed = PutApiPromptsByIdLabelsByLabelResponse200(
            config_id="config_abc",
            version_id="v3_id",
            updated_at="2026-01-01T00:00:00.000Z",
            tag="canary",
        )
        mock_resp = _mock_sync_detailed_response(parsed)

        with patch(
            "langwatch.prompts.prompt_api_service.put_api_prompts_by_id_labels_by_label"
        ) as mock_module:
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            service.assign_tag(
                prompt_id="pizza-prompt",
                tag="canary",
                version_id="v3_id",
            )

            call_kwargs = mock_module.sync_detailed.call_args[1]
            assert call_kwargs.get("tag") == "canary"

    def test_returns_assignment_result_with_all_fields(self):
        """
        Given assign_tag() succeeds
        When the API returns configId, versionId, tag, updatedAt
        Then the result dict contains all four fields
        """
        from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_labels_by_label_response_200 import (
            PutApiPromptsByIdLabelsByLabelResponse200,
        )

        parsed = PutApiPromptsByIdLabelsByLabelResponse200(
            config_id="config_abc",
            version_id="v3_id",
            updated_at="2026-01-01T00:00:00.000Z",
            tag="production",
        )
        mock_resp = _mock_sync_detailed_response(parsed)

        with patch(
            "langwatch.prompts.prompt_api_service.put_api_prompts_by_id_labels_by_label"
        ) as mock_module:
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            result = service.assign_tag(
                prompt_id="pizza-prompt",
                tag="production",
                version_id="v3_id",
            )

            assert result["configId"] == "config_abc"
            assert result["versionId"] == "v3_id"
            assert result["tag"] == "production"
            assert result["updatedAt"] == "2026-01-01T00:00:00.000Z"

    def test_propagates_error_on_api_failure(self):
        """
        Given the API returns a 404 error
        When assign_tag() is called
        Then a ValueError is raised
        """
        from http import HTTPStatus
        from langwatch.generated.langwatch_rest_api_client.types import Response
        from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_labels_by_label_response_404 import (
            PutApiPromptsByIdLabelsByLabelResponse404,
        )

        parsed_404 = PutApiPromptsByIdLabelsByLabelResponse404.from_dict(
            {"error": "Prompt not found"}
        )
        mock_resp = Response(
            status_code=HTTPStatus(404),
            content=json.dumps({"error": "Prompt not found"}).encode(),
            headers={},
            parsed=parsed_404,
        )

        with patch(
            "langwatch.prompts.prompt_api_service.put_api_prompts_by_id_labels_by_label"
        ) as mock_module:
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            with pytest.raises(ValueError):
                service.assign_tag(
                    prompt_id="pizza-prompt",
                    tag="production",
                    version_id="v3_id",
                )


# ---------------------------------------------------------------------------
# PromptApiService.create() and update() with tags
# ---------------------------------------------------------------------------


class TestPromptApiServiceCreateUpdateWithTags:
    """Tests for create() and update() with optional tags list."""

    def test_create_includes_tags_in_request_body(self):
        """
        When create() is called with tags=["production"]
        Then the PostApiPromptsBody has tags=["production"]
        """
        parsed = _make_api_response_200()
        mock_resp = _mock_sync_detailed_response(parsed)

        # Need to patch both post_api_prompts and unwrap_response
        with patch(
            "langwatch.prompts.prompt_api_service.post_api_prompts"
        ) as mock_module, patch(
            "langwatch.prompts.prompt_api_service.unwrap_response",
            return_value=parsed,
        ):
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            service.create(handle="pizza-prompt", tags=["production"])

            mock_module.sync_detailed.assert_called_once()
            body_arg = mock_module.sync_detailed.call_args[1]["body"]
            assert body_arg.tags == ["production"]

    def test_create_without_tags_uses_unset(self):
        """
        When create() is called without tags
        Then the PostApiPromptsBody tags field is UNSET
        """
        from langwatch.generated.langwatch_rest_api_client.types import UNSET

        parsed = _make_api_response_200()
        mock_resp = _mock_sync_detailed_response(parsed)

        with patch(
            "langwatch.prompts.prompt_api_service.post_api_prompts"
        ) as mock_module, patch(
            "langwatch.prompts.prompt_api_service.unwrap_response",
            return_value=parsed,
        ):
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            service.create(handle="pizza-prompt")

            body_arg = mock_module.sync_detailed.call_args[1]["body"]
            assert body_arg.tags is UNSET

    def test_update_includes_tags_in_request_body(self):
        """
        When update() is called with tags=["staging"]
        Then the PutApiPromptsByIdBody has tags=["staging"]
        """
        parsed = _make_api_response_200()
        mock_resp = _mock_sync_detailed_response(parsed)

        with patch(
            "langwatch.prompts.prompt_api_service.put_api_prompts_by_id"
        ) as mock_module, patch(
            "langwatch.prompts.prompt_api_service.unwrap_response",
            return_value=parsed,
        ):
            mock_module.sync_detailed.return_value = mock_resp
            client = Mock()
            service = PromptApiService(client)
            service.update(
                prompt_id_or_handle="pizza-prompt",
                scope="PROJECT",
                commit_message="update tags",
                tags=["staging"],
            )

            body_arg = mock_module.sync_detailed.call_args[1]["body"]
            assert body_arg.tags == ["staging"]


# ---------------------------------------------------------------------------
# PromptsFacade.get() -- tag parameter
# ---------------------------------------------------------------------------


class TestPromptsFacadeGetWithTag:
    """Tests for PromptsFacade.get() with tag parameter."""

    def _make_facade_with_mock_api(self) -> PromptsFacade:
        mock_client = Mock()
        return PromptsFacade(mock_client)

    def test_passes_tag_through_to_api_service(self):
        """
        When get() is called with tag="production"
        Then the API service is called with tag="production"
        """
        from langwatch.prompts.types import PromptData, Message

        facade = self._make_facade_with_mock_api()
        mock_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=3, version_id="v3_id", model="openai/gpt-4",
            messages=[Message(role="system", content="v3")], prompt="v3",
        )
        facade._api_service.get = Mock(return_value=mock_data)

        result = facade.get("pizza-prompt", tag="production", fetch_policy=FetchPolicy.ALWAYS_FETCH)

        assert result.version == 3
        facade._api_service.get.assert_called_once_with(
            "pizza-prompt", None, tag="production"
        )

    def test_passes_full_string_through_as_prompt_id(self):
        """
        When get() is called with "pizza-prompt:production" (no explicit tag)
        Then "pizza-prompt:production" is passed as the full prompt_id to the API
        (no client-side parsing)
        """
        from langwatch.prompts.types import PromptData, Message

        facade = self._make_facade_with_mock_api()
        mock_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=3, version_id="v3_id", model="openai/gpt-4",
            messages=[Message(role="system", content="v3")], prompt="v3",
        )
        facade._api_service.get = Mock(return_value=mock_data)

        facade.get("pizza-prompt:production", fetch_policy=FetchPolicy.ALWAYS_FETCH)

        # The full string is passed through, not split
        facade._api_service.get.assert_called_once_with(
            "pizza-prompt:production", None, tag=None
        )

    def test_no_tag_unchanged_behavior(self):
        """
        When get() is called without tag
        Then latest prompt is returned (unchanged behavior)
        """
        from langwatch.prompts.types import PromptData, Message

        facade = self._make_facade_with_mock_api()
        mock_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=4, version_id="v4_id", model="openai/gpt-4",
            messages=[Message(role="system", content="v4")], prompt="v4",
        )
        facade._api_service.get = Mock(return_value=mock_data)

        result = facade.get("pizza-prompt", fetch_policy=FetchPolicy.ALWAYS_FETCH)

        assert result.version == 4
        facade._api_service.get.assert_called_once_with(
            "pizza-prompt", None, tag=None
        )


# ---------------------------------------------------------------------------
# MATERIALIZED_FIRST + tag skips local files
# ---------------------------------------------------------------------------


class TestMaterializedFirstWithTag:
    """Tests that tag=... skips local file lookup with MATERIALIZED_FIRST."""

    def test_skips_local_file_lookup_when_tag_provided(self):
        """
        Given "pizza-prompt" exists in materialized local files
        And the API has "pizza-prompt" with tag "production" pointing to v3
        When get() is called with tag="production"
        Then the SDK fetches from API, not from local files
        """
        from langwatch.prompts.types import PromptData, Message

        mock_client = Mock()
        facade = PromptsFacade(mock_client)

        mock_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=3, version_id="v3_id", model="openai/gpt-4",
            messages=[Message(role="system", content="v3")], prompt="v3",
        )
        facade._api_service.get = Mock(return_value=mock_data)
        facade._local_loader.load_prompt = Mock(return_value=None)

        result = facade.get("pizza-prompt", tag="production")

        # Should have called the API
        facade._api_service.get.assert_called_once()
        # Should NOT have tried local loader
        facade._local_loader.load_prompt.assert_not_called()
        assert result.version == 3


# ---------------------------------------------------------------------------
# Cache key isolation with tags
# ---------------------------------------------------------------------------


class TestCacheKeyWithTags:
    """Tests for cache key format when tag is provided."""

    def _make_facade_with_mock_api(self):
        mock_client = Mock()
        return PromptsFacade(mock_client)

    def test_cache_key_includes_tag(self):
        """
        When get() is called with tag="production" and CACHE_TTL
        Then the cache key includes "::tag:production"
        """
        from langwatch.prompts.types import PromptData, Message

        facade = self._make_facade_with_mock_api()
        mock_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=3, version_id="v3_id", model="openai/gpt-4",
            messages=[Message(role="system", content="v3")], prompt="v3",
        )
        facade._api_service.get = Mock(return_value=mock_data)

        with patch("time.time", return_value=0):
            facade.get("pizza-prompt", tag="production", fetch_policy=FetchPolicy.CACHE_TTL)

        assert any("::tag:production" in k for k in facade._cache.keys())

    def test_cache_key_without_tag_has_empty_tag_segment(self):
        """
        When get() is called without tag and CACHE_TTL
        Then the cache key has an empty tag segment (::tag:)
        """
        from langwatch.prompts.types import PromptData, Message

        facade = self._make_facade_with_mock_api()
        mock_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=4, version_id="v4_id", model="openai/gpt-4",
            messages=[Message(role="system", content="v4")], prompt="v4",
        )
        facade._api_service.get = Mock(return_value=mock_data)

        with patch("time.time", return_value=0):
            facade.get("pizza-prompt", fetch_policy=FetchPolicy.CACHE_TTL)

        keys = list(facade._cache.keys())
        assert len(keys) == 1
        assert keys[0].endswith("::tag:")

    def test_different_tags_cached_independently(self):
        """
        When fetching with tag="production" then tag="staging"
        Then both are cached under separate keys
        """
        from langwatch.prompts.types import PromptData, Message

        facade = self._make_facade_with_mock_api()

        v3_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=3, version_id="v3_id", model="openai/gpt-4",
            messages=[Message(role="system", content="v3")], prompt="v3",
        )
        v4_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=4, version_id="v4_id", model="openai/gpt-4",
            messages=[Message(role="system", content="v4")], prompt="v4",
        )

        def mock_get(prompt_id, version_number=None, tag=None):
            if tag == "production":
                return v3_data
            elif tag == "staging":
                return v4_data
            return v3_data

        facade._api_service.get = Mock(side_effect=mock_get)

        with patch("time.time", return_value=0):
            facade.get("pizza-prompt", tag="production", fetch_policy=FetchPolicy.CACHE_TTL)
            facade.get("pizza-prompt", tag="staging", fetch_policy=FetchPolicy.CACHE_TTL)

        production_key = next(
            k for k in facade._cache.keys() if "::tag:production" in k
        )
        staging_key = next(k for k in facade._cache.keys() if "::tag:staging" in k)

        assert production_key != staging_key
        assert facade._cache[production_key]["data"].version == 3
        assert facade._cache[staging_key]["data"].version == 4

    def test_tag_cache_hit_does_not_call_api_again(self):
        """
        When the same tag is requested twice within TTL
        Then the API is called only once
        """
        from langwatch.prompts.types import PromptData, Message

        facade = self._make_facade_with_mock_api()
        mock_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=3, version_id="v3_id", model="openai/gpt-4",
            messages=[Message(role="system", content="v3")], prompt="v3",
        )
        facade._api_service.get = Mock(return_value=mock_data)

        with patch("time.time", return_value=0):
            facade.get(
                "pizza-prompt", tag="production",
                fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5,
            )
            facade.get(
                "pizza-prompt", tag="production",
                fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5,
            )

        assert facade._api_service.get.call_count == 1


# ---------------------------------------------------------------------------
# PromptsFacade.tags.assign() sub-resource
# ---------------------------------------------------------------------------


class TestPromptsFacadeTagsAssign:
    """Tests for the tags.assign() sub-resource on PromptsFacade."""

    def test_tags_assign_calls_api_service(self):
        """
        When prompts.tags.assign("pizza-prompt", tag="production", version_id="v3_id") is called
        Then the API service assign_tag is called
        """
        mock_client = Mock()
        facade = PromptsFacade(mock_client)
        facade._api_service.assign_tag = Mock(return_value={
            "configId": "config_abc",
            "versionId": "v3_id",
            "tag": "production",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        })

        facade.tags.assign("pizza-prompt", tag="production", version_id="v3_id")

        facade._api_service.assign_tag.assert_called_once_with(
            "pizza-prompt", "production", "v3_id"
        )

    def test_tags_assign_returns_confirmation_with_all_fields(self):
        """
        When tags.assign() succeeds
        Then the result contains config_id, version_id, tag, updated_at
        """
        mock_client = Mock()
        facade = PromptsFacade(mock_client)
        expected = {
            "configId": "config_abc",
            "versionId": "v3_id",
            "tag": "production",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        }
        facade._api_service.assign_tag = Mock(return_value=expected)

        result = facade.tags.assign("pizza-prompt", tag="production", version_id="v3_id")

        assert result["configId"] == "config_abc"
        assert result["versionId"] == "v3_id"
        assert result["tag"] == "production"
        assert result["updatedAt"] == "2026-01-01T00:00:00.000Z"

    def test_tags_assign_works_with_custom_tag(self):
        """
        When tags.assign() is called with tag="canary"
        Then the API service is called with tag="canary"
        """
        mock_client = Mock()
        facade = PromptsFacade(mock_client)
        facade._api_service.assign_tag = Mock(return_value={
            "configId": "config_abc",
            "versionId": "v3_id",
            "tag": "canary",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        })

        facade.tags.assign("pizza-prompt", tag="canary", version_id="v3_id")

        facade._api_service.assign_tag.assert_called_once_with(
            "pizza-prompt", "canary", "v3_id"
        )


# ---------------------------------------------------------------------------
# Backward compatibility: labels alias
# ---------------------------------------------------------------------------


class TestBackwardCompatLabelsAlias:
    """Tests that the labels property and label= parameter still work."""

    def test_labels_property_returns_tags_namespace(self):
        """
        When prompts.labels is accessed
        Then it returns the same PromptTagsNamespace as prompts.tags
        """
        mock_client = Mock()
        facade = PromptsFacade(mock_client)

        assert type(facade.labels) == type(facade.tags)

    def test_labels_assign_works_with_deprecated_label_param(self):
        """
        When labels.assign() is called with label="production" (deprecated)
        Then it calls the API service assign_tag
        """
        mock_client = Mock()
        facade = PromptsFacade(mock_client)
        facade._api_service.assign_tag = Mock(return_value={
            "configId": "config_abc",
            "versionId": "v3_id",
            "tag": "production",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        })

        with pytest.warns(DeprecationWarning, match="label.*deprecated"):
            facade.labels.assign(
                "pizza-prompt", label="production", version_id="v3_id"
            )

        facade._api_service.assign_tag.assert_called_once_with(
            "pizza-prompt", "production", "v3_id"
        )

    def test_create_with_deprecated_labels_param(self):
        """
        When create() is called with labels=["production"] (deprecated)
        Then it passes tags=["production"] to the API service
        """
        from langwatch.prompts.types import PromptData, Message

        mock_client = Mock()
        facade = PromptsFacade(mock_client)
        mock_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=1, version_id="v1", model="openai/gpt-4",
            messages=[Message(role="system", content="v1")], prompt="v1",
        )
        facade._api_service.create = Mock(return_value=mock_data)

        with pytest.warns(DeprecationWarning, match="labels.*deprecated"):
            facade.create(handle="pizza-prompt", labels=["production"])

        call_kwargs = facade._api_service.create.call_args[1]
        assert call_kwargs["tags"] == ["production"]

    def test_update_with_deprecated_labels_param(self):
        """
        When update() is called with labels=["staging"] (deprecated)
        Then it passes tags=["staging"] to the API service
        """
        from langwatch.prompts.types import PromptData, Message

        mock_client = Mock()
        facade = PromptsFacade(mock_client)
        mock_data = PromptData(
            id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
            version=2, version_id="v2", model="openai/gpt-4",
            messages=[Message(role="system", content="v2")], prompt="v2",
        )
        facade._api_service.update = Mock(return_value=mock_data)

        with pytest.warns(DeprecationWarning, match="labels.*deprecated"):
            facade.update(
                prompt_id_or_handle="pizza-prompt",
                scope="PROJECT",
                commit_message="update",
                labels=["staging"],
            )

        call_kwargs = facade._api_service.update.call_args[1]
        assert call_kwargs["tags"] == ["staging"]


# ---------------------------------------------------------------------------
# Integration with langwatch.prompts (global interface)
# ---------------------------------------------------------------------------


class TestLangwatchPromptsGlobalInterface:
    """Tests that langwatch.prompts exposes the tags and labels sub-resources."""

    def test_langwatch_prompts_has_tags_attribute(self, clean_langwatch):
        """langwatch.prompts.tags exists and has an assign method."""
        assert hasattr(langwatch.prompts, "tags")
        assert callable(getattr(langwatch.prompts.tags, "assign", None))

    def test_langwatch_prompts_has_labels_attribute(self, clean_langwatch):
        """langwatch.prompts.labels exists and has an assign method (backward compat)."""
        assert hasattr(langwatch.prompts, "labels")
        assert callable(getattr(langwatch.prompts.labels, "assign", None))
