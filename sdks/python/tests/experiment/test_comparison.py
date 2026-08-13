"""Unit tests for ``Experiment.compare`` / ``Experiment.acompare``.

These stub the HTTP boundary of the evaluation transport, so every assertion
is on what the SDK actually puts on the wire: which keys the judge request
carries, which it deliberately leaves out so the judge's own defaults apply,
and the shape of the evaluation entry the verdict is recorded as.

Specs: specs/experiments/comparison-sdk.feature
"""

import inspect
import json
import time
from dataclasses import fields
from pathlib import Path
from typing import Any, Dict, List, Optional, get_args, get_type_hints

import pytest

import langwatch
import langwatch.evaluation
from langwatch.experiment import ComparisonStatus, ComparisonVerdict
from langwatch.experiment.experiment import (
    COMPARISON_EVALUATOR,
    Experiment,
    _target_context,
)

pytestmark = pytest.mark.unit


class _FakeResponse:
    def __init__(self, body: Dict[str, Any]):
        self._body = body

    def raise_for_status(self) -> None:
        return None

    def json(self) -> Dict[str, Any]:
        return self._body


class _Judge:
    """Stands in for the judge endpoint and records what reached it."""

    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.async_calls: List[Dict[str, Any]] = []
        self.unreachable: Optional[Exception] = None
        self.response: Dict[str, Any] = {
            "status": "processed",
            "score": 1.0,
            "label": "gpt-5-mini",
            "details": "It answers the question directly.",
        }

    @property
    def call_count(self) -> int:
        return len(self.calls) + len(self.async_calls)

    @property
    def last(self) -> Dict[str, Any]:
        assert self.call_count == 1, f"expected one judge call, got {self.call_count}"
        return (self.calls + self.async_calls)[0]

    def body(self, call: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return (call or self.last)["json"]

    def data(self, call: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self.body(call)["data"]

    def settings(self, call: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self.body(call)["settings"]

    def candidate_ids(self, call: Optional[Dict[str, Any]] = None) -> List[str]:
        return [candidate["id"] for candidate in self.data(call)["candidates"]]


@pytest.fixture
def judge(monkeypatch) -> _Judge:
    """Stub the evaluation transport and capture what the judge was sent."""
    stub = _Judge()

    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args: Any):
            return False

        def post(self, **kwargs: Any) -> _FakeResponse:
            stub.calls.append(kwargs)
            if stub.unreachable is not None:
                raise stub.unreachable
            return _FakeResponse(stub.response)

    class _FakeAsyncClient:
        def __init__(self, *args: Any, **kwargs: Any):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args: Any):
            return False

        async def post(self, **kwargs: Any) -> _FakeResponse:
            stub.async_calls.append(kwargs)
            if stub.unreachable is not None:
                raise stub.unreachable
            return _FakeResponse(stub.response)

    class _FakeSpanContext:
        is_valid = True
        trace_id = 12345
        span_id = 67890

    class _FakeSpan:
        def __enter__(self):
            return self

        def __exit__(self, *args: Any):
            return False

        def update(self, *args: Any, **kwargs: Any) -> None:
            return None

        def get_span_context(self) -> _FakeSpanContext:
            return _FakeSpanContext()

    monkeypatch.setattr(langwatch.evaluation.httpx, "Client", _FakeClient)
    monkeypatch.setattr(langwatch.evaluation.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(
        langwatch.evaluation, "get_endpoint", lambda: "https://app.langwatch.test"
    )
    monkeypatch.setattr(langwatch.evaluation, "get_api_key", lambda: "test-api-key")
    monkeypatch.setattr(langwatch.evaluation, "get_instance", lambda: None)
    monkeypatch.setattr(
        langwatch.evaluation, "get_current_span", lambda: _FakeSpan()
    )
    monkeypatch.setattr(
        langwatch.evaluation.langwatch, "span", lambda **kwargs: _FakeSpan()
    )

    return stub


@pytest.fixture
def experiment() -> Experiment:
    """An experiment that never flushes its batch during a test."""
    _target_context.set(None)
    exp = Experiment("comparison-test")
    exp.initialized = True
    exp._current_index = 0
    exp._current_item = {"question": "What is the capital of the Netherlands?"}
    exp.last_sent = time.time() + 100000
    return exp


def record(
    experiment: Experiment,
    index: int,
    outputs: Dict[str, Optional[Any]],
) -> None:
    """Run each target on a row, recording the output it produced."""
    experiment._current_index = index
    for name, output in outputs.items():
        with experiment.target(name):
            if output is not None:
                experiment.log_response(output)


def three_targets(experiment: Experiment, index: int = 0) -> None:
    record(
        experiment,
        index,
        {
            "gpt-5-mini": "Amsterdam.",
            "claude-sonnet-5": "The capital is Amsterdam.",
            "gemini-flash": "Amsterdam is the capital.",
        },
    )


def evaluations(experiment: Experiment) -> List[Any]:
    return experiment.batch["evaluations"]


def only_evaluation(experiment: Experiment) -> Any:
    entries = evaluations(experiment)
    assert len(entries) == 1, f"expected one evaluation entry, got {len(entries)}"
    return entries[0]


def wire_entry(entry: Any) -> Dict[str, Any]:
    """The evaluation entry exactly as ``_send_batch`` serializes it."""
    dumped = entry.model_dump(exclude_none=True, exclude_unset=True)
    dumped["inputs"] = dumped.pop("data")
    return dumped


class TestGivenEveryTargetRecordedAnOutput:
    # @scenario "Comparing every target on a row takes one call"
    def test_judges_every_recorded_output_in_a_single_call(self, experiment, judge):
        three_targets(experiment)

        verdict = experiment.compare(0)

        assert judge.call_count == 1
        assert judge.candidate_ids() == [
            "gpt-5-mini",
            "claude-sonnet-5",
            "gemini-flash",
        ]
        assert verdict.candidates == [
            "gpt-5-mini",
            "claude-sonnet-5",
            "gemini-flash",
        ]
        # Neither the candidates nor a judge prompt had to be named.
        assert "prompt" not in judge.settings()

    # @scenario "The verdict names the winning target"
    def test_verdict_names_the_winning_target(self, experiment, judge):
        three_targets(experiment)
        judge.response = {
            "status": "processed",
            "score": 1.0,
            "label": "claude-sonnet-5",
            "details": "It names the city and answers in a full sentence.",
        }

        verdict = experiment.compare(0)

        assert verdict.status == "decided"
        assert verdict.winner == "claude-sonnet-5"
        assert verdict.winner in experiment._targets
        assert verdict.reasoning == (
            "It names the city and answers in a full sentence."
        )

    # @scenario "The verdict belongs to the row, not to a target"
    def test_verdict_is_recorded_against_the_row_with_no_target(
        self, experiment, judge
    ):
        three_targets(experiment)

        with experiment.target("gpt-5-mini"):
            experiment.compare(0)

        entry = only_evaluation(experiment)
        assert entry.target_id is None
        assert entry.index == 0
        assert entry.evaluator == COMPARISON_EVALUATOR
        assert entry.name == "comparison"
        assert "target_id" not in wire_entry(entry)
        assert wire_entry(entry)["inputs"] == {
            "candidates": [
                {"id": "gpt-5-mini"},
                {"id": "claude-sonnet-5"},
                {"id": "gemini-flash"},
            ]
        }

    # @scenario "Candidate order is seeded from the row automatically"
    def test_row_index_seeds_the_candidate_order(self, experiment, judge):
        three_targets(experiment, index=0)
        three_targets(experiment, index=1)

        experiment.compare(0)
        experiment.compare(0)
        experiment.compare(1)

        seeds = [judge.data(call)["row_index"] for call in judge.calls]
        assert seeds == [0, 0, 1]

    def test_reads_outputs_the_batch_has_already_flushed(self, experiment, judge):
        three_targets(experiment)
        # What compare() needs is gone from the batch the moment it is sent.
        experiment.batch["dataset"].clear()

        verdict = experiment.compare(0)

        assert judge.candidate_ids() == [
            "gpt-5-mini",
            "claude-sonnet-5",
            "gemini-flash",
        ]
        assert verdict.status == "decided"

    def test_forgets_rows_the_run_has_moved_far_past(self, experiment, judge):
        """The bound lives entirely in _record_row_output, so the rows are fed
        to it directly. Driving them through target() would open a real span
        per target per row to prove one eviction rule."""
        from langwatch.experiment.experiment import _MAX_TRACKED_OUTPUT_ROWS

        for index in range(_MAX_TRACKED_OUTPUT_ROWS + 5):
            for name, output in (("gpt-5-mini", "a"), ("claude-sonnet-5", "b")):
                experiment._record_row_output(
                    index=index, target=name, predicted={"output": output}
                )

        assert len(experiment._row_outputs) == _MAX_TRACKED_OUTPUT_ROWS
        assert 0 not in experiment._row_outputs
        assert _MAX_TRACKED_OUTPUT_ROWS + 4 in experiment._row_outputs


class TestGivenATargetProducedNoOutput:
    # @scenario "Only targets with an output become candidates"
    def test_only_targets_with_an_output_become_candidates(self, experiment, judge):
        record(
            experiment,
            0,
            {
                "gpt-5-mini": "Amsterdam.",
                "claude-sonnet-5": "The capital is Amsterdam.",
                "gemini-flash": None,
            },
        )
        judge.response = {
            "status": "processed",
            "score": 1.0,
            "label": "gpt-5-mini",
            "details": "Shorter and correct.",
        }

        verdict = experiment.compare(0)

        assert judge.candidate_ids() == ["gpt-5-mini", "claude-sonnet-5"]
        assert verdict.candidates == ["gpt-5-mini", "claude-sonnet-5"]
        assert verdict.winner == "gpt-5-mini"

    # @scenario "Naming a target that produced no output is an error"
    def test_naming_a_target_without_an_output_is_an_error(self, experiment, judge):
        record(
            experiment,
            0,
            {
                "gpt-5-mini": "Amsterdam.",
                "claude-sonnet-5": "The capital is Amsterdam.",
                "gemini-flash": None,
            },
        )

        with pytest.raises(ValueError, match="gemini-flash"):
            experiment.compare(
                0, targets=["gpt-5-mini", "claude-sonnet-5", "gemini-flash"]
            )

        assert judge.call_count == 0

    # @scenario "A row with fewer than two outputs is skipped, not failed"
    def test_a_row_with_one_output_is_skipped_not_failed(self, experiment, judge):
        record(
            experiment,
            0,
            {
                "gpt-5-mini": "Amsterdam.",
                "claude-sonnet-5": None,
                "gemini-flash": None,
            },
        )

        verdict = experiment.compare(0)

        assert judge.call_count == 0
        assert verdict.status == "skipped"
        assert verdict.winner is None
        assert verdict.candidates == ["gpt-5-mini"]
        assert "at least two candidate outputs" in (verdict.reasoning or "")
        assert "claude-sonnet-5" in (verdict.reasoning or "")
        assert "gemini-flash" in (verdict.reasoning or "")

        entry = only_evaluation(experiment)
        assert entry.status == "skipped"
        assert entry.target_id is None
        assert entry.details == verdict.reasoning
        assert wire_entry(entry)["inputs"] == {"candidates": [{"id": "gpt-5-mini"}]}

        # The run survives the unjudgeable row.
        three_targets(experiment, index=1)
        assert experiment.compare(1).status == "decided"


class TestGivenASubsetOfTargets:
    # @scenario "Comparing a subset of the registered targets"
    def test_compares_only_the_targets_i_named(self, experiment, judge):
        three_targets(experiment)

        verdict = experiment.compare(0, targets=["gpt-5-mini", "claude-sonnet-5"])

        assert judge.candidate_ids() == ["gpt-5-mini", "claude-sonnet-5"]
        assert "gemini-flash" not in judge.candidate_ids()
        assert verdict.candidates == ["gpt-5-mini", "claude-sonnet-5"]


class TestGivenAReferenceAnswer:
    # @scenario "Judging on merits is the default"
    def test_no_reference_answer_is_sent_by_default(self, experiment, judge):
        three_targets(experiment)

        experiment.compare(0, input="What is the capital of the Netherlands?")

        assert "golden" not in judge.data()
        assert "has_golden_answer" not in judge.settings()

    # @scenario "Giving a reference answer turns on golden judging"
    def test_a_reference_answer_turns_on_golden_judging(self, experiment, judge):
        three_targets(experiment)

        experiment.compare(0, golden="Amsterdam")

        assert judge.data()["golden"] == "Amsterdam"
        assert judge.settings()["has_golden_answer"] is True


class TestGivenJudgeOptions:
    # @scenario "The judge prompt can be customized"
    def test_a_custom_prompt_is_sent_verbatim(self, experiment, judge):
        three_targets(experiment)
        prompt = "Pick the candidate a Dutch tour guide would give.\n{candidates}"

        experiment.compare(0, prompt=prompt)

        assert judge.settings()["prompt"] == prompt

    # @scenario "The SDK does not ship its own copy of the judge prompt"
    def test_no_prompt_is_sent_when_it_is_not_customized(self, experiment, judge):
        three_targets(experiment)

        experiment.compare(0)

        assert "prompt" not in judge.settings()

        # Nowhere in the SDK for a copy of a judge prompt to drift out of
        # sync with the judge's own, silently disabling its per-row choice.
        sdk = Path(langwatch.__file__).parent
        carrying_a_copy = [
            str(module.relative_to(sdk))
            for module in sdk.rglob("*.py")
            if "Pick the best of N candidate replies" in module.read_text()
        ]
        assert carrying_a_copy == []

    # @scenario "Unset options are not sent"
    def test_unset_options_are_absent_from_the_request(self, experiment, judge):
        three_targets(experiment)

        experiment.compare(0)

        assert judge.settings() == {}
        # trace_id / span_id are the transport's, added to every evaluator call.
        assert set(judge.data()) - {"trace_id", "span_id"} == {
            "candidates",
            "row_index",
        }

    # @scenario "Options I do set are sent"
    def test_options_i_set_are_sent(self, experiment, judge):
        three_targets(experiment)

        experiment.compare(0, allow_tie=False)

        assert judge.settings() == {"allow_tie": False}

    def test_every_option_i_set_reaches_the_judge(self, experiment, judge):
        three_targets(experiment)

        experiment.compare(
            0,
            model="openai/gpt-5-mini",
            allow_tie=False,
            randomize_order=False,
            swap_and_reconcile=False,
            include_metrics=["duration"],
            temperature=0.3,
        )

        assert judge.settings() == {
            "model": "openai/gpt-5-mini",
            "allow_tie": False,
            "randomize_order": False,
            "swap_and_reconcile": False,
            "include_metrics": ["duration"],
            "temperature": 0.3,
        }

    # @scenario "Duration is the only per-candidate metric on offer"
    def test_candidates_carry_their_duration_and_never_a_cost(
        self, experiment, judge
    ):
        three_targets(experiment)

        experiment.compare(0, include_metrics=["duration"])

        for candidate in judge.data()["candidates"]:
            assert isinstance(candidate["duration"], float)
            assert candidate["duration"] >= 0.0
            assert "cost" not in candidate

        # Nor can one be asked for: a target's cost is worked out from its
        # traces after the run, so the SDK has none to offer here.
        for method in (Experiment.compare, Experiment.acompare):
            annotation = get_type_hints(method)["include_metrics"]
            sequence = get_args(annotation)[0]
            (literal,) = get_args(sequence)
            assert get_args(literal) == ("duration",)

    def test_a_structured_response_reaches_the_judge_whole(self, experiment, judge):
        record(
            experiment,
            0,
            {
                "gpt-5-mini": {"answer": "Amsterdam", "confidence": 0.9},
                "claude-sonnet-5": "Amsterdam.",
            },
        )

        experiment.compare(0)

        first = judge.data()["candidates"][0]
        assert json.loads(first["output"]) == {
            "answer": "Amsterdam",
            "confidence": 0.9,
        }


class TestGivenTheJudgeAnswers:
    # @scenario "The judge may return a tie"
    def test_a_tie_has_no_winner(self, experiment, judge):
        three_targets(experiment)
        judge.response = {
            "status": "processed",
            "score": 0.5,
            "label": "tie",
            "details": "All three name the same city.",
        }

        verdict = experiment.compare(0)

        assert verdict.status == "tie"
        assert verdict.winner is None

        entry = only_evaluation(experiment)
        assert entry.status == "processed"
        assert entry.label == "tie"
        assert entry.score == 0.5

    # @scenario "A verdict that flips under order swap is inconclusive"
    def test_a_verdict_that_flips_under_order_swap_is_inconclusive(
        self, experiment, judge
    ):
        three_targets(experiment)
        judge.response = {
            "status": "skipped",
            "details": (
                "Order-sensitive verdict: original order picked gpt-5-mini; "
                "reversed order picked gemini-flash."
            ),
        }

        verdict = experiment.compare(0)

        assert verdict.status == "inconclusive"
        assert verdict.winner is None
        assert verdict.reasoning == judge.response["details"]

        entry = only_evaluation(experiment)
        assert entry.status == "skipped"
        assert entry.label is None
        assert "label" not in wire_entry(entry)

    def test_a_judge_that_errors_is_not_an_inconclusive_verdict(
        self, experiment, judge
    ):
        three_targets(experiment)
        judge.response = {"status": "error", "details": "The judge model refused."}

        verdict = experiment.compare(0)

        assert verdict.status == "error"
        assert verdict.winner is None
        assert verdict.reasoning == "The judge model refused."
        assert only_evaluation(experiment).status == "error"

    def test_a_judge_that_cannot_be_reached_is_an_error(self, experiment, judge):
        three_targets(experiment)
        judge.unreachable = ConnectionError("Connection refused")

        verdict = experiment.compare(0)

        assert verdict.status == "error"
        assert verdict.winner is None
        assert "Connection refused" in (verdict.reasoning or "")
        assert verdict.candidates == [
            "gpt-5-mini",
            "claude-sonnet-5",
            "gemini-flash",
        ]

        entry = only_evaluation(experiment)
        assert entry.status == "error"
        assert entry.details == verdict.reasoning

        # The run survives a judge it could not reach.
        judge.unreachable = None
        three_targets(experiment, index=1)
        assert experiment.compare(1).status == "decided"

    def test_the_recorded_status_never_disagrees_with_the_verdict(
        self, experiment, judge
    ):
        wire_status_of = {
            "decided": "processed",
            "tie": "processed",
            "inconclusive": "skipped",
            "skipped": "skipped",
            "error": "error",
        }
        judge_answers = {
            "decided": {"status": "processed", "score": 1.0, "label": "gpt-5-mini"},
            "tie": {"status": "processed", "score": 0.5, "label": "tie"},
            "inconclusive": {"status": "skipped", "details": "Order-sensitive."},
            "error": {"status": "error", "details": "The judge model refused."},
        }

        seen: Dict[str, str] = {}
        for index, (expected, answer) in enumerate(judge_answers.items()):
            three_targets(experiment, index=index)
            judge.response = answer
            verdict = experiment.compare(index)
            assert verdict.status == expected
            seen[verdict.status] = evaluations(experiment)[-1].status

        # The one status no judge produces: the row never reaches it.
        record(experiment, 99, {"gpt-5-mini": "Amsterdam."})
        skipped = experiment.compare(99)
        seen[skipped.status] = evaluations(experiment)[-1].status

        assert seen == wire_status_of


class TestGivenAnAsyncExperiment:
    # @scenario "Comparing from an async experiment"
    @pytest.mark.asyncio
    async def test_awaiting_a_comparison_records_it_the_same_way(
        self, experiment, judge
    ):
        three_targets(experiment)
        judge.response = {
            "status": "processed",
            "score": 1.0,
            "label": "claude-sonnet-5",
            "details": "Answers in a full sentence.",
        }

        verdict = await experiment.acompare(0)

        # Awaited on the async transport, never on the blocking one.
        assert len(judge.async_calls) == 1
        assert judge.calls == []
        assert verdict == ComparisonVerdict(
            status="decided",
            winner="claude-sonnet-5",
            reasoning="Answers in a full sentence.",
            candidates=["gpt-5-mini", "claude-sonnet-5", "gemini-flash"],
        )

        entry = only_evaluation(experiment)
        assert entry.evaluator == COMPARISON_EVALUATOR
        assert entry.target_id is None
        assert entry.label == "claude-sonnet-5"


class TestGivenBothSdksImplementComparison:
    # @scenario "Both SDKs expose the same comparison"
    def test_the_comparison_surface_is_the_shared_one(self):
        shared_options = {
            "name",
            "targets",
            "input",
            "golden",
            "prompt",
            "model",
            "allow_tie",
            "randomize_order",
            "swap_and_reconcile",
            "include_metrics",
            "temperature",
        }

        for method in (Experiment.compare, Experiment.acompare):
            parameters = inspect.signature(method).parameters
            assert set(parameters) - {"self", "index"} == shared_options
            assert parameters["index"].default is inspect.Parameter.empty
            assert parameters["name"].default == "comparison"
            for option in shared_options - {"name"}:
                assert parameters[option].default is None

        assert [field.name for field in fields(ComparisonVerdict)] == [
            "status",
            "winner",
            "reasoning",
            "candidates",
        ]
        assert get_args(ComparisonStatus) == (
            "decided",
            "tie",
            "inconclusive",
            "skipped",
            "error",
        )

    def test_the_judge_is_reached_at_its_own_endpoint(self, experiment, judge):
        three_targets(experiment)

        experiment.compare(0)

        assert judge.last["url"] == (
            "https://app.langwatch.test/api/evaluations/"
            "langevals/select_best_compare/evaluate"
        )
        assert judge.body()["name"] == "comparison"
