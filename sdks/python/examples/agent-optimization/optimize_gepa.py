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

from coolname import generate_slug
from dotenv import load_dotenv

# scenario is imported before dspy, see the note in agent.py.
import scenario  # noqa: F401
import dspy

import langwatch
import langwatch.dspy

from agent import build_agent
from program import ScenarioProgram, evaluate_suite, scenario_metric
from scenarios import trainset

load_dotenv()

EXPERIMENT = "returns-agent-scenarios"
MODEL = "openai/gpt-5-mini"
REFLECTION_MODEL = "openai/gpt-5"


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

    program = ScenarioProgram(build_agent())
    before = instructions_of(program)

    optimizer = dspy.GEPA(
        metric=scenario_metric,
        max_metric_calls=max_metric_calls,
        reflection_minibatch_size=3,
        num_threads=3,
        reflection_lm=dspy.LM(REFLECTION_MODEL, temperature=1.0, max_tokens=16000),
        track_stats=True,
    )

    if os.environ.get("LANGWATCH_API_KEY"):
        langwatch.dspy.init(
            experiment=EXPERIMENT, optimizer=optimizer, run_id=run_id
        )
    else:
        print("LANGWATCH_API_KEY is not set, the optimizer run is not tracked.")

    baseline = evaluate_suite(program, "baseline", run_id)

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
