"""Optimize the ACME returns agent with GEPA, using scenarios as the metric.

GEPA reads the written feedback the metric returns and rewrites the predictor
instructions, which for a `dspy.ReAct` includes the tool descriptions.

Run it with `uv run optimize_gepa.py`.

Environment:
    OPENAI_API_KEY          the key the agent, the simulation and the judge use
    LANGWATCH_API_KEY       optional, sends the optimizer steps to LangWatch
    LANGWATCH_ENDPOINT      optional, for a self-hosted LangWatch
    GEPA_MAX_METRIC_CALLS   optional, the scenario-run budget, default 48
"""

from __future__ import annotations

import os
from typing import Any

from coolname import generate_slug
from dotenv import load_dotenv

# scenario is imported before dspy, see the note in agent.py.
import scenario  # noqa: F401
import dspy
from gepa.core.callbacks import GEPACallback, ValsetEvaluatedEvent

import langwatch
import langwatch.dspy
from langwatch.dspy import (
    DSPyExample,
    DSPyOptimizer,
    DSPyPredictor,
    langwatch_dspy,
)

from agent import build_agent
from program import ScenarioProgram, evaluate_suite, scenario_metric
from scenarios import trainset

load_dotenv()

EXPERIMENT = "returns-agent-scenarios"
MODEL = "openai/gpt-5-mini"
REFLECTION_MODEL = "openai/gpt-5"


class LangWatchGEPACallback(GEPACallback):
    """Logs every valset evaluation of a GEPA run as a LangWatch step.

    GEPA is not one of the optimizer classes `langwatch.dspy.init` patches, so
    this is the custom-optimizer path: init with `optimizer=None` and call
    `log_step` yourself. `event["candidate"]` maps predictor name to the
    candidate instructions, which is exactly what the predictors table shows.
    """

    def __init__(self, parameters: dict[str, Any]):
        self.parameters = parameters

    def on_valset_evaluated(self, event: ValsetEvaluatedEvent) -> None:
        if langwatch_dspy.run_id is None:
            return

        langwatch_dspy.log_step(
            optimizer=DSPyOptimizer(name="GEPA", parameters=self.parameters),
            index=str(event["iteration"]),
            score=float(event["average_score"]),
            label="score",
            predictors=[
                DSPyPredictor(
                    name=name,
                    predictor={"signature": {"instructions": instructions}, "demos": []},
                )
                for name, instructions in event["candidate"].items()
            ],
        )


def tracked_scenario_metric(
    gold: dspy.Example,
    pred: dspy.Prediction,
    trace: Any = None,
    pred_name: str | None = None,
    pred_trace: Any = None,
) -> Any:
    """`scenario_metric` plus the example buffering LangWatch steps need.

    `langwatch.dspy.track_metric` cannot be used here: it wraps the metric into
    a three-argument callable, and GEPA rejects any metric that does not accept
    (gold, pred, trace, pred_name, pred_trace).
    """
    result = scenario_metric(gold, pred, trace, pred_name, pred_trace)

    if langwatch_dspy.run_id is not None:
        score = result if isinstance(result, (int, float)) else float(result.score)
        langwatch_dspy.examples_buffer.append(
            DSPyExample(
                example=gold._store if hasattr(gold, "_store") else gold,
                pred=pred._store if hasattr(pred, "_store") else pred,
                score=score,
                trace=None,
            )
        )

    return result


def instructions_of(program: dspy.Module) -> dict[str, str]:
    return {
        name: predictor.signature.instructions
        for name, predictor in program.named_predictors()
    }


def main() -> None:
    run_id = os.environ.get("RUN_ID") or generate_slug(3)

    lm = dspy.LM(MODEL, cache=False)
    dspy.configure(lm=lm)

    max_metric_calls = int(os.environ.get("GEPA_MAX_METRIC_CALLS", "48"))
    parameters = {
        "max_metric_calls": max_metric_calls,
        "reflection_minibatch_size": 3,
        "reflection_lm": REFLECTION_MODEL,
    }

    callbacks = []
    if os.environ.get("LANGWATCH_API_KEY"):
        langwatch.dspy.init(experiment=EXPERIMENT, optimizer=None, run_id=run_id)
        callbacks.append(LangWatchGEPACallback(parameters))
    else:
        print("LANGWATCH_API_KEY is not set, the optimizer run is not tracked.")

    program = ScenarioProgram(build_agent())
    before = instructions_of(program)

    baseline = evaluate_suite(program, "baseline", run_id)

    optimizer = dspy.GEPA(
        metric=tracked_scenario_metric,
        max_metric_calls=max_metric_calls,
        reflection_minibatch_size=3,
        num_threads=3,
        reflection_lm=dspy.LM(REFLECTION_MODEL, temperature=1.0, max_tokens=16000),
        track_stats=True,
        gepa_kwargs={"callbacks": callbacks} if callbacks else None,
    )
    optimized = optimizer.compile(program, trainset=trainset, valset=trainset)

    final = evaluate_suite(optimized, "best", run_id)

    print("=== baseline vs best ===")
    print(f"{'metric':<20}{'baseline':>12}{'best':>12}")
    print(
        f"{'pass rate':<20}{baseline['pass_rate']:>11.0%}{final['pass_rate']:>12.0%}"
    )
    print(
        f"{'average score':<20}{baseline['average_score']:>12.2f}"
        f"{final['average_score']:>12.2f}"
    )

    after = instructions_of(optimized)
    for name, text in after.items():
        if before.get(name) == text:
            print(f"\n--- {name}: unchanged ---")
            continue
        print(f"\n--- {name}: before ---\n{before.get(name, '')}")
        print(f"\n--- {name}: after ---\n{text}")

    optimized.save("optimized_agent.json")
    print("\nSaved optimized_agent.json")
    print(f"Agent Testing batches: {run_id}-baseline and {run_id}-best")


if __name__ == "__main__":
    main()
