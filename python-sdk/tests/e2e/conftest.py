"""
pytest configuration and fixtures for e2e tests.

Provides:
- prompt_factory: function-scoped fixture that creates prompts and guarantees
  cleanup in teardown, even when the test body raises (issue #3164).
- _prompt_leak_sweeper: session-scoped autouse fixture that deletes any
  leftover e2e-prefixed prompts at the end of the test session.
"""

import logging
from typing import Any, Callable, List

import pytest

import langwatch

logger = logging.getLogger(__name__)


@pytest.fixture
def prompt_factory() -> Callable[..., Any]:
    """
    Function-scoped factory fixture for creating prompts with guaranteed cleanup.

    Returns a callable that accepts the same keyword arguments as
    ``langwatch.prompts.create(**kwargs)``.  Every prompt created through the
    factory is tracked and deleted during fixture teardown — including when the
    test body raises an exception (construction-enforced cleanup, issue #3164).

    Usage::

        def test_something(prompt_factory):
            prompt = prompt_factory(
                handle="e2e-my-prompt",
                prompt="Hello world",
            )
            assert prompt.id
    """
    created_ids: List[str] = []

    def create(**kwargs: Any) -> Any:
        """Create a prompt and register it for teardown cleanup."""
        prompt = langwatch.prompts.create(**kwargs)
        created_ids.append(prompt.id)
        logger.info(
            "prompt_factory: created prompt",
            extra={"prompt_id": prompt.id, "handle": kwargs.get("handle")},
        )
        return prompt

    yield create

    # Teardown — runs even when the test body raised.
    for prompt_id in created_ids:
        try:
            langwatch.prompts.delete(prompt_id)
            logger.info(
                "prompt_factory: deleted prompt on teardown",
                extra={"prompt_id": prompt_id},
            )
        except Exception as exc:
            # A 404 means the test already deleted the prompt itself — that is
            # fine.  Any other error is logged as a warning so it doesn't mask
            # the original test failure.
            logger.warning(
                "prompt_factory: failed to delete prompt on teardown (already deleted or error)",
                extra={"prompt_id": prompt_id, "error": str(exc)},
            )


@pytest.fixture(scope="session", autouse=True)
def _prompt_leak_sweeper() -> None:
    """
    Session-scoped safety-net that deletes leftover e2e-prefixed prompts.

    Runs after all tests complete.  Matches prompts whose handle starts with
    ``e2e-`` to avoid touching unrelated data.  Errors are swallowed so a
    sweep failure never breaks the session teardown.
    """
    yield  # let all tests run first

    try:
        from langwatch.generated.langwatch_rest_api_client.api.default import (
            get_api_prompts,
        )
        from langwatch.state import get_instance

        instance = get_instance()
        if instance is None:
            logger.debug("_prompt_leak_sweeper: LangWatch not set up, skipping sweep")
            return

        resp = get_api_prompts.sync_detailed(client=instance.rest_api_client)
        if int(resp.status_code) != 200 or not isinstance(resp.parsed, list):
            logger.warning(
                "_prompt_leak_sweeper: could not list prompts (status %s), skipping sweep",
                resp.status_code,
            )
            return

        e2e_prompts = [
            item
            for item in resp.parsed
            if isinstance(item.handle, str) and item.handle.startswith("e2e-")
        ]

        if not e2e_prompts:
            logger.debug("_prompt_leak_sweeper: no e2e-prefixed prompts found, nothing to sweep")
            return

        logger.info(
            "_prompt_leak_sweeper: sweeping %d e2e-prefixed prompt(s)",
            len(e2e_prompts),
        )

        for item in e2e_prompts:
            try:
                langwatch.prompts.delete(item.id)
                logger.info(
                    "_prompt_leak_sweeper: deleted leaked prompt",
                    extra={"prompt_id": item.id, "handle": item.handle},
                )
            except Exception as exc:
                logger.warning(
                    "_prompt_leak_sweeper: failed to delete prompt %s (%s): %s",
                    item.id,
                    item.handle,
                    exc,
                )
    except Exception as exc:
        logger.warning("_prompt_leak_sweeper: sweep failed unexpectedly: %s", exc)
