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

    def test_create_prompt_with_multiple_tags(self):
        """
        GIVEN a new prompt
        WHEN I create it with tags=["production", "staging"]
        THEN fetching by each tag returns the created version
        """
        handle = f"e2e-multi-tags-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Created with multiple tags",
            tags=["production", "staging"],
        )

        try:
            fetched_prod = langwatch.prompts.get(handle, tag="production")
            fetched_staging = langwatch.prompts.get(handle, tag="staging")

            assert fetched_prod is not None
            assert fetched_prod.handle == handle
            assert fetched_prod.version_id == created.version_id

            assert fetched_staging is not None
            assert fetched_staging.handle == handle
            assert fetched_staging.version_id == created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    def test_assign_custom_tag_then_fetch_by_tag(self):
        """
        GIVEN a prompt with a version on the server
        WHEN I assign tag="canary" to that version
        AND I fetch the prompt with tag="canary"
        THEN I receive the tagged version
        """
        handle = f"e2e-custom-tag-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Hello from custom tag e2e test",
        )

        try:
            langwatch.prompts.tags.assign(
                handle,
                tag="canary",
                version_id=created.version_id,
            )

            fetched = langwatch.prompts.get(handle, tag="canary")

            assert fetched is not None
            assert fetched.handle == handle
            assert fetched.version_id == created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    def test_shorthand_syntax_with_custom_tag(self):
        """
        GIVEN a prompt with tag="canary" assigned
        WHEN SDK calls get("handle:canary")
        THEN the API resolves it server-side and returns the tagged version
        """
        handle = f"e2e-shorthand-canary-{uuid4().hex[:8]}"

        created = langwatch.prompts.create(
            handle=handle,
            prompt="Shorthand custom tag test",
        )

        try:
            langwatch.prompts.tags.assign(
                handle,
                tag="canary",
                version_id=created.version_id,
            )

            fetched = langwatch.prompts.get(f"{handle}:canary")

            assert fetched is not None
            assert fetched.handle == handle
            assert fetched.version_id == created.version_id
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)

    def test_create_list_delete_tag_round_trip(self):
        """
        GIVEN a unique tag name
        WHEN I create the tag, list tags, delete it, then list again
        THEN the tag appears in the first list and is absent from the second
        """
        tag_name = f"e2e-tag-{uuid4().hex[:8]}"

        created = langwatch.prompts.tags.create(tag_name)

        try:
            assert created["name"] == tag_name

            tags = langwatch.prompts.tags.list()
            tag_names = [t["name"] for t in tags]
            assert tag_name in tag_names
        finally:
            try:
                langwatch.prompts.tags.delete(tag_name)
            except Exception as e:
                logger.warning("Failed to delete tag %s: %s", tag_name, e)

        tags_after = langwatch.prompts.tags.list()
        tag_names_after = [t["name"] for t in tags_after]
        assert tag_name not in tag_names_after

    def test_rename_tag_round_trip(self):
        """
        GIVEN a tag named A
        WHEN I rename it to B
        THEN list() contains B and not A
        """
        tag_a = f"e2e-tag-a-{uuid4().hex[:8]}"
        tag_b = f"e2e-tag-b-{uuid4().hex[:8]}"

        langwatch.prompts.tags.create(tag_a)

        try:
            langwatch.prompts.tags.rename(tag_a, new_name=tag_b)

            tags = langwatch.prompts.tags.list()
            tag_names = [t["name"] for t in tags]
            assert tag_b in tag_names
            assert tag_a not in tag_names
        finally:
            try:
                langwatch.prompts.tags.delete(tag_b)
            except Exception as e:
                logger.warning("Failed to delete tag %s: %s", tag_b, e)

    def test_delete_tag_cascades_to_assignments(self):
        """
        GIVEN a prompt with a custom tag assigned
        WHEN I delete the tag
        THEN the tag no longer appears in list()
        AND the prompt still exists via get(handle)
        """
        tag_name = f"e2e-cascade-tag-{uuid4().hex[:8]}"
        handle = f"e2e-cascade-prompt-{uuid4().hex[:8]}"

        langwatch.prompts.tags.create(tag_name)
        created = langwatch.prompts.create(handle=handle, prompt="Cascade test")

        try:
            langwatch.prompts.tags.assign(
                handle,
                tag=tag_name,
                version_id=created.version_id,
            )

            langwatch.prompts.tags.delete(tag_name)

            tags_after = langwatch.prompts.tags.list()
            tag_names_after = [t["name"] for t in tags_after]
            assert tag_name not in tag_names_after

            fetched = langwatch.prompts.get(handle)
            assert fetched is not None
            assert fetched.handle == handle
        finally:
            try:
                langwatch.prompts.delete(created.id)
            except Exception as e:
                logger.warning("Failed to delete prompt %s: %s", created.id, e)
            try:
                langwatch.prompts.tags.delete(tag_name)
            except Exception:
                pass

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
