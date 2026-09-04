"""Step posts that fail are retried, buffered and resent.

Spec: specs/python-sdk/dspy-gepa-tracking.feature
"""

import json

import httpx
import pytest

import langwatch
import langwatch.dspy
from langwatch.dspy import (
    DSPyOptimizer,
    LangWatchGEPACallback,
    langwatch_dspy,
)

from .helpers import Program, tracked_optimizer, valset_of


class Posts:
    """The step posts made so far, answered with `statuses` in order, then 200."""

    def __init__(self):
        self.statuses: list[int] = []
        self.bodies: list[list[dict]] = []

    def post(self, url, **kwargs):
        self.bodies.append(json.loads(kwargs["data"]))
        return httpx.Response(
            self.statuses.pop(0) if self.statuses else 200,
            request=httpx.Request("POST", url),
        )


@pytest.fixture
def posts(monkeypatch) -> Posts:
    """A tracker with a run and no waits between step post retries."""
    posts = Posts()

    langwatch_dspy.run_id = "run"
    langwatch_dspy.experiment_slug = "experiment"
    langwatch_dspy.workflow_version_id = None
    langwatch_dspy.reset()
    monkeypatch.setattr(langwatch, "get_api_key", lambda: "key")
    monkeypatch.setattr(langwatch.dspy.httpx, "post", posts.post)
    monkeypatch.setattr(langwatch.dspy.time, "sleep", lambda seconds: None)
    return posts


def log_a_step(index: str) -> None:
    langwatch_dspy.log_step(
        optimizer=DSPyOptimizer(name="GEPA", parameters={}),
        index=index,
        score=1.0,
        label="score",
        predictors=[],
    )


class TestWhenTheStepPostFails:
    # @scenario "A step that could not be sent goes out with the next one"
    def test_resends_the_step_with_the_next_one(self, posts):
        posts.statuses.extend([502, 502, 502, 502, 502])

        with pytest.raises(Exception):
            log_a_step("0")

        assert len(posts.bodies) == 5
        assert [step.index for step in langwatch_dspy.steps_buffer] == ["0"]

        log_a_step("1")

        assert [step["index"] for step in posts.bodies[-1]] == ["0", "1"]
        assert langwatch_dspy.steps_buffer == []

    # @scenario "The steps a failed post left behind are sent when the run ends"
    def test_flushes_the_buffer_when_the_run_ends(self, posts):
        posts.statuses.extend([502, 502, 502, 502, 502])
        with pytest.raises(Exception):
            log_a_step("0")
        callback = LangWatchGEPACallback(
            optimizer=tracked_optimizer(), student=Program(), valset=valset_of(1)
        )

        callback.on_optimization_end({})  # type: ignore[arg-type]

        assert [step["index"] for step in posts.bodies[-1]] == ["0"]
        assert langwatch_dspy.steps_buffer == []

        callback.on_optimization_end({})  # type: ignore[arg-type]

        assert len(posts.bodies) == 6
