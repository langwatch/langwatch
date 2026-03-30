"""
Integration tests for prompt label support.

Tests API interaction patterns with mocked HTTP layer.
"""
import os
from pathlib import Path
from unittest.mock import patch, Mock

import pytest

from langwatch import prompts, FetchPolicy
from langwatch.prompts.prompt_facade import PromptsFacade
from langwatch.prompts.types import PromptData, Message


def _api_response(version: int, version_id: str = "version_123"):
    """Build a mock API response for a given version number."""
    mock_response = Mock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "id": "pizza-prompt",
        "handle": "pizza-prompt",
        "scope": "PROJECT",
        "name": "Pizza Prompt",
        "updatedAt": "2023-01-01T00:00:00Z",
        "projectId": "project_1",
        "organizationId": "org_1",
        "versionId": version_id,
        "version": version,
        "createdAt": "2023-01-01T00:00:00Z",
        "prompt": f"Version {version} content",
        "messages": [
            {"role": "system", "content": f"You are version {version}."},
        ],
        "inputs": [],
        "outputs": [],
        "model": "openai/gpt-4",
    }
    return mock_response


@pytest.mark.integration
class TestFetchByLabel:
    """Integration tests for fetching prompts by label."""

    class TestWhenLabelProvided:
        """Scenario: Fetch prompt by label."""

        def test_sends_label_query_parameter(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = _api_response(3)

                    result = prompts.get("pizza-prompt", label="production")

                    assert result.version == 3

                    # Verify the request included the label query param
                    call_kwargs = mock_request.call_args
                    params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params", {})
                    assert params.get("label") == "production"

            finally:
                os.chdir(original_cwd)

    class TestWhenNoLabelProvided:
        """Scenario: Fetch without label returns latest."""

        def test_sends_no_label_query_parameter(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = _api_response(4)

                    result = prompts.get("pizza-prompt")

                    assert result.version == 4

                    # Verify no label param was sent
                    call_kwargs = mock_request.call_args
                    params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params", {})
                    assert "label" not in params

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestCacheIsolation:
    """Integration tests for cache key isolation with labels."""

    class TestWhenLabeledAndUnlabeledFetched:
        """Scenario: Labeled and unlabeled fetches return independent results."""

        def test_api_called_twice_no_cache_collision(self):
            mock_client = Mock()
            facade = PromptsFacade(mock_client)

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

            def mock_get(prompt_id, version_number=None, label=None):
                if label == "production":
                    return v3_data
                return v4_data

            facade._api_service.get = Mock(side_effect=mock_get)

            with patch("time.time", return_value=0):
                result1 = facade.get(
                    "pizza-prompt", label="production",
                    fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5,
                )
                result2 = facade.get(
                    "pizza-prompt",
                    fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5,
                )

            assert facade._api_service.get.call_count == 2
            assert result1.version == 3
            assert result2.version == 4

    class TestWhenDifferentLabelsFetched:
        """Scenario: Fetches with different labels return independent results."""

        def test_api_called_twice_different_labels(self):
            mock_client = Mock()
            facade = PromptsFacade(mock_client)

            v3_data = PromptData(
                id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
                version=3, version_id="v3_id", model="openai/gpt-4",
                messages=[Message(role="system", content="v3")], prompt="v3",
            )
            v2_data = PromptData(
                id="pizza-prompt", handle="pizza-prompt", scope="PROJECT",
                version=2, version_id="v2_id", model="openai/gpt-4",
                messages=[Message(role="system", content="v2")], prompt="v2",
            )

            def mock_get(prompt_id, version_number=None, label=None):
                if label == "production":
                    return v3_data
                if label == "staging":
                    return v2_data
                return v3_data

            facade._api_service.get = Mock(side_effect=mock_get)

            with patch("time.time", return_value=0):
                result1 = facade.get(
                    "pizza-prompt", label="production",
                    fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5,
                )
                result2 = facade.get(
                    "pizza-prompt", label="staging",
                    fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5,
                )

            assert facade._api_service.get.call_count == 2
            assert result1.version == 3
            assert result2.version == 2


@pytest.mark.integration
class TestLabelWithMaterializedFirst:
    """Integration tests for label + MATERIALIZED_FIRST policy."""

    class TestWhenLabelWithMaterializedFirstPolicy:
        """Scenario: Label with MATERIALIZED_FIRST skips local and fetches from API."""

        def test_skips_local_fetches_from_api(self, cli_prompt_setup, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(cli_prompt_setup)

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = _api_response(3)

                    result = prompts.get(
                        "my-prompt",
                        label="production",
                        fetch_policy=FetchPolicy.MATERIALIZED_FIRST,
                    )

                    # Should have called the API even though local exists
                    mock_request.assert_called_once()
                    assert result.version == 3

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestErrorPropagation:
    """Integration tests for API error propagation with labels."""

    class TestWhenApiReturnsNotFound:
        """Scenario: Unassigned label propagates API error."""

        def test_raises_error_with_api_message(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                mock_response = Mock()
                mock_response.status_code = 404
                mock_response.json.return_value = {"error": "Prompt not found"}

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = mock_response

                    with pytest.raises(ValueError, match="not found"):
                        prompts.get("pizza-prompt", label="production")

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestLabelAssignment:
    """Integration tests for label assignment."""

    class TestWhenAssigningLabel:
        """Scenario: Assign label to existing version."""

        def test_sends_put_request(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                mock_response = Mock()
                mock_response.status_code = 200
                mock_response.json.return_value = {
                    "configId": "pizza-prompt",
                    "versionId": "prompt_version_abc123",
                    "label": "production",
                    "updatedAt": "2023-01-01T00:00:00Z",
                }

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = mock_response

                    result = prompts.labels.assign(
                        "pizza-prompt",
                        label="production",
                        version_id="prompt_version_abc123",
                    )

                    # Verify PUT was sent
                    call_kwargs = mock_request.call_args
                    assert call_kwargs.kwargs.get("method") == "put" or call_kwargs[1].get("method") == "put"
                    url = call_kwargs.kwargs.get("url") or call_kwargs[1].get("url", "")
                    assert "/api/prompts/pizza-prompt/labels/production" in url
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("versionId") == "prompt_version_abc123"

                    # Verify response
                    assert result["versionId"] == "prompt_version_abc123"
                    assert result["label"] == "production"

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestCreateWithLabels:
    """Integration tests for creating prompts with labels."""

    class TestWhenCreatingWithLabels:
        """Scenario: Create prompt with labels."""

        def test_sends_labels_in_request_body(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                mock_response = Mock()
                mock_response.status_code = 200
                mock_response.json.return_value = {
                    "id": "new-prompt",
                    "handle": "new-prompt",
                    "scope": "PROJECT",
                    "name": "New Prompt",
                    "updatedAt": "2023-01-01T00:00:00Z",
                    "projectId": "project_1",
                    "organizationId": "org_1",
                    "versionId": "version_1",
                    "version": 1,
                    "createdAt": "2023-01-01T00:00:00Z",
                    "prompt": "Hello!",
                    "messages": [],
                    "inputs": [],
                    "outputs": [],
                    "model": "openai/gpt-4",
                }

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = mock_response

                    prompts.create(
                        handle="new-prompt",
                        prompt="Hello!",
                        labels=["production"],
                    )

                    call_kwargs = mock_request.call_args
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("labels") == ["production"]

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestUpdateWithLabels:
    """Integration tests for updating prompts with labels."""

    class TestWhenUpdatingWithLabels:
        """Scenario: Update prompt with labels."""

        def test_sends_labels_in_request_body(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                mock_response = Mock()
                mock_response.status_code = 200
                mock_response.json.return_value = {
                    "id": "pizza-prompt",
                    "handle": "pizza-prompt",
                    "scope": "PROJECT",
                    "name": "Pizza Prompt",
                    "updatedAt": "2023-01-01T00:00:00Z",
                    "projectId": "project_1",
                    "organizationId": "org_1",
                    "versionId": "version_2",
                    "version": 2,
                    "createdAt": "2023-01-01T00:00:00Z",
                    "prompt": "Updated!",
                    "messages": [],
                    "inputs": [],
                    "outputs": [],
                    "model": "openai/gpt-4",
                }

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = mock_response

                    prompts.update(
                        prompt_id_or_handle="pizza-prompt",
                        scope="PROJECT",
                        commit_message="update labels",
                        prompt="Updated!",
                        labels=["staging"],
                    )

                    call_kwargs = mock_request.call_args
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("labels") == ["staging"]

            finally:
                os.chdir(original_cwd)
