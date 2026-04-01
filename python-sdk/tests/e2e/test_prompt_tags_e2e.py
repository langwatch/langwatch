"""
End-to-End Tests for Prompt Labels

These tests verify that prompt label operations work against the real API:
fetching by label, assigning labels, and creating/updating prompts with labels.

Prerequisites:
- LANGWATCH_API_KEY environment variable must be set
- The LangWatch server must have label support deployed
"""

import os
from dotenv import load_dotenv

load_dotenv()

import logging
from uuid import uuid4

import pytest

import langwatch
from langwatch.prompts.local_loader import LocalPromptLoader

logger = logging.getLogger(__name__)


@pytest.fixture
def api_key():
    """Ensure API key is available for e2e tests."""
    key = os.getenv("LANGWATCH_API_KEY")
    if not key:
        pytest.skip("LANGWATCH_API_KEY environment variable not set")
    return key


@pytest.mark.e2e
class TestPromptLabelsE2E:
    """
    End-to-end tests for prompt label operations.

    To run these tests:
        export LANGWATCH_API_KEY="your-api-key"
        pytest tests/e2e/test_prompt_labels_e2e.py -v
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

    def test_assign_label_then_fetch_by_label(self):
        """
        GIVEN a prompt with a version on the server
        WHEN I assign the "production" label to that version
        AND I fetch the prompt with label="production"
        THEN I receive the labeled version
        """
        handle = f"e2e-label-assign-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Hello from label assignment e2e test",
        )

        try:
            # Assign "production" label to the created version
            langwatch.prompts.labels.assign(
                handle,
                label="production",
                version_id=created.version_id,
            )

            # Fetch by label
            fetched = langwatch.prompts.get(f"{handle}:production")

            assert fetched is not None
            assert fetched.handle == handle
            assert fetched.version_id == created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    def test_fetch_without_label_returns_latest(self):
        """
        GIVEN a prompt with two versions, where "production" is assigned to v1
        WHEN I fetch without a label
        THEN I receive the latest version (v2), not the labeled one
        """
        handle = f"e2e-label-latest-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Version 1 content",
        )

        try:
            # Assign production to v1
            langwatch.prompts.labels.assign(
                handle,
                label="production",
                version_id=created.version_id,
            )

            # Update to create v2
            updated = langwatch.prompts.update(
                handle,
                scope="PROJECT",
                commit_message="Create v2 for label test",
                prompt="Version 2 content",
            )

            # Fetch without label — expect latest (v2)
            fetched = langwatch.prompts.get(handle)

            assert fetched is not None
            assert fetched.version_id == updated.version_id
            assert fetched.version_id != created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    def test_create_prompt_with_labels(self):
        """
        GIVEN a new prompt
        WHEN I create it with labels=["production"]
        THEN the created version has the production label assigned
        AND fetching by label="production" returns it
        """
        handle = f"e2e-create-labels-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Created with production label",
            labels=["production"],
        )

        try:
            # Fetch by label to verify assignment
            fetched = langwatch.prompts.get(f"{handle}:production")

            assert fetched is not None
            assert fetched.handle == handle
            assert fetched.version_id == created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    def test_update_prompt_with_labels(self):
        """
        GIVEN an existing prompt
        WHEN I update it with labels=["staging"]
        THEN fetching by label="staging" returns the updated version
        """
        handle = f"e2e-update-labels-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Original content",
        )

        try:
            updated = langwatch.prompts.update(
                handle,
                scope="PROJECT",
                commit_message="Update with staging label",
                prompt="Updated with staging label",
                labels=["staging"],
            )

            # Fetch by staging label
            fetched = langwatch.prompts.get(f"{handle}:staging")

            assert fetched is not None
            assert fetched.handle == handle
            assert fetched.version_id == updated.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)
