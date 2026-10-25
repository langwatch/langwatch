"""An evaluation waits only on its own work, never on a fixed pause.

Every `time.sleep` in `base_evaluator` is recorded, so the assertion is exact
and does not depend on how fast the machine is.
"""

import pytest
from pydantic import Field

from langevals_core import base_evaluator
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    EvaluatorSettings,
    SingleEvaluationResult,
)


class InstantEntry(EvaluatorEntry):
    output: str = Field(default="")


class InstantSettings(EvaluatorSettings):
    pass


class InstantResult(EvaluationResult):
    pass


class InstantEvaluator(BaseEvaluator[InstantEntry, InstantSettings, InstantResult]):
    name = "Instant"
    category = "quality"
    env_vars = []
    is_guardrail = False
    default_settings = InstantSettings()

    def evaluate(self, entry: InstantEntry) -> SingleEvaluationResult:
        return InstantResult(score=1)


@pytest.fixture
def sleeps(monkeypatch):
    recorded: list[float] = []
    monkeypatch.setattr(base_evaluator.time, "sleep", recorded.append)
    return recorded


# @scenario "A batch evaluation does not pause before it starts"
def test_a_batch_takes_no_fixed_pause(sleeps):
    result = InstantEvaluator().evaluate_batch(
        [InstantEntry(output="a"), InstantEntry(output="b")]
    )

    assert [r.status for r in result] == ["processed", "processed"]
    assert sleeps == []


# @scenario "A single evaluation does not pause before it starts"
def test_a_single_entry_takes_no_fixed_pause(sleeps):
    result = InstantEvaluator()._evaluate_entry(InstantEntry(output="a"))

    assert result.status == "processed"
    assert sleeps == []
