"""Step posts that fail are retried, buffered and resent — never raised.

A platform failure while posting a step must not fail the optimizer
evaluation the step reports: MIPROv2 and friends treat a raised evaluation
as a failed trial and record 0.0 for a candidate that was fully evaluated
(issue #7894). Transient failures (network blips, 5xx) are retried; client
errors are not. Either way the step stays buffered for the next post.

Spec: specs/python-sdk/dspy-gepa-tracking.feature
"""

import json
import logging

import httpx
import pytest

import langwatch
import langwatch.dspy
from langwatch.http_client import create_client
from langwatch.dspy import (
    DSPyOptimizer,
    LangWatchGEPACallback,
    langwatch_dspy,
)

from .helpers import Program, tracked_optimizer, valset_of


class Posts:
    """The step posts made so far, answered with `statuses` in order, then 200.

    A status may also be an exception instance, which is raised instead of
    answered — that is how a transport failure (timeout, refused connection)
    looks to the caller, as opposed to an HTTP status.
    """

    def __init__(self):
        self.statuses: list[int | Exception] = []
        self.bodies: list[list[dict]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.bodies.append(json.loads(request.content))
        answer = self.statuses.pop(0) if self.statuses else 200
        if isinstance(answer, Exception):
            raise answer
        return httpx.Response(answer)

    def client(self, **kwargs) -> httpx.Client:
        return create_client(transport=httpx.MockTransport(self.handle))


@pytest.fixture
def posts(monkeypatch) -> Posts:
    """A tracker with a run and no waits between step post retries."""
    posts = Posts()

    langwatch_dspy.run_id = "run"
    langwatch_dspy.experiment_slug = "experiment"
    langwatch_dspy.workflow_version_id = None
    langwatch_dspy.reset()
    monkeypatch.setattr(langwatch, "get_api_key", lambda: "key")
    monkeypatch.setattr(langwatch.dspy, "create_client", posts.client)
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
    def test_resends_the_step_with_the_next_one(self, posts, caplog):
        posts.statuses.extend([502, 502, 502])

        with caplog.at_level(logging.WARNING, logger="langwatch.dspy"):
            log_a_step("0")

        assert len(posts.bodies) == 3, "a 502 is retried before giving up"
        assert [step.index for step in langwatch_dspy.steps_buffer] == ["0"]
        assert "Could not log optimizer step 0" in caplog.text

        log_a_step("1")

        assert [step["index"] for step in posts.bodies[-1]] == ["0", "1"]
        assert langwatch_dspy.steps_buffer == []

    # @scenario "A network failure is retried and buffered like a server error"
    @pytest.mark.unit
    @pytest.mark.parametrize(
        "failure",
        [
            httpx.ConnectError("connection refused"),
            httpx.ReadTimeout("read operation timed out"),
        ],
        ids=["connect-error", "timeout"],
    )
    def test_retries_a_network_failure(self, posts, caplog, failure):
        posts.statuses.extend([failure, failure, failure])

        with caplog.at_level(logging.WARNING, logger="langwatch.dspy"):
            log_a_step("0")

        assert len(posts.bodies) == 3, "a transport failure is retried"
        assert [step.index for step in langwatch_dspy.steps_buffer] == ["0"]
        assert "Could not log optimizer step 0" in caplog.text

        log_a_step("1")

        assert [step["index"] for step in posts.bodies[-1]] == ["0", "1"]
        assert langwatch_dspy.steps_buffer == []

    # @scenario "A client error is a real answer, not a blip"
    @pytest.mark.unit
    def test_does_not_retry_a_client_error(self, posts, caplog):
        posts.statuses.extend([422])

        with caplog.at_level(logging.WARNING, logger="langwatch.dspy"):
            log_a_step("0")

        assert len(posts.bodies) == 1
        assert [step.index for step in langwatch_dspy.steps_buffer] == ["0"]
        assert "Could not log optimizer step 0" in caplog.text

    # @scenario "The buffer is bounded while the platform is down"
    @pytest.mark.unit
    def test_drops_the_oldest_steps_at_the_bound(self, posts, monkeypatch, caplog):
        monkeypatch.setattr(langwatch.dspy, "MAX_BUFFERED_STEPS", 2)
        posts.statuses.extend([502] * 12)

        with caplog.at_level(logging.WARNING, logger="langwatch.dspy"):
            for index in range(4):
                log_a_step(str(index))

        kept = [step.index for step in langwatch_dspy.steps_buffer]
        assert kept == ["2", "3"], "the newest steps win when the bound is hit"
        assert "Dropped" in caplog.text

    # @scenario "The steps a failed post left behind are sent when the run ends"
    def test_flushes_the_buffer_when_the_run_ends(self, posts):
        posts.statuses.extend([502, 502, 502])
        log_a_step("0")
        callback = LangWatchGEPACallback(
            optimizer=tracked_optimizer(), student=Program(), valset=valset_of(1)
        )

        callback.on_optimization_end({})  # type: ignore[arg-type]

        assert [step["index"] for step in posts.bodies[-1]] == ["0"]
        assert langwatch_dspy.steps_buffer == []

        callback.on_optimization_end({})  # type: ignore[arg-type]

        assert len(posts.bodies) == 4

    # @scenario "The end-of-run flush keeps trying while the platform is down"
    def test_keeps_trying_the_flush(self, posts):
        posts.statuses.extend([502] * 3)
        log_a_step("0")
        callback = LangWatchGEPACallback(
            optimizer=tracked_optimizer(), student=Program(), valset=valset_of(1)
        )

        posts.statuses.extend([502] * 11)
        callback.on_optimization_end({})  # type: ignore[arg-type]

        assert len(posts.bodies) == 3 + 12
        assert [step["index"] for step in posts.bodies[-1]] == ["0"]
        assert langwatch_dspy.steps_buffer == []

    # @scenario "The end-of-run flush keeps trying while the platform is down"
    def test_reports_the_steps_it_could_not_send(self, posts, capsys):
        posts.statuses.extend([502] * 3)
        log_a_step("0")
        callback = LangWatchGEPACallback(
            optimizer=tracked_optimizer(), student=Program(), valset=valset_of(1)
        )
        posts.bodies.clear()

        posts.statuses.extend([502] * 12)
        callback.on_optimization_end({})  # type: ignore[arg-type]

        assert len(posts.bodies) == 12
        assert [step.index for step in langwatch_dspy.steps_buffer] == ["0"]
        assert "1 step(s) of run run could not be sent" in capsys.readouterr().out
