"""
End-to-End Tests for Fetch Policies Examples

These tests verify that the fetch policies examples actually work as advertised
by using real API calls and verifying behavior.

Prerequisites:
- LANGWATCH_API_KEY environment variable must be set
- Node.js/npx must be available for CLI operations
"""

import os
from dotenv import load_dotenv

load_dotenv()

import contextlib
import logging
import subprocess
import tempfile
import time
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest

import langwatch
from langwatch.prompts.types import FetchPolicy

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def working_directory(path):
    """Temporarily change the working directory."""
    original_cwd = Path.cwd()
    try:
        os.chdir(path)
        yield
    finally:
        os.chdir(original_cwd)


CLI_EXECUTABLE = ["npx", "langwatch@latest"]


def run_cli(command, cwd=None):
    """Run a CLI command and return the result."""
    try:
        result = subprocess.run(
            command, cwd=cwd, capture_output=True, text=True, check=True, timeout=30
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"CLI command failed: {e}")
        print(f"stdout: {e.stdout}")
        print(f"stderr: {e.stderr}")
        raise


@pytest.fixture
def api_key():
    """Ensure API key is available for e2e tests."""
    key = os.getenv("LANGWATCH_API_KEY")
    if not key:
        pytest.skip("LANGWATCH_API_KEY environment variable not set")
    return key


@pytest.fixture
def temp_workspace():
    """Create a temporary workspace directory for CLI operations."""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


@contextlib.contextmanager
def http_request_counter():
    """
    Context manager that counts HTTP requests made during execution.

    Yields a dictionary with call counts that gets updated in real-time.
    """
    call_counts = {"count": 0}

    original_request = httpx.Client.request

    def counting_request(self, *args, **kwargs):
        call_counts["count"] += 1
        return original_request(self, *args, **kwargs)

    with patch.object(httpx.Client, "request", counting_request):
        yield call_counts


