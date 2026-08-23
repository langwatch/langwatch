"""Regression tests for the moderation evaluator answering a batch.

The evaluator sends the whole batch in two moderation calls and then walks the
two result lists together, so every entry has to be scored inside that walk.
A `continue` written at the loop's own indentation ended each iteration right
after the empty-entry check, which left the scoring code below the loop rather
than in it: it ran once, on whichever pair of results the loop happened to
leave behind, and appended a single result for the whole batch. A caller that
sends five entries got one answer, and that answer was the last entry's.

Every test the evaluator had sent exactly one entry, which is the size that
hides this: one entry means one iteration, so the leaked pair is the only
pair, and the single appended result is the right one.

These tests stub the provider, so they need no key, make no request over the
network and always give the same answer.
"""

import os

import pytest

os.environ.setdefault("OPENAI_API_KEY", "test-key-not-used")

from langevals_core.base_evaluator import EvaluationResultSkipped
from langevals_openai import moderation as moderation_module
from langevals_openai.moderation import (
    OpenAIModerationEntry,
    OpenAIModerationEvaluator,
)

# The one category these tests move. Everything else stays at zero, so a
# result's score is exactly what this fake gave the text it was built from.
VIOLENT = "kill them all"


class _FakeScores:
    def __init__(self, violence: float):
        self._violence = violence

    def model_dump(self):
        return {"violence": self._violence}


class _FakeResult:
    def __init__(self, text: str):
        self.category_scores = _FakeScores(0.9 if text == VIOLENT else 0.1)


class _FakeModerations:
    def __init__(self, calls: list[list[str]]):
        self._calls = calls

    def create(self, input: list[str]):
        self._calls.append(list(input))
        return type("_FakeResponse", (), {"results": [_FakeResult(t) for t in input]})()


class _FakeClient:
    def __init__(self, calls: list[list[str]]):
        self.moderations = _FakeModerations(calls)

    def with_options(self, **_kwargs):
        return self


@pytest.fixture
def calls(monkeypatch):
    """Every `input` list the evaluator sent, in order."""
    recorded: list[list[str]] = []
    monkeypatch.setattr(
        moderation_module, "OpenAI", lambda **_kwargs: _FakeClient(recorded)
    )
    return recorded


class TestGivenABatchOfSeveralEntries:
    # @scenario "A batch of several entries gets an answer each"
    def test_answers_once_per_entry(self, calls):
        evaluator = OpenAIModerationEvaluator()

        results = evaluator.evaluate_batch(
            data=[
                OpenAIModerationEntry(input="the weather is nice"),
                OpenAIModerationEntry(input="how do I return these shoes"),
                OpenAIModerationEntry(input=VIOLENT),
            ]
        )

        assert len(results) == 3
        assert [result.status for result in results] == ["processed"] * 3

    # @scenario "Each entry is scored from its own text"
    def test_scores_each_entry_from_its_own_text(self, calls):
        evaluator = OpenAIModerationEvaluator()

        results = evaluator.evaluate_batch(
            data=[
                OpenAIModerationEntry(input=VIOLENT),
                OpenAIModerationEntry(input="the weather is nice"),
            ]
        )

        # The unsafe entry is first, so a run that reads the LAST pair of
        # results reports the whole batch as safe.
        assert results[0].score == pytest.approx(0.9)
        assert results[0].passed is False
        assert results[1].score == pytest.approx(0.1)
        assert results[1].passed is True

    # @scenario "Every entry travels in the same two calls"
    def test_sends_the_whole_batch_in_two_calls(self, calls):
        evaluator = OpenAIModerationEvaluator()

        evaluator.evaluate_batch(
            data=[
                OpenAIModerationEntry(input="first", output="first out"),
                OpenAIModerationEntry(input="second", output="second out"),
            ]
        )

        assert calls == [["first", "second"], ["first out", "second out"]]


class TestGivenAnEmptyEntryAmongFullOnes:
    # @scenario "An empty entry is skipped without moving the others"
    def test_skips_it_and_keeps_the_others_in_place(self, calls):
        evaluator = OpenAIModerationEvaluator()

        results = evaluator.evaluate_batch(
            data=[
                OpenAIModerationEntry(input=VIOLENT),
                OpenAIModerationEntry(),
                OpenAIModerationEntry(input="the weather is nice"),
            ]
        )

        assert len(results) == 3
        assert isinstance(results[1], EvaluationResultSkipped)
        assert results[0].score == pytest.approx(0.9)
        assert results[2].score == pytest.approx(0.1)
