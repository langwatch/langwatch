"""
Integration tests for prompt tag support.

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
class TestFetchByTag:
    """Integration tests for fetching prompts by tag."""

    class TestWhenTagProvided:
        """Scenario: Fetch prompt by tag."""

        def test_sends_tag_query_parameter(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = _api_response(3)

                    result = prompts.get("pizza-prompt", tag="production")

                    assert result.version == 3

                    # Verify the request included the tag query param
                    call_kwargs = mock_request.call_args
                    params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params", {})
                    assert params.get("tag") == "production"

            finally:
                os.chdir(original_cwd)

    class TestWhenNoTagProvided:
        """Scenario: Fetch without tag returns latest."""

        def test_sends_no_tag_query_parameter(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = _api_response(4)

                    result = prompts.get("pizza-prompt")

                    assert result.version == 4

                    # Verify no tag param was sent
                    call_kwargs = mock_request.call_args
                    params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params", {})
                    assert "tag" not in params

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestCacheIsolation:
    """Integration tests for cache key isolation with tags."""

    class TestWhenTaggedAndUntaggedFetched:
        """Scenario: Tagged and untagged fetches return independent results."""

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

            def mock_get(prompt_id, version_number=None, tag=None):
                if tag == "production":
                    return v3_data
                return v4_data

            facade._api_service.get = Mock(side_effect=mock_get)

            with patch("time.time", return_value=0):
                result1 = facade.get(
                    "pizza-prompt", tag="production",
                    fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5,
                )
                result2 = facade.get(
                    "pizza-prompt",
                    fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5,
                )

            assert facade._api_service.get.call_count == 2
            assert result1.version == 3
            assert result2.version == 4

    class TestWhenDifferentTagsFetched:
        """Scenario: Fetches with different tags return independent results."""

        def test_api_called_twice_different_tags(self):
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

            def mock_get(prompt_id, version_number=None, tag=None):
                if tag == "production":
                    return v3_data
                if tag == "staging":
                    return v2_data
                return v3_data

            facade._api_service.get = Mock(side_effect=mock_get)

            with patch("time.time", return_value=0):
                result1 = facade.get(
                    "pizza-prompt", tag="production",
                    fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5,
                )
                result2 = facade.get(
                    "pizza-prompt", tag="staging",
                    fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5,
                )

            assert facade._api_service.get.call_count == 2
            assert result1.version == 3
            assert result2.version == 2


@pytest.mark.integration
class TestTagWithMaterializedFirst:
    """Integration tests for tag + MATERIALIZED_FIRST policy."""

    class TestWhenTagWithMaterializedFirstPolicy:
        """Scenario: Tag with MATERIALIZED_FIRST skips local and fetches from API."""

        def test_skips_local_fetches_from_api(self, cli_prompt_setup, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(cli_prompt_setup)

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = _api_response(3)

                    result = prompts.get(
                        "my-prompt",
                        tag="production",
                        fetch_policy=FetchPolicy.MATERIALIZED_FIRST,
                    )

                    # Should have called the API even though local exists
                    mock_request.assert_called_once()
                    assert result.version == 3

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestErrorPropagation:
    """Integration tests for API error propagation with tags."""

    class TestWhenApiReturnsNotFound:
        """Scenario: Unassigned tag propagates API error."""

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
                        prompts.get("pizza-prompt", tag="production")

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestTagAssignment:
    """Integration tests for tag assignment."""

    class TestWhenAssigningTag:
        """Scenario: Assign tag to existing version."""

        def test_sends_put_request(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                mock_response = Mock()
                mock_response.status_code = 200
                mock_response.json.return_value = {
                    "configId": "pizza-prompt",
                    "versionId": "prompt_version_abc123",
                    "tag": "production",
                    "updatedAt": "2023-01-01T00:00:00Z",
                }

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = mock_response

                    result = prompts.tags.assign(
                        "pizza-prompt",
                        tag="production",
                        version_id="prompt_version_abc123",
                    )

                    # Verify PUT was sent
                    call_kwargs = mock_request.call_args
                    assert call_kwargs.kwargs.get("method") == "put" or call_kwargs[1].get("method") == "put"
                    url = call_kwargs.kwargs.get("url") or call_kwargs[1].get("url", "")
                    assert "/api/prompts/pizza-prompt/tags/production" in url
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("versionId") == "prompt_version_abc123"

                    # Verify response
                    assert result["versionId"] == "prompt_version_abc123"
                    assert result["tag"] == "production"

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestCreateWithTags:
    """Integration tests for creating prompts with tags."""

    class TestWhenCreatingWithTags:
        """Scenario: Create prompt with tags."""

        def test_sends_tags_in_request_body(self, empty_dir, clean_langwatch):
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
                        tags=["production"],
                    )

                    call_kwargs = mock_request.call_args
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("tags") == ["production"]

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestUpdateWithTags:
    """Integration tests for updating prompts with tags."""

    class TestWhenUpdatingWithTags:
        """Scenario: Update prompt with tags."""

        def test_sends_tags_in_request_body(self, empty_dir, clean_langwatch):
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
                        commit_message="update tags",
                        prompt="Updated!",
                        tags=["staging"],
                    )

                    call_kwargs = mock_request.call_args
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("tags") == ["staging"]

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestCreateWithMultipleTags:
    """Integration tests for creating prompts with multiple tags."""

    class TestWhenCreatingWithMultipleTags:
        """Scenario: Create prompt with multiple tags."""

        def test_sends_all_tags_in_request_body(self, empty_dir, clean_langwatch):
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
                        tags=["production", "staging", "canary"],
                    )

                    call_kwargs = mock_request.call_args
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("tags") == ["production", "staging", "canary"]

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestListAllTags:
    """Integration tests for listing all prompt tags."""

    class TestWhenListingTags:
        """Scenario: List all tags for the organization."""

        def test_sends_get_request(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                mock_response = Mock()
                mock_response.status_code = 200
                mock_response.json.return_value = [
                    {"id": "tag_1", "name": "canary", "createdAt": "2024-01-01T00:00:00Z"},
                    {"id": "tag_2", "name": "staging", "createdAt": "2024-01-02T00:00:00Z"},
                ]

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = mock_response

                    result = prompts.tags.list()

                    call_kwargs = mock_request.call_args
                    assert call_kwargs.kwargs.get("method") == "get" or call_kwargs[1].get("method") == "get"
                    url = call_kwargs.kwargs.get("url") or call_kwargs[1].get("url", "")
                    assert "/api/prompts/tags" in url

                    assert len(result) == 2
                    assert result[0]["name"] == "canary"
                    assert result[1]["name"] == "staging"

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestCreateTagIntegration:
    """Integration tests for creating a prompt tag."""

    class TestWhenCreatingTag:
        """Scenario: Create a new custom tag."""

        def test_sends_post_request(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                mock_response = Mock()
                mock_response.status_code = 201
                mock_response.json.return_value = {
                    "id": "tag_abc",
                    "name": "canary",
                    "createdAt": "2024-01-01T00:00:00Z",
                }

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = mock_response

                    result = prompts.tags.create("canary")

                    call_kwargs = mock_request.call_args
                    assert call_kwargs.kwargs.get("method") == "post" or call_kwargs[1].get("method") == "post"
                    url = call_kwargs.kwargs.get("url") or call_kwargs[1].get("url", "")
                    assert "/api/prompts/tags" in url
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("name") == "canary"

                    assert result["name"] == "canary"
                    assert result["id"] == "tag_abc"

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestRenameTagIntegration:
    """Integration tests for renaming a prompt tag."""

    class TestWhenRenamingTag:
        """Scenario: Rename an existing tag."""

        def test_sends_put_request(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                mock_response = Mock()
                mock_response.status_code = 200
                mock_response.json.return_value = {
                    "id": "tag_abc",
                    "name": "alpha",
                    "createdAt": "2024-01-01T00:00:00Z",
                }

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = mock_response

                    result = prompts.tags.rename("canary", new_name="alpha")

                    call_kwargs = mock_request.call_args
                    assert call_kwargs.kwargs.get("method") == "put" or call_kwargs[1].get("method") == "put"
                    url = call_kwargs.kwargs.get("url") or call_kwargs[1].get("url", "")
                    assert "/api/prompts/tags/canary" in url
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("name") == "alpha"

                    assert result["name"] == "alpha"

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestDeleteTagIntegration:
    """Integration tests for deleting a prompt tag."""

    class TestWhenDeletingTag:
        """Scenario: Delete a tag by name."""

        def test_sends_delete_request(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                mock_response = Mock()
                mock_response.status_code = 204
                mock_response.json.return_value = None
                mock_response.content = b""

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = mock_response

                    result = prompts.tags.delete("canary")

                    call_kwargs = mock_request.call_args
                    assert call_kwargs.kwargs.get("method") == "delete" or call_kwargs[1].get("method") == "delete"
                    url = call_kwargs.kwargs.get("url") or call_kwargs[1].get("url", "")
                    assert "/api/prompts/tags/canary" in url

                    assert result is None

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestUpdateWithMultipleTags:
    """Integration tests for updating prompts with multiple tags."""

    class TestWhenUpdatingWithMultipleTags:
        """Scenario: Update prompt with multiple tags."""

        def test_sends_all_tags_in_request_body(self, empty_dir, clean_langwatch):
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
                        commit_message="update tags",
                        prompt="Updated!",
                        tags=["staging", "canary"],
                    )

                    call_kwargs = mock_request.call_args
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("tags") == ["staging", "canary"]

            finally:
                os.chdir(original_cwd)


@pytest.mark.integration
class TestCustomTagAssignment:
    """Integration tests for custom tag assignment."""

    class TestWhenAssigningCustomTag:
        """Scenario: Assign custom tag to existing version."""

        def test_sends_put_request_with_custom_tag(self, empty_dir, clean_langwatch):
            original_cwd = Path.cwd()
            try:
                os.chdir(empty_dir)

                mock_response = Mock()
                mock_response.status_code = 200
                mock_response.json.return_value = {
                    "configId": "pizza-prompt",
                    "versionId": "prompt_version_abc123",
                    "tag": "canary",
                    "updatedAt": "2023-01-01T00:00:00Z",
                }

                with patch("httpx.Client.request") as mock_request:
                    mock_request.return_value = mock_response

                    result = prompts.tags.assign(
                        "pizza-prompt",
                        tag="canary",
                        version_id="prompt_version_abc123",
                    )

                    call_kwargs = mock_request.call_args
                    assert call_kwargs.kwargs.get("method") == "put" or call_kwargs[1].get("method") == "put"
                    url = call_kwargs.kwargs.get("url") or call_kwargs[1].get("url", "")
                    assert "/api/prompts/pizza-prompt/tags/canary" in url
                    json_body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
                    assert json_body.get("versionId") == "prompt_version_abc123"

                    assert result["versionId"] == "prompt_version_abc123"
                    assert result["tag"] == "canary"

            finally:
                os.chdir(original_cwd)
