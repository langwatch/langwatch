"""GEPA runs tracked through langwatch.dspy.init(optimizer=dspy.GEPA(...)).

Spec: specs/python-sdk/dspy-gepa-tracking.feature
"""

import json
from typing import Any

import dspy
import httpx
import pytest
from dspy.teleprompt import GEPA

import langwatch
import langwatch.dspy
from langwatch.dspy import (
    DSPyExample,
    DSPyOptimizer,
    DSPyStep,
    LangWatchGEPACallback,
    LangWatchTrackedGEPA,
    SerializableAndPydanticEncoder,
    langwatch_dspy,
)


class Program(dspy.Module):
    def __init__(self):
        super().__init__()
        self.answer = dspy.Predict("question -> answer")

    def forward(self, question: str):
        return self.answer(question=question)


def feedback_metric(gold, pred, trace=None, pred_name=None, pred_trace=None):
    return dspy.Prediction(score=0.5, feedback="too many steps")


def build_optimizer(**gepa_kwargs) -> GEPA:
    return dspy.GEPA(
        metric=feedback_metric,
        max_metric_calls=4,
        reflection_minibatch_size=2,
        reflection_lm=dspy.LM("openai/gpt-5-mini"),
        gepa_kwargs=gepa_kwargs or None,
    )


def tracked_optimizer(**gepa_kwargs) -> LangWatchTrackedGEPA:
    optimizer = build_optimizer(**gepa_kwargs)
    optimizer.__class__ = LangWatchTrackedGEPA
    optimizer.patch()  # type: ignore[attr-defined]
    return optimizer  # type: ignore[return-value]


def valset_of(size: int) -> list[dspy.Example]:
    return [
        dspy.Example(question=f"question {i}", answer=f"answer {i}").with_inputs(
            "question"
        )
        for i in range(size)
    ]


def valset_event(
    *,
    candidate_idx: int,
    candidate: dict[str, str],
    scores_by_val_id: dict[int, float],
    outputs_by_val_id: Any,
    average_score: float,
) -> dict[str, Any]:
    return {
        "iteration": candidate_idx,
        "candidate_idx": candidate_idx,
        "candidate": candidate,
        "scores_by_val_id": scores_by_val_id,
        "average_score": average_score,
        "num_examples_evaluated": len(scores_by_val_id),
        "total_valset_size": len(scores_by_val_id),
        "parent_ids": [],
        "is_best_program": True,
        "outputs_by_val_id": outputs_by_val_id,
    }


@pytest.fixture
def sent_steps(monkeypatch) -> list[DSPyStep]:
    """A tracker with a run and no network: every logged step lands here."""
    steps: list[DSPyStep] = []

    def send_steps():
        steps.extend(langwatch_dspy.steps_buffer)
        langwatch_dspy.steps_buffer = []

    langwatch_dspy.run_id = "run"
    langwatch_dspy.experiment_slug = "experiment"
    langwatch_dspy.workflow_version_id = None
    langwatch_dspy.reset()
    monkeypatch.setattr(langwatch_dspy, "send_steps", send_steps)
    return steps


class TestWhenInitReceivesAGepaOptimizer:
    # @scenario "init recognises a GEPA optimizer"
    def test_patches_the_optimizer_for_tracking(self, monkeypatch, capsys):
        class Response:
            status_code = 200

            def json(self):
                return {"path": "/project/experiments/experiment"}

            def raise_for_status(self):
                return None

        monkeypatch.setattr(langwatch, "get_api_key", lambda: "key")
        monkeypatch.setattr(langwatch.dspy.httpx, "post", lambda *a, **k: Response())
        optimizer = build_optimizer()

        langwatch.dspy.init(experiment="experiment", optimizer=optimizer, run_id="run")

        assert isinstance(optimizer, LangWatchTrackedGEPA)
        assert "custom optimizer" not in capsys.readouterr().out


class TestWhenTheTrackedMetricIsCalled:
    # @scenario "The tracked metric keeps the feedback GEPA reads"
    def test_returns_the_prediction_and_buffers_the_example(self, sent_steps):
        optimizer = tracked_optimizer()
        gold = valset_of(1)[0]
        pred = dspy.Prediction(answer="answer 0")

        result = optimizer.metric_fn(gold, pred, None, None, None)

        assert result.score == 0.5
        assert result.feedback == "too many steps"
        assert langwatch_dspy.examples_buffer == [
            DSPyExample(
                example={"question": "question 0", "answer": "answer 0"},
                pred={"answer": "answer 0"},
                score=0.5,
                trace=None,
            )
        ]

    # @scenario "A feedback call for one predictor is not buffered as an example"
    def test_skips_the_buffer_on_a_feedback_call(self, sent_steps):
        optimizer = tracked_optimizer()
        gold = valset_of(1)[0]
        pred = dspy.Prediction(answer="answer 0")

        result = optimizer.metric_fn(gold, pred, [], "answer", [])

        assert result.feedback == "too many steps"
        assert langwatch_dspy.examples_buffer == []


class TestWhenCompileRuns:
    # @scenario "compile installs the GEPA callback and keeps the ones the caller passed"
    def test_installs_the_callback_after_the_callers(self, monkeypatch, sent_steps):
        seen: dict[str, Any] = {}

        def fake_compile(self, student, **kwargs):
            seen["callbacks"] = list(self.gepa_kwargs["callbacks"])
            return student

        monkeypatch.setattr(GEPA, "compile", fake_compile)
        caller_callback = object()
        optimizer = tracked_optimizer(callbacks=[caller_callback])
        valset = valset_of(2)

        optimizer.compile(Program(), trainset=valset, valset=valset)

        assert seen["callbacks"][0] is caller_callback
        assert isinstance(seen["callbacks"][1], LangWatchGEPACallback)
        assert seen["callbacks"][1].valset == valset
        assert optimizer.gepa_kwargs == {"callbacks": [caller_callback]}


