import os
import subprocess
import tempfile
import time
from pathlib import Path
from unittest.mock import patch, Mock
import httpx

import pytest

import langwatch
from langwatch import FetchPolicy

# Integration tests with mocking


@pytest.mark.integration
def test_always_fetch_falls_back_to_local_when_api_fails(
    cli_prompt_setup: Path, clean_langwatch
):
    """
    GIVEN the API returns an error
    AND a prompt exists locally
    WHEN I retrieve the prompt with ALWAYS_FETCH policy
    THEN the system returns the local version
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(cli_prompt_setup)

        # Mock API to return an error
        with patch("httpx.Client.request") as mock_request:
            mock_request.side_effect = httpx.HTTPStatusError(
                "500 Server Error", request=Mock(), response=Mock(status_code=500)
            )

            # Should fall back to local
            result = langwatch.prompts.get(
                "my-prompt", fetch_policy=FetchPolicy.ALWAYS_FETCH
            )

            # Verify: Got the local prompt
            assert result is not None
            assert result.model == "openai/gpt-4"

            # Verify HTTP call was attempted (but failed)
            mock_request.assert_called_once()

    finally:
        os.chdir(original_cwd)


@pytest.mark.integration
def test_materialized_only_throws_when_local_file_not_found(
    empty_dir: Path, clean_langwatch
):
    """
    GIVEN no local prompt file exists
    WHEN I retrieve a prompt with MATERIALIZED_ONLY policy
    THEN the system throws a "not found" error
    AND the system does NOT call the API
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(empty_dir)

        # Block all HTTP requests
        with patch("httpx.Client.request") as mock_request:
            mock_request.side_effect = httpx.ConnectError("Connection blocked for test")

            # Should throw ValueError for not found
            with pytest.raises(ValueError, match="not found"):
                langwatch.prompts.get(
                    "nonexistent-prompt", fetch_policy=FetchPolicy.MATERIALIZED_ONLY
                )

            # Verify no HTTP calls were made
            mock_request.assert_not_called()

    finally:
        os.chdir(original_cwd)


@pytest.mark.integration
def test_cache_ttl_returns_cached_version_before_expiration(
    empty_dir: Path, clean_langwatch
):
    """
    GIVEN a prompt was fetched from API and cached
    AND the cache has not expired
    WHEN I retrieve the prompt again with CACHE_TTL policy
    THEN the system returns the cached version
    AND the system does NOT call the API on the second request
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(empty_dir)

        # Mock API response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "my-prompt",
            "handle": "my-prompt",
            "scope": "PROJECT",
            "name": "Test Prompt",
            "updatedAt": "2023-01-01T00:00:00Z",
            "projectId": "project_1",
            "organizationId": "org_1",
            "versionId": "version_123",
            "version": 1,
            "createdAt": "2023-01-01T00:00:00Z",
            "prompt": "Hello {{ name }}!",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "{{input}}"},
            ],
            "inputs": [],
            "outputs": [],
            "model": "openai/gpt-4",
        }

        with patch("httpx.Client.request") as mock_request:
            mock_request.return_value = mock_response

            # First call should fetch from API and cache the result
            result1 = langwatch.prompts.get(
                "my-prompt", fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5
            )
            assert result1 is not None
            assert result1.model == "openai/gpt-4"
            assert mock_request.call_count == 1

            # Second call within TTL should use cache (no API call)
            result2 = langwatch.prompts.get(
                "my-prompt", fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5
            )
            assert result2 is not None
            assert result2.model == "openai/gpt-4"

            # Only one API call should have been made (first call)
            assert mock_request.call_count == 1

    finally:
        os.chdir(original_cwd)


@pytest.mark.integration
def test_cache_ttl_falls_back_to_local_when_api_fails(
    cli_prompt_setup: Path, clean_langwatch
):
    """
    GIVEN the API is down
    AND a prompt exists locally
    WHEN I retrieve the prompt with CACHE_TTL policy
    THEN the system returns the local version
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(cli_prompt_setup)

        # Mock API to always fail
        with patch("httpx.Client.request") as mock_request:
            mock_request.side_effect = httpx.ConnectError("API is down")

            result = langwatch.prompts.get(
                "my-prompt", fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5
            )

            # Should fall back to local
            assert result is not None
            assert result.model == "openai/gpt-4"

            # Verify HTTP call was attempted
            mock_request.assert_called_once()

    finally:
        os.chdir(original_cwd)


