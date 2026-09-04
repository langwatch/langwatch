# Optimizing an agent with scenarios as the metric

A `dspy.ReAct` support agent for the ACME online shop, optimized by DSPy where
the metric is a set of simulated conversations rather than a labelled dataset.
One forward pass of the program is one full scenario: a simulated customer, the
agent with its four tools, and a judge scoring the conversation against that
scenario's criteria.

The agent starts with short instructions and one deliberately weak tool
description: `check_return_eligibility` does not say which `reason` values it
accepts, so the untrained agent calls it with free text, gets a `ValueError`
back and retries. That retry is visible in the transcript, the metric turns it
into written feedback, and the optimizer rewrites the tool description.

The guide for this example: https://langwatch.ai/docs/improve-your-agent/optimize-with-dspy

## Files

- `agent.py`: the `SupportSignature`, the four tools over an in-memory store of
  three orders, `build_agent()`, and `ReActAdapter`, which runs one turn of the
  agent inside a scenario and captures the DSPy trace.
- `scenarios.py`: the six scenarios as `dspy.Example`s, with criteria and a turn
  budget each.
- `program.py`: `ScenarioProgram`, the `scenario_metric`, and `evaluate_suite`,
  which runs all six scenarios and prints the table.
- `optimize_gepa.py`: the GEPA run. GEPA reads the metric's written feedback.
- `optimize_mipro.py`: the MIPROv2 run, which reads only the score.

## Environment

| Variable | Effect |
|---|---|
| `OPENAI_API_KEY` | The key the agent, the user simulator and the judge use. Required. |
| `LANGWATCH_API_KEY` | Sends the optimizer steps to LangWatch and the scenario runs to Agent Testing. Without it both scripts run untracked. |
| `LANGWATCH_ENDPOINT` | The LangWatch endpoint, for a self-hosted install. |
| `GEPA_MAX_METRIC_CALLS` | The scenario-run budget of the GEPA run. Default 48. |
| `RUN_ID` | Reuse a run id instead of generating one. The Agent Testing batches are named after it. |

## Running

```bash
uv sync
uv run optimize_gepa.py
uv run optimize_mipro.py
```

Both scripts evaluate the suite once before optimizing, optimize, evaluate
again, then print the before and after table and the rewritten instructions.
The optimized program is written to `optimized_agent.json` and
`optimized_agent_mipro.json`.

## Cost and time

A GEPA run at the default budget is about 50 scenario runs. Each one is a full
conversation with three models involved, so expect 20 to 30 minutes and a few
dollars on `gpt-5-mini` plus the `gpt-5` reflection calls. Lower
`GEPA_MAX_METRIC_CALLS` to shorten it.

## Where to look in LangWatch

- **Experiments**, under `returns-agent-scenarios`: the optimizer run, one step
  per candidate evaluation, with the score and the candidate instructions.
- **Agent Testing**, set `dspy-optimization`: every scenario run. The two suite
  evaluations arrive as the batches `<run_id>-baseline` and `<run_id>-best`, so
  the same six scenarios can be read side by side before and after.
