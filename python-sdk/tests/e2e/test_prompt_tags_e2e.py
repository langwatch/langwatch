"""
End-to-End Tests for Prompt Tags

These tests verify that prompt tag operations work against the real API:
fetching by tag, assigning tags, and creating/updating prompts with tags.

Prerequisites:
- LANGWATCH_API_KEY environment variable must be set
- The LangWatch server must have tag support deployed
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
class TestPromptTagsE2E:
    """
    End-to-end tests for prompt tag operations.

    To run these tests:
        export LANGWATCH_API_KEY="your-api-key"
        pytest tests/e2e/test_prompt_tags_e2e.py -v
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

    def test_assign_tag_then_fetch_by_tag(self):
        """
        GIVEN a prompt with a version on the server
        WHEN I assign the "production" tag to that version
        AND I fetch the prompt with tag="production"
        THEN I receive the tagged version
        """
        handle = f"e2e-tag-assign-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Hello from tag assignment e2e test",
        )

        try:
            # Assign "production" tag to the created version
            langwatch.prompts.tags.assign(
                handle,
                tag="production",
                version_id=created.version_id,
            )

            # Fetch by tag
            fetched = langwatch.prompts.get(handle, tag="production")

            assert fetched is not None
            assert fetched.handle == handle
            assert fetched.version_id == created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    def test_fetch_without_tag_returns_latest(self):
        """
        GIVEN a prompt with two versions, where "production" is assigned to v1
        WHEN I fetch without a tag
        THEN I receive the latest version (v2), not the tagged one
        """
        handle = f"e2e-tag-latest-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Version 1 content",
        )

        try:
            # Assign production to v1
            langwatch.prompts.tags.assign(
                handle,
                tag="production",
                version_id=created.version_id,
            )

            # Update to create v2
            updated = langwatch.prompts.update(
                handle,
                scope="PROJECT",
                commit_message="Create v2 for tag test",
                prompt="Version 2 content",
            )

            # Fetch without tag -- expect latest (v2)
            fetched = langwatch.prompts.get(handle)

            assert fetched is not None
            assert fetched.version_id == updated.version_id
            assert fetched.version_id != created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    def test_create_prompt_with_tags(self):
        """
        GIVEN a new prompt
        WHEN I create it with tags=["production"]
        THEN the created version has the production tag assigned
        AND fetching by tag="production" returns it
        """
        handle = f"e2e-create-tags-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Created with production tag",
            tags=["production"],
        )

        try:
            # Fetch by tag to verify assignment
            fetched = langwatch.prompts.get(handle, tag="production")

            assert fetched is not None
            assert fetched.handle == handle
            assert fetched.version_id == created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    def test_update_prompt_with_tags(self):
        """
        GIVEN an existing prompt
        WHEN I update it with tags=["staging"]
        THEN fetching by tag="staging" returns the updated version
        """
        handle = f"e2e-update-tags-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Original content",
        )

        try:
            updated = langwatch.prompts.update(
                handle,
                scope="PROJECT",
                commit_message="Update with staging tag",
                prompt="Updated with staging tag",
                tags=["staging"],
            )

            # Fetch by staging tag
            fetched = langwatch.prompts.get(handle, tag="staging")

            assert fetched is not None
            assert fetched.handle == handle
            assert fetched.version_id == updated.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    def test_fetch_by_explicit_version_number(self):
        """
        GIVEN a prompt with two versions
        WHEN I fetch with version_number=1
        THEN I receive version 1, not the latest
        """
        handle = f"e2e-version-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Version 1",
        )

        try:
            langwatch.prompts.update(
                handle,
                scope="PROJECT",
                commit_message="Create v2",
                prompt="Version 2",
            )

            # Fetch v1 explicitly
            fetched = langwatch.prompts.get(handle, version_number=1)

            assert fetched is not None
            assert fetched.version == 1
            assert fetched.version_id == created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    @pytest.mark.skip(reason="Server-side shorthand parsing not yet deployed to e2e environment")
    def test_shorthand_version_passes_through_as_id(self):
        """
        GIVEN a prompt with two versions
        WHEN SDK calls get("handle:1")
        THEN the API resolves version 1 via shorthand
        """
        handle = f"e2e-shorthand-ver-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Version 1",
        )

        try:
            langwatch.prompts.update(
                handle,
                scope="PROJECT",
                commit_message="Create v2",
                prompt="Version 2",
            )

            # Use version shorthand - SDK passes "handle:1" to the API
            fetched = langwatch.prompts.get(f"{handle}:1")

            assert fetched is not None
            assert fetched.version == 1
            assert fetched.version_id == created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    @pytest.mark.skip(reason="Server-side shorthand parsing not yet deployed to e2e environment")
    def test_shorthand_syntax_passes_through_as_id(self):
        """
        GIVEN a prompt with a tag assigned via explicit assign
        WHEN SDK calls get("handle:production")
        THEN the full string "handle:production" is passed as the ID to the API
        AND the API resolves it server-side
        """
        handle = f"e2e-shorthand-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Shorthand test",
        )

        try:
            # Assign tag explicitly first (create-with-tags may have timing issues)
            langwatch.prompts.tags.assign(
                handle,
                tag="production",
                version_id=created.version_id,
            )

            # Use the shorthand syntax - the SDK passes it through to the API
            fetched = langwatch.prompts.get(f"{handle}:production")

            assert fetched is not None
            assert fetched.handle == handle
            assert fetched.version_id == created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)
