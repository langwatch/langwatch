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

## The same agent as a connected agent

`connected_agent.py` is the same ACME returns agent as a plain OpenAI
tool-calling loop, registered with `@langwatch.connect_agent(name="returns-agent")`.
It imports the four tools and the orders from `agent.py`, so the two files test
the same behaviour. Use it when you want to run the suite from the platform or
from the `langwatch` CLI instead of from DSPy.

It declares two run parameters: `model`, a closed list of `gpt-5` and
`gpt-5-mini`, and `plan`, free text appended to the system prompt.

The tool contract is picked by an environment variable, so a comparison run has
a real before and after side:

| `RETURNS_AGENT_TOOL_DESCRIPTIONS` | `check_return_eligibility` |
|---|---|
| `weak` | The description does not name the accepted `reason` values and the parameter is a free-text string. The model guesses, the tool rejects the call, the agent retries. |
| `explicit` (default) | The description lists the accepted values and the schema carries them as an enum. |

Run one process per environment to compare the two:

```bash
APP_ENV=production RETURNS_AGENT_TOOL_DESCRIPTIONS=weak uv run connected_agent.py
uv run connected_agent.py    # development, explicit
```

Both processes need `LANGWATCH_API_KEY` and `OPENAI_API_KEY`. Each one registers
`returns-agent` in its own environment, and the platform shows both online.

Create a test suite named `Returns` with the six scenarios of `scenarios.py`,
then run it against either side:

```bash
langwatch test-suite run "Returns" --target connected:returns-agent@development --wait

langwatch test-suite run "Returns" \
  --target connected:returns-agent@production \
  --target connected:returns-agent@development \
  --wait
```

The guide for this file: https://langwatch.ai/docs/improve-your-agent/fix-tool-calls
