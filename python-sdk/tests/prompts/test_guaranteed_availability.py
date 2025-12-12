import os
import time
from pathlib import Path
from unittest.mock import patch, Mock
import httpx
import pytest

import langwatch
from langwatch.prompts.types import FetchPolicy


def test_prompts_get_checks_local_files_first(cli_prompt_setup: Path, clean_langwatch):
    """
    GIVEN a local prompt file exists (created in CLI format)
    WHEN I call langwatch.prompts.get()
    THEN it should return the local prompt without calling the API

    NOTE: This test blocks all HTTP requests to ensure local file loading
    is used when implemented. Currently will fail until local loading is added.
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(cli_prompt_setup)

        # Block all HTTP requests by making them fail
        with patch("httpx.Client.request") as mock_request:
            mock_request.side_effect = httpx.ConnectError("Connection blocked for test")

            result = langwatch.prompts.get("my-prompt")

            # If we get here, local file loading worked
            assert result is not None
            assert result.model == "openai/gpt-4"
            # Verify no HTTP calls were made
            mock_request.assert_not_called()

    finally:
        os.chdir(original_cwd)


def test_prompts_get_falls_back_to_api_when_no_local_file(
    empty_dir: Path, clean_langwatch
):
    """
    GIVEN no local prompt file exists
    WHEN I call langwatch.prompts.get()
    THEN it should fallback to the API service
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(empty_dir)

        # Mock the API response at HTTP level
        mock_response = Mock()
        mock_response.status_code = 200
        # Use a minimal valid response that matches the API schema
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

            # Verify: Got the API prompt
            assert result is not None
            assert result.model == "openai/gpt-4"

            # Verify HTTP call was made
            mock_request.assert_called_once()
            # Check that the request was for the right prompt
            call_args = mock_request.call_args
            assert "api-prompt" in str(call_args)

    finally:
        os.chdir(original_cwd)


def test_prompts_get_throws_when_not_found(empty_dir: Path, clean_langwatch):
    """
    GIVEN no local prompt file exists AND the API returns 404
    WHEN I call langwatch.prompts.get()
    THEN it should raise a ValueError (404 not found error)
    """
    import pytest

    original_cwd = Path.cwd()
    try:
        os.chdir(empty_dir)

        # Mock the API to return 404
        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.json.return_value = {"error": "Prompt not found"}

        with patch("httpx.Client.request") as mock_request:
            mock_request.return_value = mock_response

            # Verify that calling get() with a non-existent prompt raises an error
            with pytest.raises(ValueError) as exc_info:
                langwatch.prompts.get("non-existent-prompt")

            # Verify error message contains useful information
            assert "non-existent-prompt" in str(exc_info.value)
            assert "not found" in str(exc_info.value).lower()

    finally:
        os.chdir(original_cwd)


def test_fetch_policy_materialized_only_with_local_file(
    cli_prompt_setup: Path, clean_langwatch
):
    """
    GIVEN a local prompt file exists
    WHEN I call langwatch.prompts.get() with MATERIALIZED_ONLY policy
    THEN it should return the local prompt without calling the API
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


def test_fetch_policy_materialized_only_without_local_file(
    empty_dir: Path, clean_langwatch
):
    """
    GIVEN no local prompt file exists
    WHEN I call langwatch.prompts.get() with MATERIALIZED_ONLY policy
    THEN it should raise an error
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(empty_dir)

        with pytest.raises(ValueError) as exc_info:
            langwatch.prompts.get(
                "non-existent-prompt", fetch_policy=FetchPolicy.MATERIALIZED_ONLY
            )

        assert "not found" in str(exc_info.value).lower()

    finally:
        os.chdir(original_cwd)


def test_fetch_policy_always_fetch_with_api_available(empty_dir: Path, clean_langwatch):
    """
    GIVEN no local prompt file exists but API is available
    WHEN I call langwatch.prompts.get() with ALWAYS_FETCH policy
    THEN it should call the API and return the result
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


def test_fetch_policy_always_fetch_fallback_to_local(
    cli_prompt_setup: Path, clean_langwatch
):
    """
    GIVEN a local prompt file exists and API fails
    WHEN I call langwatch.prompts.get() with ALWAYS_FETCH policy
    THEN it should return the local prompt
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(cli_prompt_setup)

        # Mock API to fail
        mock_response = Mock()
        mock_response.status_code = 500
        mock_response.json.return_value = {"error": "Server error"}

        with patch("httpx.Client.request") as mock_request:
            mock_request.return_value = mock_response

            result = langwatch.prompts.get(
                "my-prompt", fetch_policy=FetchPolicy.ALWAYS_FETCH
            )

            # Verify we got the local prompt as fallback
            assert result is not None
            assert result.model == "openai/gpt-4"
            # Verify HTTP call was attempted
            mock_request.assert_called_once()

    finally:
        os.chdir(original_cwd)


def test_fetch_policy_cache_ttl_caches_api_result(empty_dir: Path, clean_langwatch):
    """
    GIVEN API returns a prompt
    WHEN I call langwatch.prompts.get() with CACHE_TTL policy twice within TTL
    THEN the second call should return cached result without API call
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

            # First call - should hit API
            result1 = langwatch.prompts.get(
                "api-prompt", fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5
            )
            assert result1 is not None
            assert mock_request.call_count == 1

            # Second call within TTL - should use cache
            result2 = langwatch.prompts.get(
                "api-prompt", fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=5
            )
            assert result2 is not None
            # Should still be only 1 API call (cached)
            assert mock_request.call_count == 1

    finally:
        os.chdir(original_cwd)


def test_fetch_policy_cache_ttl_expires(empty_dir: Path, clean_langwatch):
    """
    GIVEN API returns a prompt with short TTL
    WHEN I wait past TTL and call again
    THEN it should make another API call
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
                cache_ttl_minutes=0.001,
            )  # 3.6 seconds
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
