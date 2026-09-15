"""
Unit tests for the entry size check every Ragas evaluator runs before it
calls the judge. No API keys and no network: the token count is patched.

Spec: specs/evaluators/ragas-max-tokens.feature
"""

from unittest.mock import patch

from langevals_core.base_evaluator import MAX_TOKENS_HARD_LIMIT
from langevals_ragas.lib.common import RagasSettings, check_max_tokens


def _check_with(total_tokens: int, max_tokens: int):
    with patch(
        "langevals_ragas.lib.common.calculate_total_tokens",
        return_value=total_tokens,
    ):
        return check_max_tokens(
            input="question",
            output="answer",
            contexts=["context"],
            settings=RagasSettings(
                model="anthropic/claude-sonnet-4-5", max_tokens=max_tokens
            ),
        )


# @scenario "An entry within the configured max tokens is evaluated"
def test_an_entry_within_the_configured_limit_is_not_skipped():
    assert _check_with(total_tokens=23000, max_tokens=64000) is None


# @scenario "An entry over the configured max tokens is skipped with the configured limit in the reason"
def test_an_entry_over_the_configured_limit_is_skipped_naming_that_limit():
    result = _check_with(total_tokens=70000, max_tokens=64000)

    assert result is not None
    assert result.status == "skipped"
    assert result.details == "Total tokens exceed the maximum of 64000: 70000"


# @scenario "The shared hard limit still bounds the setting"
def test_the_shared_hard_limit_bounds_the_setting():
    result = _check_with(
        total_tokens=MAX_TOKENS_HARD_LIMIT + 1, max_tokens=MAX_TOKENS_HARD_LIMIT * 2
    )

    assert result is not None
    assert result.status == "skipped"
    assert f"maximum of {MAX_TOKENS_HARD_LIMIT}:" in (result.details or "")
