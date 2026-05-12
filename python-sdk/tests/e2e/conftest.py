"""
pytest configuration and fixtures for e2e tests.

Provides:
- prompt_factory: function-scoped fixture that creates prompts and guarantees
  cleanup in teardown, even when the test body raises (issue #3164).
- _session_prompt_registry: session-scoped safety-net that deletes any prompts
  created by this session that were not cleaned up by their per-test teardown.
- tag_factory: function-scoped fixture that creates prompt tags and deletes
  them on teardown (issue #3108).
"""

import logging
from typing import Any, Callable, List

import pytest

import langwatch

logger = logging.getLogger(__name__)


def _delete_prompt_with_narrow_handling(prompt_id: str, context: str) -> None:
    """
    Delete a single prompt, distinguishing 404 (already gone) from real errors.

    ``langwatch.prompts.delete`` routes 404 responses through
    ``unwrap_response``, which raises ``ValueError("Prompt not found: ...")``
    (see ``langwatch.prompts.errors``).  We key off that message to treat
    already-gone prompts as a debug-level no-op.

    - ``ValueError`` whose message starts with "Prompt not found" → debug log
    - Any other ``ValueError`` (e.g. 400) → warning log, continue
    - Any other exception (network, 5xx, etc.) → warning log, continue

    Never raises — callers iterate lists and must clean up all remaining ids.
    """
    try:
        langwatch.prompts.delete(prompt_id)
        logger.info(
            "%s: deleted prompt on teardown",
            context,
            extra={"prompt_id": prompt_id},
        )
    except ValueError as exc:
        if str(exc).startswith("Prompt not found"):
            logger.debug(
                "%s: prompt already gone (404), skipping",
                context,
                extra={"prompt_id": prompt_id},
            )
        else:
            logger.warning(
                "%s: failed to delete prompt (ValueError: %s), continuing cleanup",
                context,
                exc,
                extra={"prompt_id": prompt_id},
            )
    except Exception as exc:
        logger.warning(
            "%s: failed to delete prompt (%s: %s), continuing cleanup",
            context,
            type(exc).__name__,
            exc,
            extra={"prompt_id": prompt_id},
        )


def _delete_tag_with_narrow_handling(name: str, context: str) -> None:
    """
    Delete a single tag, distinguishing 404 (already gone) from real errors.

    ``langwatch.prompts.tags.delete`` routes 404 responses through the same
    ``unwrap_response`` helper as prompts, which raises
    ``ValueError("Prompt not found: ...")`` regardless of the resource type
    (see ``langwatch.prompts.errors``).  Tag teardown routinely encounters
    this when a test deletes the tag itself as part of the assertion
    (e.g. ``test_delete_tag_cascades_to_assignments``).

    Never raises — callers iterate lists and must clean up all remaining names.
    """
    try:
        langwatch.prompts.tags.delete(name)
        logger.info(
            "%s: deleted tag on teardown",
            context,
            extra={"tag_name": name},
        )
    except ValueError as exc:
        if str(exc).startswith("Prompt not found"):
            logger.debug(
                "%s: tag already gone (404), skipping",
                context,
                extra={"tag_name": name},
            )
        else:
            logger.warning(
                "%s: failed to delete tag (ValueError: %s), continuing cleanup",
                context,
                exc,
                extra={"tag_name": name},
            )
    except Exception as exc:  # noqa: BLE001 - teardown must never raise.
        logger.warning(
            "%s: failed to delete tag (%s: %s), continuing cleanup",
            context,
            type(exc).__name__,
            exc,
            extra={"tag_name": name},
        )


@pytest.fixture(scope="session")
def _session_prompt_registry() -> List[str]:
    """
    Session-scoped safety-net registry of all prompt ids created this session.

    The function-scoped ``prompt_factory`` appends to this list in addition to
    its own per-test list.  At session end, any ids still in the registry are
    deleted.  This catches prompts whose per-test teardown was skipped (e.g.
    SIGKILL, process kill).

    Unlike the old prefix-scan sweeper, this registry is collision-free — it
    only touches ids created by *this* session, not prompts from other
    concurrent CI runs on the same tenant.
    """
    registry: List[str] = []
    yield registry

    if not registry:
        logger.debug("_session_prompt_registry: no prompts to sweep, skipping")
        return

    logger.info(
        "_session_prompt_registry: sweeping %d prompt(s) left in session registry",
        len(registry),
    )
    for prompt_id in registry:
        _delete_prompt_with_narrow_handling(prompt_id, "_session_prompt_registry")


@pytest.fixture
def prompt_factory(_session_prompt_registry: List[str]) -> Callable[..., Any]:
    """
    Function-scoped factory fixture for creating prompts with guaranteed cleanup.

    Returns a callable that accepts the same keyword arguments as
    ``langwatch.prompts.create(**kwargs)``.  Every prompt created through the
    factory is tracked and deleted during fixture teardown — including when the
    test body raises an exception (construction-enforced cleanup, issue #3164).

    Usage::

        from uuid import uuid4

        def test_something(prompt_factory):
            prompt = prompt_factory(
                handle=f"e2e-my-prompt-{uuid4().hex[:8]}",
                prompt="Hello world",
            )
            assert prompt.id
    """
    created_ids: List[str] = []

    def create(**kwargs: Any) -> Any:
        """Create a prompt and register it for teardown cleanup."""
        prompt = langwatch.prompts.create(**kwargs)
        created_ids.append(prompt.id)
        _session_prompt_registry.append(prompt.id)
        logger.info(
            "prompt_factory: created prompt",
            extra={"prompt_id": prompt.id, "handle": kwargs.get("handle")},
        )
        return prompt

    yield create

    # Teardown — runs even when the test body raised.
    for prompt_id in created_ids:
        _delete_prompt_with_narrow_handling(prompt_id, "prompt_factory")
        # Remove from session registry so session-end sweep doesn't double-delete.
        try:
            _session_prompt_registry.remove(prompt_id)
        except ValueError:
            pass  # already removed or never added (shouldn't happen)


@pytest.fixture
def tag_factory() -> Callable[[str], Any]:
    """
    Function-scoped factory fixture for creating prompt tags with guaranteed cleanup.

    Returns a callable that accepts a tag ``name`` and creates it via
    ``langwatch.prompts.tags.create(name)``.  Every tag created through the
    factory is deleted during fixture teardown, even when the test body raises.
    """
    tracked_names: List[str] = []

    def _create(name: str) -> Any:
        tag = langwatch.prompts.tags.create(name)
        tracked_names.append(name)
        return tag

    yield _create

    for name in tracked_names:
        _delete_tag_with_narrow_handling(name, "tag_factory")