@pytest.mark.e2e
class TestFetchPoliciesE2E:
    """
    End-to-end tests for fetch policies.

    These tests create real prompts on the server, run the example functions,
    and verify they behave as documented.

    To run these tests:
        export LANGWATCH_API_KEY="your-api-key"
        pytest tests/test_fetch_policies_e2e.py -v
    """

    @pytest.fixture(autouse=True)
    def setup_langwatch(self, api_key):
        """Set up LangWatch for each test."""
        langwatch.setup(api_key=api_key)

    def test_materialized_first_prefers_local_with_zero_api_calls(self, temp_workspace):
        """
        Test MATERIALIZED_FIRST policy prefers local prompt without API calls.

        GIVEN a prompt exists locally via CLI setup
        WHEN we retrieve it with default policy (MATERIALIZED_FIRST)
        THEN the system returns the local version without API calls
        """
        with working_directory(temp_workspace):
            # Create a unique prompt handle
            handle = f"e2e-materialized-first-local-{uuid4().hex}"

            # Set up local prompt using CLI
            run_cli([*CLI_EXECUTABLE, "prompt", "init"], temp_workspace)
            run_cli([*CLI_EXECUTABLE, "prompt", "create", handle], temp_workspace)
            run_cli(
                [
                    *CLI_EXECUTABLE,
                    "prompt",
                    "add",
                    handle,
                    f"prompts/{handle}.prompt.yaml",
                ],
                temp_workspace,
            )

            langwatch.setup(debug=True)

            # Run the example with HTTP request counting
            with http_request_counter() as calls:
                prompt = langwatch.prompts.get(
                    handle
                )  # Uses default MATERIALIZED_FIRST

            # Verify the prompt was returned correctly
            assert prompt is not None
            assert prompt.handle == handle

            # Should NOT have made any API calls (local-first behavior)
            assert calls["count"] == 0

    def test_materialized_first_falls_back_to_api_when_local_missing(
        self, temp_workspace
    ):
        """
        Test MATERIALIZED_FIRST policy falls back to API when local missing.

        GIVEN a prompt exists on the server but NOT locally
        WHEN we retrieve it with default policy (MATERIALIZED_FIRST)
        THEN the system falls back to API and returns the server version
        """
        with working_directory(temp_workspace):
            # Create a unique prompt handle
            handle = f"e2e-materialized-first-api-{uuid4().hex}"
            prompt_content = "Hello from MATERIALIZED_FIRST policy test"

            langwatch.setup(debug=True)

            # Create prompt on server
            created_prompt = langwatch.prompts.create(
                handle=handle,
                prompt=prompt_content,
            )

            try:
                # Run the example with HTTP request counting
                with http_request_counter() as calls:
                    prompt = langwatch.prompts.get(
                        handle
                    )  # Uses default MATERIALIZED_FIRST

                # Verify the prompt was returned correctly
                assert prompt is not None
                assert prompt.handle == handle
                assert prompt_content in (prompt.prompt or "")

                # Should have made at least one API call (since no local file exists)
                assert calls["count"] > 0

            finally:
                # Clean up
                try:
                    langwatch.prompts.delete(created_prompt.id)
                except Exception as e:
                    logger.warning(
                        "Failed to delete prompt %s: %s", created_prompt.id, e
                    )

    def test_always_fetch_returns_server_prompt_and_hits_api(self, temp_workspace):
        """
        Test ALWAYS_FETCH policy returns server prompt and calls API.

        GIVEN a prompt exists on the server
        WHEN we retrieve it with ALWAYS_FETCH policy
        THEN the system calls the API and returns the server version
        """
        with working_directory(temp_workspace):
            # Create a unique prompt handle
            handle = f"e2e-always-fetch-{uuid4().hex}"
            prompt_content = "Hello from ALWAYS_FETCH policy test"

            langwatch.setup(debug=True)

            # Create prompt on server
            created_prompt = langwatch.prompts.create(
                handle=handle,
                prompt=prompt_content,
            )

            try:
                # Run the example with HTTP request counting
                with http_request_counter() as calls:
                    prompt = langwatch.prompts.get(
                        handle, fetch_policy=FetchPolicy.ALWAYS_FETCH
                    )

                # Verify the prompt was returned correctly
                assert prompt is not None
                assert prompt.handle == handle
                assert prompt_content in (prompt.prompt or "")

                # Should have made at least one API call
                assert calls["count"] > 0

            finally:
                # Clean up
                try:
                    langwatch.prompts.delete(created_prompt.id)
                except Exception as e:
                    logger.warning(
                        "Failed to delete prompt %s: %s", created_prompt.id, e
                    )

    def test_materialized_only_returns_local_prompt_without_api_call(
        self, temp_workspace
    ):
        """
        Test MATERIALIZED_ONLY policy uses local files without API calls.

        GIVEN a prompt exists locally via CLI setup
        WHEN we retrieve it with MATERIALIZED_ONLY policy
        THEN the system returns the local version without API calls
        """
        with working_directory(temp_workspace):
            # Create a unique prompt handle
            handle = f"e2e-materialized-only-{uuid4().hex}"

            # Setup materialized only prompt using CLI
            run_cli([*CLI_EXECUTABLE, "prompt", "init"], temp_workspace)

            langwatch.setup(debug=True)

            # Create prompt on server
            server_prompt = langwatch.prompts.create(
                handle=handle, prompt="Hello from MATERIALIZED_ONLY policy test"
            )

            print(f"server_prompt: {server_prompt}")

            # CLI add prompt to local project
            add_result = run_cli(
                [*CLI_EXECUTABLE, "prompt", "add", handle],
                temp_workspace,
            )
            print(f"add_result: {add_result}")

            sync_result = run_cli([*CLI_EXECUTABLE, "prompt", "sync"], temp_workspace)
            print(f"sync_result: {sync_result}")

            # Run the example with HTTP request counting
            with http_request_counter() as calls:
                prompt = langwatch.prompts.get(
                    handle, fetch_policy=FetchPolicy.MATERIALIZED_ONLY
                )

            # Verify the prompt was returned correctly
            assert prompt is not None
            assert prompt.handle == handle

            # Should NOT have made any API calls
            assert calls["count"] == 0

    def test_cache_ttl_caches_then_refreshes_after_expiry(self, temp_workspace):
        """
        Test CACHE_TTL policy caches responses and refreshes after TTL expiry.

        GIVEN a prompt exists on the server
        WHEN we retrieve it twice with CACHE_TTL policy using short TTL
        THEN the first call caches and second call refreshes after expiry
        """
        with working_directory(temp_workspace):
            # Create a unique prompt handle
            handle = f"e2e-cache-ttl-{uuid4().hex}"
            prompt_content = "Hello from CACHE_TTL policy test"

            langwatch.setup(debug=True)

            # Create prompt on server
            created_prompt = langwatch.prompts.create(
                handle=handle,
                prompt=prompt_content,
            )

            try:
                # First call - should hit API and cache
                with http_request_counter() as calls_first:
                    prompt1 = langwatch.prompts.get(
                        handle,
                        fetch_policy=FetchPolicy.CACHE_TTL,
                        cache_ttl_minutes=0.0005,
                    )  # Very short TTL

                assert prompt1 is not None
                assert calls_first["count"] > 0

                # Wait for cache to expire
                time.sleep(0.1)  # 0.1 seconds > 0.03 seconds TTL

                # Second call - cache expired, should hit API again
                with http_request_counter() as calls_second:
                    prompt2 = langwatch.prompts.get(
                        handle,
                        fetch_policy=FetchPolicy.CACHE_TTL,
                        cache_ttl_minutes=0.0005,
                    )

                assert prompt2 is not None
                assert calls_second["count"] > 0

                # Both prompts should be the same
                assert prompt1.handle == prompt2.handle
                assert prompt1.id == prompt2.id

            finally:
                # Clean up
                try:
                    langwatch.prompts.delete(created_prompt.id)
                except Exception as e:
                    logger.warning(
                        "Failed to delete prompt %s: %s", created_prompt.id, e
                    )