@pytest.mark.integration
def test_prompt_not_found_anywhere_throws_error(empty_dir: Path, clean_langwatch):
    """
    GIVEN no local prompt file exists
    AND the API returns 404
    WHEN I retrieve the prompt
    THEN the system throws a "not found" error
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(empty_dir)

        # Mock API to return 404
        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.json.return_value = {"error": "Prompt not found"}
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "404 Not Found", request=Mock(), response=mock_response
        )

        with patch("httpx.Client.request") as mock_request:
            mock_request.return_value = mock_response

            # Should throw an error
            with pytest.raises((ValueError, httpx.HTTPStatusError)):
                langwatch.prompts.get("nonexistent-prompt")

            # Verify HTTP call was made
            mock_request.assert_called_once()

    finally:
        os.chdir(original_cwd)


@pytest.mark.integration
def test_default_policy_fetches_from_api_when_no_local_file_exists(
    empty_dir: Path, clean_langwatch
):
    """
    GIVEN a prompt exists on the server
    AND no local file exists
    WHEN I retrieve the prompt with default policy
    THEN the system returns the server version
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(empty_dir)

        # Mock API response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "api-prompt",
            "handle": "api-prompt",
            "scope": "PROJECT",
            "name": "Test Prompt",
            "updatedAt": "2023-01-01T00:00:00Z",
            "projectId": "project_1",
            "organizationId": "org_1",
            "versionId": "version_123",
            "version": 1,
            "createdAt": "2023-01-01T00:00:00Z",
            "prompt": "Hello {{ name }}!",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "{{input}}"},
            ],
            "inputs": [],
            "outputs": [],
            "model": "openai/gpt-4",
        }

        with patch("httpx.Client.request") as mock_request:
            mock_request.return_value = mock_response

            result = langwatch.prompts.get("api-prompt")

            # Verify we got the API prompt
            assert result is not None
            assert result.model == "openai/gpt-4"
            # Verify HTTP call was made
            mock_request.assert_called_once()

    finally:
        os.chdir(original_cwd)


@pytest.mark.integration
def test_always_fetch_returns_server_prompt(empty_dir: Path, clean_langwatch):
    """
    GIVEN a prompt exists on the server
    WHEN I retrieve the prompt with ALWAYS_FETCH policy
    THEN the system calls the API
    AND the system returns the server version
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(empty_dir)

        # Mock API response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "api-prompt",
            "handle": "api-prompt",
            "scope": "PROJECT",
            "name": "Test Prompt",
            "updatedAt": "2023-01-01T00:00:00Z",
            "projectId": "project_1",
            "organizationId": "org_1",
            "versionId": "version_123",
            "version": 1,
            "createdAt": "2023-01-01T00:00:00Z",
            "prompt": "Hello {{ name }}!",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "{{input}}"},
            ],
            "inputs": [],
            "outputs": [],
            "model": "openai/gpt-4",
        }

        with patch("httpx.Client.request") as mock_request:
            mock_request.return_value = mock_response

            result = langwatch.prompts.get(
                "api-prompt", fetch_policy=FetchPolicy.ALWAYS_FETCH
            )

            # Verify we got the API prompt
            assert result is not None
            assert result.model == "openai/gpt-4"
            # Verify HTTP call was made
            mock_request.assert_called_once()

    finally:
        os.chdir(original_cwd)


@pytest.mark.integration
def test_materialized_only_returns_local_prompt_without_api_call(
    cli_prompt_setup: Path, clean_langwatch
):
    """
    GIVEN a prompt exists locally via CLI sync
    WHEN I retrieve the prompt with MATERIALIZED_ONLY policy
    THEN the system returns the local version
    AND the system does NOT call the API
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(cli_prompt_setup)

        # Block all HTTP requests
        with patch("httpx.Client.request") as mock_request:
            mock_request.side_effect = httpx.ConnectError("Connection blocked for test")

            result = langwatch.prompts.get(
                "my-prompt", fetch_policy=FetchPolicy.MATERIALIZED_ONLY
            )

            # Verify we got the local prompt
            assert result is not None
            assert result.model == "openai/gpt-4"
            # Verify no HTTP calls were made
            mock_request.assert_not_called()

    finally:
        os.chdir(original_cwd)


