"""The program, the optimizer and the events the GEPA tracking tests share."""

from typing import Any

import dspy
from dspy.teleprompt import GEPA

from langwatch.dspy import LangWatchTrackedGEPA


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