class TestWhenGepaEvaluatesACandidateOnTheValidationSet:
    # @scenario "Records a step per candidate evaluated on the validation set"
    def test_records_a_step_per_candidate(self, sent_steps):
        student = Program()
        valset = valset_of(2)
        callback = LangWatchGEPACallback(
            optimizer=tracked_optimizer(), student=student, valset=valset
        )

        callback.on_valset_evaluated(
            valset_event(
                candidate_idx=2,
                candidate={"answer": "Answer in one word."},
                scores_by_val_id={0: 1.0, 1: 0.66},
                outputs_by_val_id={
                    0: dspy.Prediction(answer="answer 0"),
                    1: dspy.Prediction(answer="wrong"),
                },
                average_score=0.83,
            )
        )

        assert len(sent_steps) == 1
        step = sent_steps[0]
        assert step.index == "2"
        assert step.score == 0.83
        assert step.label == "score"
        assert step.optimizer.name == "GEPA"
        assert step.optimizer.parameters["max_metric_calls"] == 4
        assert step.optimizer.parameters["reflection_minibatch_size"] == 2
        assert step.optimizer.parameters["reflection_lm"] == "openai/gpt-5-mini"

        assert [p.name for p in step.predictors] == ["answer"]
        assert (
            step.predictors[0].predictor.signature.instructions == "Answer in one word."
        )
        assert set(step.predictors[0].predictor.signature.fields.keys()) == {
            "question",
            "answer",
        }
        assert student.answer.signature.instructions != "Answer in one word."

        serialized = json.loads(json.dumps(step, cls=SerializableAndPydanticEncoder))
        assert (
            serialized["predictors"][0]["predictor"]["signature"]["instructions"]
            == "Answer in one word."
        )

    # @scenario "The step's examples are the validation results of that candidate"
    def test_takes_the_examples_from_the_validation_results(self, sent_steps):
        valset = valset_of(3)
        callback = LangWatchGEPACallback(
            optimizer=tracked_optimizer(), student=Program(), valset=valset
        )
        langwatch_dspy.examples_buffer = [
            DSPyExample(example={"minibatch": True}, pred={}, score=0.0, trace=None)
        ]

        callback.on_valset_evaluated(
            valset_event(
                candidate_idx=1,
                candidate={"answer": "Answer briefly."},
                scores_by_val_id={0: 1.0, 1: 0.5, 2: 0.0},
                outputs_by_val_id={
                    0: dspy.Prediction(answer="answer 0"),
                    1: dspy.Prediction(answer="answer 1"),
                    2: dspy.Prediction(answer="answer 2"),
                },
                average_score=0.5,
            )
        )

        assert sent_steps[0].examples == [
            DSPyExample(
                example={"question": "question 0", "answer": "answer 0"},
                pred={"answer": "answer 0"},
                score=1.0,
                trace=None,
            ),
            DSPyExample(
                example={"question": "question 1", "answer": "answer 1"},
                pred={"answer": "answer 1"},
                score=0.5,
                trace=None,
            ),
            DSPyExample(
                example={"question": "question 2", "answer": "answer 2"},
                pred={"answer": "answer 2"},
                score=0.0,
                trace=None,
            ),
        ]
        assert langwatch_dspy.examples_buffer == []

    # @scenario "The seed program's step takes its examples from the metric buffer"
    def test_takes_the_seed_examples_from_the_buffer(self, sent_steps):
        optimizer = tracked_optimizer()
        valset = valset_of(2)
        callback = LangWatchGEPACallback(
            optimizer=optimizer, student=Program(), valset=valset
        )
        for example in valset:
            optimizer.metric_fn(
                example, dspy.Prediction(answer="seed"), None, None, None
            )

        callback.on_valset_evaluated(
            valset_event(
                candidate_idx=0,
                candidate={
                    "answer": "Given the fields `question`, produce the fields `answer`."
                },
                scores_by_val_id={0: 0.5, 1: 0.5},
                outputs_by_val_id=None,
                average_score=0.5,
            )
        )

        assert sent_steps[0].index == "0"
        assert [e.example["question"] for e in sent_steps[0].examples] == [
            "question 0",
            "question 1",
        ]
        assert [e.pred for e in sent_steps[0].examples] == [
            {"answer": "seed"},
            {"answer": "seed"},
        ]
        assert langwatch_dspy.examples_buffer == []


class TestWhenACustomOptimizerLogsAStep:
    # @scenario "log_step still drains the buffer for the custom optimizer path"
    def test_drains_the_buffer_into_the_step(self, sent_steps):
        metric = langwatch_dspy.track_metric(lambda example, pred, trace=None: True)
        metric(valset_of(1)[0], dspy.Prediction(answer="answer 0"))

        langwatch_dspy.log_step(
            optimizer=DSPyOptimizer(name="MyOptimizer", parameters={}),
            index="1",
            score=1.0,
            label="score",
            predictors=[],
        )

        assert len(sent_steps[0].examples) == 1
        assert sent_steps[0].examples[0].score == 1.0
        assert langwatch_dspy.examples_buffer == []


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
