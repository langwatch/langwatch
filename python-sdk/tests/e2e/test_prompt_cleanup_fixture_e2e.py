"""
Regression tests for issue #3164 — prompt_factory fixture cleanup.

These tests prove that the `prompt_factory` fixture deletes prompts during
teardown even when the test body raises an exception, i.e. cleanup is
construction-enforced rather than depending on the test's own try/finally.

Prerequisites:
- LANGWATCH_API_KEY environment variable must be set
- The LangWatch server must be reachable
"""

import os
from dotenv import load_dotenv

load_dotenv()

import logging
from uuid import uuid4

import pytest

import langwatch
from langwatch.prompts.local_loader import LocalPromptLoader
from langwatch.prompts.types import FetchPolicy

logger = logging.getLogger(__name__)


@pytest.fixture
def api_key():
    """Ensure API key is available for e2e tests."""
    key = os.getenv("LANGWATCH_API_KEY")
    if not key:
        pytest.skip("LANGWATCH_API_KEY environment variable not set")
    return key


@pytest.fixture(scope="class")
def _shared_state():
    """
    Class-scoped container for sharing state between ordered tests.

    Used to pass the prompt id recorded by the xfail raise-test to the proof
    test that asserts the id is gone.  A dict is preferred over a module global
    because:
    - The state is explicit and pytest-managed (cleaned up between class runs).
    - It avoids mutation of module-level globals, which can bleed across test
      collection if tests are re-run without a fresh process.

    Test ordering within the class is guaranteed by CPython's method-definition
    order, which pytest preserves.  The xfail test is defined first, so it runs
    first and populates "prompt_id" before the proof test reads it.
    """
    return {}


@pytest.mark.e2e
class TestPromptFactoryCleanup:
    """
    Regression tests for issue #3164.

    Verify that the `prompt_factory` fixture deletes every prompt it created
    during teardown — even when the test body raises before returning.

    To run:
        export LANGWATCH_API_KEY="your-api-key"
        pytest tests/e2e/test_prompt_cleanup_fixture_e2e.py -v
    """

    @pytest.fixture(autouse=True)
    def setup_langwatch(self, api_key):
        """Set up LangWatch for each test."""
        LocalPromptLoader._cached_project_root = None
        LocalPromptLoader._warned_no_prompts_path = False
        langwatch.setup(api_key=api_key)
        yield
        LocalPromptLoader._cached_project_root = None
        LocalPromptLoader._warned_no_prompts_path = False

    # ------------------------------------------------------------------
    # Sanity check — prompt_factory returns a prompt with an id
    # ------------------------------------------------------------------

    def test_prompt_factory_yields_created_prompt_with_id(self, prompt_factory):
        """
        GIVEN a test requests the prompt_factory fixture
        WHEN the factory is called to create a prompt
        THEN the returned object has a non-empty id attribute
        """
        prompt = prompt_factory(
            handle=f"e2e-factory-sanity-{uuid4().hex[:8]}",
            prompt="Sanity check prompt from prompt_factory fixture",
        )

        assert prompt is not None
        assert hasattr(prompt, "id")
        assert prompt.id  # non-empty / truthy

    # ------------------------------------------------------------------
    # Cleanup-on-raise proof — two-test sequence
    #
    # Test A (xfail strict): creates a prompt and raises.
    #   The fixture teardown must still delete the prompt.
    #
    # Test B: reads the prompt id recorded by test A and asserts it is gone.
    #
    # Ordering: CPython preserves method-definition order; pytest collects in
    # that order.  Test A is defined first, so it always runs before test B.
    # ------------------------------------------------------------------

    @pytest.mark.xfail(
        reason="intentional raise to prove prompt_factory cleans up on exception",
        strict=True,
    )
    def test_factory_creates_prompt_and_raises(self, prompt_factory, _shared_state):
        """
        GIVEN a test creates a prompt via prompt_factory
        WHEN the test body raises after creation
        THEN prompt_factory teardown still deletes the prompt
        (this test is marked xfail strict — it is expected to raise)
        """
        prompt = prompt_factory(
            handle=f"e2e-cleanup-raise-{uuid4().hex[:8]}",
            prompt="This prompt must be deleted by the fixture even though we raise",
        )

        # Record the id so the sibling proof test can verify deletion.
        _shared_state["prompt_id"] = prompt.id

        # Intentionally raise to simulate a test crash (CI kill, assertion, etc.)
        raise RuntimeError(
            "Intentional raise to verify construction-enforced cleanup (issue #3164)"
        )

    def test_previous_raising_test_still_cleaned_up_its_prompt(self, _shared_state):
        """
        GIVEN test_factory_creates_prompt_and_raises ran before this test
        AND it raised an exception after creating a prompt
        WHEN we look up the prompt id it recorded
        THEN the prompt no longer exists on the server (fixture cleaned it up)

        The SDK raises ValueError("... found ...") on 404 for a deleted
        prompt (see PromptsFacade.get). A successful cleanup therefore surfaces
        as that ValueError; any other outcome (the call succeeding, or a
        different exception) means the fixture failed to clean up.
        """
        prompt_id = _shared_state.get("prompt_id")
        if prompt_id is None:
            pytest.fail(
                "test_factory_creates_prompt_and_raises did not record a prompt id — "
                "check that it ran before this test"
            )

        with pytest.raises(ValueError, match="found"):
            langwatch.prompts.get(
                prompt_id, fetch_policy=FetchPolicy.ALWAYS_FETCH
            )
