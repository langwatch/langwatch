"""Shared fixtures for e2e tests — guaranteed cleanup of prompts and tags."""
import logging

import pytest

import langwatch

logger = logging.getLogger(__name__)


@pytest.fixture
def prompt_factory():
    """Yield a callable that creates prompts and deletes them on teardown."""
    tracked_ids = []

    def _create(**kwargs):
        prompt = langwatch.prompts.create(**kwargs)
        tracked_ids.append(prompt.id)
        return prompt

    yield _create

    for pid in tracked_ids:
        try:
            langwatch.prompts.delete(pid)
        except Exception as exc:
            logger.warning("Failed to delete prompt %s during teardown: %s", pid, exc)


@pytest.fixture
def tag_factory():
    """Yield a callable that creates tags and deletes them on teardown."""
    tracked_names = []

    def _create(name):
        tag = langwatch.prompts.tags.create(name)
        tracked_names.append(name)
        return tag

    yield _create

    for name in tracked_names:
        try:
            langwatch.prompts.tags.delete(name)
        except Exception as exc:
            logger.warning("Failed to delete tag %s during teardown: %s", name, exc)
