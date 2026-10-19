"""EXP-37: a small GEPA run whose optimisation steps land on the stack through log_steps.

Every call goes to llmsim, so the scores are low and the run is free. Run it with run.sh.
"""

import os

import truststore

truststore.inject_into_ssl()

import dspy
import langwatch.dspy

PAIRS = [
    ("What is the capital of France?", "Paris"),
    ("What colour is the sky on a clear day?", "blue"),
    ("How many legs does a spider have?", "eight"),
    ("Which planet is known as the red planet?", "Mars"),
]


def metric(gold, pred, trace=None, pred_name=None, pred_trace=None):
    answer = str(getattr(pred, "answer", ""))
    hit = gold.answer.lower() in answer.lower()
    # Partial credit for brevity, so llmsim's candidates score apart and GEPA keeps some.
    score = 1.0 if hit else round(1 / (1 + len(answer.split())), 3)
    feedback = (
        "correct" if hit else f"the answer should mention {gold.answer}, in fewer words"
    )
    return dspy.Prediction(score=score, feedback=feedback)


def main() -> None:
    lm = dspy.LM(
        "openai/markov-small",
        api_base=os.environ["LLMSIM_BASE_URL"],
        api_key="llmsim",
        cache=False,
    )
    dspy.configure(lm=lm)
    trainset = [
        dspy.Example(question=q, answer=a).with_inputs("question") for q, a in PAIRS
    ]

    optimizer = dspy.GEPA(
        metric=metric,
        max_metric_calls=int(os.environ.get("GEPA_MAX_METRIC_CALLS", "24")),
        reflection_lm=lm,
        reflection_minibatch_size=2,
        num_threads=2,
        track_stats=True,
    )
    langwatch.dspy.init(experiment="haven-gepa-steps", optimizer=optimizer)
    optimizer.compile(
        dspy.Predict("question -> answer"), trainset=trainset, valset=trainset
    )


if __name__ == "__main__":
    main()
