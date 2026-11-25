---
name: eval-triage
description: Investigate failing experiments and evaluations with LangWatch. Triage a failing experiment run to the exact rows and evaluator scores that regressed, then to a root cause. Use when an experiment fails, scores drop, or evaluations regress.
license: MIT
compatibility: Requires the `langwatch` CLI with a valid `LANGWATCH_API_KEY`. Works with any coding agent.
metadata:
  category: recipe
---

# Triage Failing Experiments and Evaluations

From "the run failed" to the specific rows, evaluators, and inputs responsible, then to a root cause. Work the steps in order.

## Prerequisites

## Step 1: Find the Failing Run

```bash
langwatch experiment list --limit 20 -o json          # experiments in the project
langwatch experiment list-runs <slug> -o json         # runs for one experiment
langwatch experiment status <slug> -o json            # latest run: status, progress, errors
langwatch experiment status <slug> --run-id <id> -o json
```

A run can fail two ways, and they triage differently:

- **Execution failure**: the run errored out or stalled. `status` shows the error; jump to Step 4.
- **Score regression**: the run completed but evaluator scores dropped or rows failed. Continue to Step 2.

## Step 2: Isolate the Failing Rows

```bash
langwatch experiment results <slug> --filter failed -o json
langwatch experiment results <slug> --filter failed --evaluator <name> -o json
langwatch experiment results <slug> --run-id <id> --limit 50 -o json
```

- `--filter failed` keeps only the rows that failed at least one evaluator. Start there, not with the full result set.
- `--wait <seconds>` keeps reading until the run has ended and every result it reported is stored. Results are stored after the run reports them, so a read taken straight after a large run holds only part of it; the CLI warns on stderr when that happens. Pass `--run-id <id> --wait 600` after a run you just started, and treat exit status 2 as "still partial".
- `--evaluator <name>` shows one evaluator's column when several ran: is the regression concentrated in one evaluator (a scoring problem) or spread across all of them (a real behavior regression)?

For each failing row, note the input, the expected output (from the dataset), and the actual output. Rows that fail the SAME way point at one root cause; rows that fail differently suggest variation or a noisy evaluator.

Before you diagnose a row, check whether it fails consistently. Compare it across the runs you have (`list-runs`, then `results --run-id`), or run the experiment again. A row that failed once and passed in other runs is variation until more runs say otherwise; a row that fails every time is where the root cause is. When most failures are one-offs, report that, and treat the instability itself as the finding.

## Step 3: Inspect the Evaluators

```bash
langwatch evaluator list -o json
langwatch evaluator get <idOrSlugOrName> -o json
```

Before blaming the agent, rule out the scorer:

- **LLM-judge evaluators**: check the model in `settings`. A judge model that changed, is rate-limited, or is too weak for the rubric produces score swings that have nothing to do with the agent.
- **Thresholds**: a score of 0.49 vs a pass threshold of 0.5 is a borderline judge, not a regression. Look at the score distribution across rows, not just pass/fail.
- **Deterministic evaluators** (exact match, JSON validity): these don't drift; failures here are real.

## Step 4: Root Cause

1. Compare the failing run against the last passing one: what changed (prompt version, model, dataset, code)? `git log` on prompts and agent code usually answers this directly.
2. If rows fail on retrieval or context: inspect a production trace of the same path (`langwatch trace search` / `langwatch trace get`; see the `debug-with-langwatch` recipe).
3. If the dataset itself looks wrong (stale expected outputs, bad rows), fix the dataset. Use `langwatch dataset get <slugOrId>` to inspect it.
4. Apply the fix as a measured change, never as a single re-run that happens to come back green:

```bash
langwatch experiment run <slug> --wait
langwatch experiment status <slug> -o json
```

Improving an agent works like an experiment, whatever the layer you change: a prompt, code, retrieval, a tool or a test. One attempt is rarely the answer, and an unmeasured change is a guess.

1. **Set an attempts budget.** Before the first change, decide how many hypotheses the problem is worth, given what one measurement costs (a dataset run, a scenario suite, a CI cycle). Say the number and the reason in one line. Revise it as you learn: a cheap measurement or a promising lead earns more attempts, an expensive or flat one fewer.
2. **Measure the baseline first,** with what the environment offers: a platform experiment, a scenario run with `--repeat`, the repository's own tests and linters, its CI. That measurement is the yardstick for every attempt, so note the items, the number of runs and the evaluators.
3. **Read the variation before you call anything a failure.** A model sampling at non-zero temperature, a simulated user and an LLM judge all vary between runs. Run each item more than once and read its pass rate ("failed 3 of 3", "failed 1 of 3"), not a single verdict. Diagnose the items that fail consistently first. An item that passes on some runs and fails on others is an unstable behaviour: look for what makes it unstable (an ambiguous instruction, a retrieval step that sometimes misses), never patch the one bad output.
4. **State the hypothesis before the change:** the cause, the change, and what it predicts will move. For example: "refund answers quote the old policy because retrieval ranks the outdated page first; ranking recent pages higher should raise the pass rate on policy questions and leave the rest unchanged." Rank the hypotheses you considered and say why you chose this one. When the user is there to answer, let them choose. When no one can answer (an in-product assistant, an unattended run), write the ranking and your choice with its reason, then proceed.
5. **Change one thing on a branch and measure the candidate exactly like the baseline:** same items, same number of runs, same evaluators. Compare per item, not only the total.
6. **Keep some items out of the loop.** Build the fix from part of the failing items and check it on items you did not read. A fix that lifts only the items it was built from is fitted to them.
7. **Open a pull request only on a measured win.** Its description carries the hypothesis, the baseline and candidate results over the same items, and the runs that produced them. When the candidate does not win, open nothing: say what the result taught you, adjust, and take the next hypothesis. When nothing in reach can measure the change (the agent cannot run here and no platform run reaches the branch), say so and present the change as untested, never as an improvement.
8. **Stop when the budget is spent or the results stop moving,** and report every attempt: hypothesis, result, verdict. "Nothing beat the baseline, and this is what we learned" is a result.

**Fix the class, in every layer.** Code that recognises the evaluation questions (a keyword check, a hardcoded answer, a special case for one input) is not a fix. It passes the items it names and breaks the ones that look like them. Ask whether the change would help a new question of the same kind, one not in the test set. If not, keep diagnosing.

**Tests you write are not the evidence.** You may write and edit tests, scenarios, datasets and expected answers. A test you wrote checks that the code does what you meant, not that what you meant is right. A grading change made in the same piece of work as the agent change never counts as evidence for that change: disclose it in the pull request, justify it against real traces or conversations, and measure the agent change against the grading that existed before.

## Step 5: Prevent the Recurrence

- If the failure mode wasn't covered by any evaluator, add one (`langwatch evaluator create`) and wire it into the experiment.
- If it only shows up in production, set up a monitor (`langwatch monitor create`) so online evaluation catches it before the next experiment does.
