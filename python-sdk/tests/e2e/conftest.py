"""
pytest configuration and fixtures for e2e tests.

Provides:
- prompt_factory: function-scoped fixture that creates prompts and guarantees
  cleanup in teardown, even when the test body raises (issue #3164).
- _session_prompt_registry: session-scoped safety-net that deletes any prompts
  created by this session that were not cleaned up by their per-test teardown.
"""

import logging
from typing import Any, Callable, List

import pytest

import langwatch
from langwatch.generated.langwatch_rest_api_client.errors import UnexpectedStatus

logger = logging.getLogger(__name__)


def _delete_prompt_with_narrow_handling(prompt_id: str, context: str) -> None:
    """
    Delete a single prompt, distinguishing 404 (already gone) from real errors.

    - ``UnexpectedStatus`` with status_code 404 → debug log, continue
    - ``UnexpectedStatus`` with any other status_code → warning log, continue
    - Any other exception (network, etc.) → warning log, continue

    Never raises — callers iterate lists and must clean up all remaining ids.
    """
    try:
        langwatch.prompts.delete(prompt_id)
        logger.info(
            "%s: deleted prompt on teardown",
            context,
            extra={"prompt_id": prompt_id},
        )
    except UnexpectedStatus as exc:
        if exc.status_code == 404:
            logger.debug(
                "%s: prompt already gone (404), skipping",
                context,
                extra={"prompt_id": prompt_id},
            )
        else:
            logger.warning(
                "%s: failed to delete prompt (HTTP %s), continuing cleanup",
                context,
                exc.status_code,
                extra={"prompt_id": prompt_id, "status_code": exc.status_code},
            )
    except Exception as exc:
        logger.warning(
            "%s: failed to delete prompt (%s: %s), continuing cleanup",
            context,
            type(exc).__name__,
            exc,
            extra={"prompt_id": prompt_id},
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
