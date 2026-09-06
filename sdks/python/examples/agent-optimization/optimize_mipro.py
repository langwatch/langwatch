"""Optimize the ACME returns agent with MIPROv2, using scenarios as the metric.

MIPROv2 proposes whole instruction candidates and picks the ones that score
best on the suite. It only reads the score, not the written feedback, so it is
the comparison point for the GEPA run in `optimize_gepa.py`.

Few-shot demos are turned off (`max_bootstrapped_demos=0`,
`max_labeled_demos=0`): a demo here would be a whole simulated conversation,
which is not something to paste into a prompt.

Run it with `uv run optimize_mipro.py`.

Environment:
    OPENAI_API_KEY      the key the agent, the simulation and the judge use
    LANGWATCH_API_KEY   optional, sends the optimizer steps to LangWatch
    LANGWATCH_ENDPOINT  optional, for a self-hosted LangWatch
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
PROMPT_MODEL = "openai/gpt-5"


def instructions_of(program: dspy.Module) -> dict[str, str]:
    return {
        name: predictor.signature.instructions
        for name, predictor in program.named_predictors()
    }


def main() -> None:
    run_id = os.environ.get("RUN_ID") or generate_slug(3)

    lm = dspy.LM(MODEL, cache=False)
    dspy.configure(lm=lm)

    program = ScenarioProgram(build_agent())
    before = instructions_of(program)

    optimizer = dspy.MIPROv2(
        metric=scenario_metric,
        auto=None,
        num_candidates=4,
        num_threads=3,
        max_bootstrapped_demos=0,
        max_labeled_demos=0,
        prompt_model=dspy.LM(PROMPT_MODEL),
    )

    if os.environ.get("LANGWATCH_API_KEY"):
        langwatch.dspy.init(
            experiment=EXPERIMENT, optimizer=optimizer, run_id=run_id
        )
    else:
        print("LANGWATCH_API_KEY is not set, the optimizer run is not tracked.")

    baseline = evaluate_suite(program, "baseline", run_id)

    optimized = optimizer.compile(
        program,
        trainset=trainset,
        valset=trainset,
        num_trials=6,
        # The valset is six scenarios, and a minibatch may not be larger than
        # the valset, so the full suite is evaluated on every trial.
        minibatch=False,
    )

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

    optimized.save("optimized_agent_mipro.json")
    print("\nSaved optimized_agent_mipro.json")
    print(f"Agent Testing batches: {run_id}-baseline and {run_id}-best")


if __name__ == "__main__":
    main()
