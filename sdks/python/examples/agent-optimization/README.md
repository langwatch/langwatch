# Optimizing an agent with scenarios as the metric

A `dspy.ReAct` support agent for the ACME online shop, optimized by DSPy where
the metric is a set of simulated conversations rather than a labelled dataset.
One forward pass of the program is one full scenario: a simulated customer, the
agent with its four tools, and a judge scoring the conversation against that
scenario's criteria.

The agent starts with short instructions and two deliberately weak tool
descriptions: neither `check_return_eligibility` nor `create_return` says which
`reason` codes the returns system accepts (`defective`, `incorrect_item`,
`not_as_expected`, `remorse`), and the codes are not the words a customer uses.
The untrained agent sends `damaged`, gets a `ValueError` back that lists the
codes, and retries. That retry is an extra step in the transcript, the metric
turns it into written feedback, and the optimizer rewrites the tool
descriptions.

The guide for this example: https://langwatch.ai/docs/improve-your-agent/optimize-with-dspy

## Files

- `agent.py`: the `SupportSignature`, the four tools over an in-memory store of
  three orders, `build_agent()`, and `ReActAdapter`, which runs one turn of the
  agent inside a scenario and captures the DSPy trace.
- `scenarios.py`: the six scenarios as `dspy.Example`s, with criteria and a step
  budget each (a step is one reply or one tool call).
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

Each scenario run is a full conversation with three models involved. Measured
on one run of each script, with the agent, the simulated user and the judge on
`gpt-5-mini`:

| Script | Scenario runs | Wall clock | Cost |
|---|---|---|---|
| `optimize_mipro.py` | 64 (6 baseline, 10 bootstrap, 42 over seven trials, 6 final) | 42 minutes | $0.93, of which $0.41 for 18 `gpt-5` proposer calls |
| `optimize_gepa.py` | 63 (6 baseline, 51 in the optimizer with `max_metric_calls=48`, 6 final) | 31 minutes | $0.64, of which $0.18 for 4 `gpt-5` reflection calls |

Lower `GEPA_MAX_METRIC_CALLS` or `num_trials` to shorten a run.

## Where to look in LangWatch

- **Experiments**, under `returns-agent-scenarios`: the optimizer run, which
  both scripts register with `langwatch.dspy.init`. MIPROv2 logs one step per
  trial, GEPA one step for the seed program and one per candidate evaluated on
  the validation set, each with the score, the candidate instructions and the
  six scenario results.
- **Agent Testing**, set `dspy-optimization`: every scenario run. The two suite
  evaluations arrive as their own runs of six, the batches `<run_id>-baseline`
  and `<run_id>-best`, so the same six scenarios can be read side by side before
  and after.

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
langwatch test-suite run "Returns" --target connected:returns-agent --wait

langwatch test-suite run "Returns" \
  --target connected:returns-agent \
  --target connected:returns-agent@production \
  --wait
```

The guide for this file: https://langwatch.ai/docs/improve-your-agent/fix-tool-calls
