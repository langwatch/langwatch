"""The DSPy program under optimization, the metric, and the suite evaluation.

`ScenarioProgram` is a `dspy.Module` whose forward pass is one full simulated
conversation. The unit an optimizer sees is not a single LM call, it is a whole
scenario: a simulated customer, the agent, and a judge with the scenario's
criteria.

The program holds the ReAct agent as a submodule, so `named_predictors()`
returns `agent.react` and `agent.extract.predict`. Those two names are what the
optimizers rewrite, and `agent.react` is where the tool descriptions live.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

# `scenario` pulls in joblib, which imports numpy. dspy 3.3.0 imports numpy
# through a lazy shim that breaks when numpy is first imported after dspy, so
# scenario is imported first in every module of this example.
import scenario
import dspy

from agent import ReActAdapter
from scenarios import trainset

JUDGE_MODEL = "openai/gpt-5-mini"
SET_ID = "dspy-optimization"
MAX_TURNS = 12
MAX_FEEDBACK_CHARS = 1500

TOOL_ARGUMENT_HINT = (
    "A tool was retried after rejecting its arguments; state the accepted values "
    "in the tool description."
)


def _count_agent_turns(messages: list[dict[str, Any]]) -> int:
    """Count the agent's replies to the customer.

    Tool calls are assistant messages too, so they are excluded: a turn is a
    message the customer actually reads.
    """
    return sum(
        1
        for message in messages
        if message.get("role") == "assistant"
        and not message.get("tool_calls")
        and isinstance(message.get("content"), str)
        and message["content"].strip()
    )


class ScenarioProgram(dspy.Module):
    def __init__(self, agent: dspy.ReAct):
        super().__init__()
        self.agent = agent

    def forward(
        self,
        name: str,
        description: str,
        criteria: list[str],
        budget_turns: int,
    ) -> dspy.Prediction:
        adapter = ReActAdapter(self.agent)

        # `scenario.run` is a coroutine that offloads the whole simulation onto
        # its own thread with its own event loop, so this thread only waits.
        # `forward` runs on DSPy's thread pool, which has no running loop, so
        # `asyncio.run` is the entry point here.
        result = asyncio.run(
            scenario.run(
                name=name,
                description=description,
                max_turns=MAX_TURNS,
                set_id=SET_ID,
                agents=[
                    adapter,
                    scenario.UserSimulatorAgent(),
                    scenario.JudgeAgent(criteria=list(criteria), model=JUDGE_MODEL),
                ],
            )
        )

        # The agent ran on the scenario's thread, so its predictor calls landed
        # in that thread's `dspy.settings.trace`. GEPA reads the trace of this
        # thread, so hand them over. `trace` is None when nothing is capturing.
        trace = dspy.settings.trace
        if trace is not None and adapter.captured_trace:
            trace.extend(adapter.captured_trace)

        messages = [dict(m) for m in (result.messages or [])]

        return dspy.Prediction(
            success=bool(result.success),
            passed=list(result.passed_criteria or []),
            failed=list(result.failed_criteria or []),
            reasoning=result.reasoning or "",
            turns=_count_agent_turns(messages),
            messages=messages,
        )


def _turn_penalty(turns: int, budget_turns: int) -> float:
    over = max(0, turns - budget_turns)
    return 0.5 * over / budget_turns


def _retried_after_argument_rejection(messages: list[dict[str, Any]]) -> bool:
    """True when a tool rejected its arguments during the conversation.

    A raised `ValueError` reaches the transcript as the content of a `tool`
    message, because `ReActAdapter` emits the ReAct trajectory as tool calls and
    tool results.
    """
    for message in messages:
        if message.get("role") != "tool":
            continue
        content = message.get("content")
        if isinstance(content, str) and "must be one of" in content:
            return True
    return False


def _build_feedback(gold: dspy.Example, pred: dspy.Prediction, score: float) -> str:
    verdict = "PASSED" if pred.success else "FAILED"
    lines = [f"Scenario '{gold.name}' {verdict} with score {score:.2f}."]

    if pred.failed:
        lines.append("Unmet criteria: " + "; ".join(pred.failed) + ".")
    if pred.reasoning:
        lines.append("Judge: " + pred.reasoning.strip())

    lines.append(
        f"The agent used {pred.turns} turns against a budget of {gold.budget_turns}."
    )
    if pred.turns > gold.budget_turns:
        lines.append("Reaching the same outcome in fewer turns scores higher.")

    if _retried_after_argument_rejection(pred.messages):
        lines.append(TOOL_ARGUMENT_HINT)

    feedback = "\n".join(lines)
    if len(feedback) > MAX_FEEDBACK_CHARS:
        feedback = feedback[: MAX_FEEDBACK_CHARS - 3] + "..."
    return feedback


def scenario_metric(
    gold: dspy.Example,
    pred: dspy.Prediction,
    trace: Any = None,
    pred_name: str | None = None,
    pred_trace: Any = None,
) -> Any:
    """Score one scenario run.

    A failed scenario is 0. A passed one starts at 1 and loses half a point per
    budget of overspent turns, floored at 0.

    Returns a plain float for plain evaluation, and a `dspy.Prediction` carrying
    the score plus written feedback when an optimizer asks for feedback.
    """
    if not pred.success:
        score = 0.0
    else:
        score = max(0.0, min(1.0, 1 - _turn_penalty(pred.turns, gold.budget_turns)))

    if pred_name is None and trace is None:
        return score

    return dspy.Prediction(score=score, feedback=_build_feedback(gold, pred, score))


def evaluate_suite(program: dspy.Module, label: str, run_id: str) -> dict[str, Any]:
    """Run all six scenarios once and print the result table.

    Every scenario of one call shares a batch id, so the suite shows up as a
    single batch on the Agent Testing page.
    """
    batch_run_id = f"{run_id}-{label}"
    os.environ["SCENARIO_BATCH_RUN_ID"] = batch_run_id

    evaluate = dspy.Evaluate(
        devset=trainset,
        metric=scenario_metric,
        num_threads=3,
        display_table=False,
        display_progress=True,
    )
    result = evaluate(program)

    rows = []
    for example, prediction, score in result.results:
        rows.append(
            {
                "scenario": example.name,
                "passed": bool(getattr(prediction, "success", False)),
                "turns": getattr(prediction, "turns", 0),
                "budget": example.budget_turns,
                "score": float(score),
            }
        )

    passed = sum(1 for row in rows if row["passed"])
    total = len(rows)
    pass_rate = passed / total if total else 0.0
    average_score = sum(row["score"] for row in rows) / total if total else 0.0

    print(f"\n=== {label} (batch {batch_run_id}) ===")
    print(f"{'scenario':<34}{'result':<9}{'turns':<7}{'budget':<8}{'score':>6}")
    for row in rows:
        print(
            f"{row['scenario']:<34}{'pass' if row['passed'] else 'fail':<9}"
            f"{row['turns']:<7}{row['budget']:<8}{row['score']:>6.2f}"
        )
    print(
        f"pass rate {passed}/{total} ({pass_rate:.0%}), "
        f"average score {average_score:.2f}\n"
    )

    return {
        "label": label,
        "batch_run_id": batch_run_id,
        "rows": rows,
        "passed": passed,
        "total": total,
        "pass_rate": pass_rate,
        "average_score": average_score,
    }