@pytest.mark.integration
def test_cache_ttl_refetches_after_expiration(empty_dir: Path, clean_langwatch):
    """
    GIVEN a prompt exists on the server
    AND the cache TTL is set to a short duration
    WHEN I retrieve the prompt twice with a delay exceeding TTL
    THEN the system calls the API on both retrievals
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(empty_dir)

        # Mock API response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "api-prompt",
            "handle": "api-prompt",
            "scope": "PROJECT",
            "name": "Test Prompt",
            "updatedAt": "2023-01-01T00:00:00Z",
            "projectId": "project_1",
            "organizationId": "org_1",
            "versionId": "version_123",
            "version": 1,
            "createdAt": "2023-01-01T00:00:00Z",
            "prompt": "Hello {{ name }}!",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "{{input}}"},
            ],
            "inputs": [],
            "outputs": [],
            "model": "openai/gpt-4",
        }

        with (
            patch("httpx.Client.request") as mock_request,
            patch("time.time") as mock_time,
        ):
            mock_request.return_value = mock_response

            # First call at time 0
            mock_time.return_value = 0
            result1 = langwatch.prompts.get(
                "api-prompt",
                fetch_policy=FetchPolicy.CACHE_TTL,
                cache_ttl_minutes=0.001,  # Very short TTL
            )
            assert result1 is not None
            assert mock_request.call_count == 1

            # Second call after TTL expired (time 10)
            mock_time.return_value = 10
            result2 = langwatch.prompts.get(
                "api-prompt",
                fetch_policy=FetchPolicy.CACHE_TTL,
                cache_ttl_minutes=0.001,
            )
            assert result2 is not None
            # Should have made second API call
            assert mock_request.call_count == 2

    finally:
        os.chdir(original_cwd)


@pytest.mark.integration
def test_cache_ttl_falls_back_to_local_when_cache_expires_and_api_fails(
    cli_prompt_setup: Path, clean_langwatch
):
    """
    GIVEN a prompt was cached with CACHE_TTL policy
    AND the cache has expired
    AND the API now fails
    WHEN I retrieve the prompt with CACHE_TTL policy
    THEN the system returns the local version
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(cli_prompt_setup)

        # First call should cache the local result (API blocked)
        with patch("httpx.Client.request") as mock_request:
            mock_request.side_effect = httpx.ConnectError("API blocked for first call")

            # Use a very short TTL for testing
            result1 = langwatch.prompts.get(
                "my-prompt", fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=0.001
            )
            assert result1 is not None
            assert result1.model == "openai/gpt-4"

        # Simulate time passing (cache expiration) by mocking time.time
        with (
            patch("httpx.Client.request") as mock_request,
            patch("time.time") as mock_time,
        ):
            # Set time to simulate cache expiration (10 seconds later)
            mock_time.return_value = 10  # 10 seconds = cache expired

            # Mock API to fail on the refetch attempt
            mock_request.side_effect = httpx.ConnectError(
                "API fails after cache expiry"
            )

            # Should fall back to local despite cache expiry and API failure
            result2 = langwatch.prompts.get(
                "my-prompt", fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=0.001
            )
            assert result2 is not None
            assert result2.model == "openai/gpt-4"

            # Should have attempted API call after cache expiry
            mock_request.assert_called_once()

    finally:
        os.chdir(original_cwd)


@pytest.mark.unit
def test_cache_ttl_caches_versions_independently(clean_langwatch):
    """
    GIVEN "my-prompt" version "1" was cached
    WHEN I request "my-prompt" version "2"
    THEN it's a cache miss
    """
    from langwatch.prompts.prompt_facade import PromptsFacade
    from unittest.mock import Mock, patch
    import time

    # Create a facade instance with mocked dependencies
    mock_client = Mock()
    facade = PromptsFacade(mock_client)

    # Mock API responses for different versions
    version_1_response = {
        "id": "my-prompt",
        "handle": "my-prompt",
        "scope": "PROJECT",
        "name": "Test Prompt",
        "version": 1,
        "versionId": "version_123",
        "model": "openai/gpt-4",
        "messages": [{"role": "system", "content": "Version 1"}],
        "inputs": [],
        "outputs": [],
        "createdAt": "2023-01-01T00:00:00Z",
        "updatedAt": "2023-01-01T00:00:00Z",
        "projectId": "project_1",
        "organizationId": "org_1",
        "prompt": "Version 1 content",
    }

    version_2_response = {
        "id": "my-prompt",
        "handle": "my-prompt",
        "scope": "PROJECT",
        "name": "Test Prompt",
        "version": 2,
        "versionId": "version_456",
        "model": "openai/gpt-4",
        "messages": [{"role": "system", "content": "Version 2"}],
        "inputs": [],
        "outputs": [],
        "createdAt": "2023-01-01T00:00:00Z",
        "updatedAt": "2023-01-01T00:00:00Z",
        "projectId": "project_1",
        "organizationId": "org_1",
        "prompt": "Version 2 content",
    }

    # Mock the API service to return different responses based on version
    def mock_get(prompt_id, version_number=None):
        if version_number == 1:
            return version_1_response
        elif version_number == 2:
            return version_2_response
        return version_1_response  # default

    facade._api_service.get = Mock(side_effect=mock_get)

    # First request for version 1 - should hit API and cache
    with patch("time.time", return_value=0):  # Time at 0
        result1 = facade._get_cache_ttl(
            "my-prompt", version_number=1, cache_ttl_minutes=5
        )

    # Verify it called the API for version 1
    facade._api_service.get.assert_called_with("my-prompt", 1)
    assert result1.version == 1

    # Second request for version 2 - should be a cache miss and hit API again
    facade._api_service.get.reset_mock()
    with patch("time.time", return_value=1):  # Still within TTL for version 1
        result2 = facade._get_cache_ttl(
            "my-prompt", version_number=2, cache_ttl_minutes=5
        )

    # Verify it called the API again for version 2
    facade._api_service.get.assert_called_with("my-prompt", 2)
    assert result2.version == 2

    # Verify different versions are cached separately
    assert "my-prompt::version:1" in facade._cache
    assert "my-prompt::version:2" in facade._cache
    assert facade._cache["my-prompt::version:1"]["data"]["version"] == 1
    assert facade._cache["my-prompt::version:2"]["data"]["version"] == 2
