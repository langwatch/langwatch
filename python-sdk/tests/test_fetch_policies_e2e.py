import os
import subprocess
import tempfile
import time
from pathlib import Path

import pytest

from langwatch.prompts.types import FetchPolicy


@pytest.mark.e2e
def test_fetch_policies_example_runs_successfully():
    """
    GIVEN the fetch_policies_demo.py example exists
    WHEN we run it
    THEN it should execute successfully demonstrating all fetch policies
    """
    # Find the example script
    example_path = Path(__file__).parent.parent / "examples" / "fetch_policies_demo.py"
    assert example_path.exists(), f"Example script not found: {example_path}"

    # Run the example in a temporary directory to avoid conflicts
    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir)

        # Set up minimal environment
        env = os.environ.copy()
        # Use a dummy API key if not set (the example should handle this gracefully)
        if "LANGWATCH_API_KEY" not in env:
            env["LANGWATCH_API_KEY"] = "dummy-key-for-testing"

        try:
            # Run the example
            result = subprocess.run(
                ["python", str(example_path)],
                cwd=work_dir,
                env=env,
                capture_output=True,
                text=True,
                timeout=120,  # 2 minute timeout for CLI operations
                input="Y\n",  # Answer "Y" to any prompts
            )

            # Check that it ran successfully
            assert (
                result.returncode == 0
            ), f"Example failed with stderr: {result.stderr}"

            # Check that key output messages appear
            stdout = result.stdout
            assert "🚀 Fetch Policies Demo" in stdout
            assert "✅ Local prompt" in stdout
            assert "🎉 All fetch policy demos completed!" in stdout

        except subprocess.TimeoutExpired:
            pytest.fail("Example timed out after 2 minutes")


@pytest.mark.e2e
def test_fetch_policies_integration_with_local_files():
    """
    GIVEN a local prompt file exists via CLI setup
    WHEN we use different fetch policies
    THEN MATERIALIZED_FIRST and MATERIALIZED_ONLY should work without API calls
    """
    import langwatch

    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir)
        original_cwd = Path.cwd()

        try:
            os.chdir(work_dir)

            # Set up a local prompt using CLI (similar to the example)
            cli_executable = ["npx", "langwatch@latest"]
            prompt_name = f"e2e-test-{int(time.time())}"

            # CLI init
            result = subprocess.run(
                cli_executable + ["prompt", "init"],
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=30,
                input="Y\n",
            )
            assert result.returncode == 0

            # CLI create
            result = subprocess.run(
                cli_executable + ["prompt", "create", prompt_name],
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=30,
                input="Y\n",
            )
            assert result.returncode == 0

            # CLI add
            prompt_file_path = f"prompts/{prompt_name}.prompt.yaml"
            result = subprocess.run(
                cli_executable + ["prompt", "add", prompt_name, prompt_file_path],
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=30,
                input="Y\n",
            )
            assert result.returncode == 0

            # Now test the fetch policies
            langwatch.setup()

            # Test MATERIALIZED_FIRST (default) - should work locally
            prompt1 = langwatch.prompts.get(prompt_name)
            assert prompt1 is not None
            assert prompt1.handle == prompt_name

            # Test MATERIALIZED_ONLY - should work locally
            prompt2 = langwatch.prompts.get(
                prompt_name, fetch_policy=FetchPolicy.MATERIALIZED_ONLY
            )
            assert prompt2 is not None
            assert prompt2.handle == prompt_name

            # Test that ALWAYS_FETCH and CACHE_TTL exist (can't easily test API interaction in E2E)
            # These would normally require API mocking or a real API
            assert FetchPolicy.ALWAYS_FETCH
            assert FetchPolicy.CACHE_TTL

        finally:
            os.chdir(original_cwd)
