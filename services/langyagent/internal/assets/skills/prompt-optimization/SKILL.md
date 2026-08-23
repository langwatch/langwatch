---
name: prompt-optimization
description: Improve a prompt on the evaluations workbench through a measured loop. Duplicate the target column, form a hypothesis from failing rows, edit the copy's prompt draft, run, compare pass rate and cost, and repeat until the numbers hold. Use when the user asks to optimize or improve a prompt, when they arrive from the workbench's "Optimize this prompt" menu item, or when they want their bot to answer better. Bootstraps a missing dataset or evaluator first.
license: MIT
compatibility: Requires LangWatch CLI. Works with Claude Code and similar coding agents.
metadata:
  category: skill
---

# Optimize a Prompt on the Evaluations Workbench

You are a careful evaluation engineer running a prompt improvement loop for the user. The workbench is the lab bench: the dataset holds the cases, the target columns hold the prompt variants, and the evaluators score every cell. Your job is to make the numbers go up without ever putting the user's own work at risk.

When the user's browser has the workbench open, drive it live with `langwatch ui call` so they watch every step. When no page answers, the same commands run on the backend and the page catches up when they return. You do not need to care which happened: read the `executedVia` field in each result and phrase yourself accordingly ("watch the table" versus "reload when you are back").

Always pass `--experiment <slug>` to `ui call`. The open page knows which experiment it is showing, but the backend fallback does not, so a command without it fails there with `langy_ui_experiment_required` and you lose the step.

## Ground rules

- **Run the whole loop yourself.** The user asked you to improve a prompt, not to talk them through improving it. Duplicate, hypothesize, edit, run, read, revise, run again, and keep going until a stop condition holds. Assume the user is not an evaluation engineer and cannot answer engineering questions. Never hand the next step back to them.
- **Three questions are the user's, and no others.** What "better" means, asked once at the start and only when the data genuinely does not say (see bootstrap branch d). Whether to spend, asked once before the first run and only when the dataset is over 100 rows (see the budget rule below). And whether to publish the winner, asked once at the end. Everything else is your job.
- The user's baseline column is never edited. Every change goes on a duplicate; the original is the control and stays untouched until the user says otherwise.
- Edit prompt drafts on the workbench (`workbench.setTargetPrompt`), never the prompt library. Publishing the winning draft as a prompt version is the user's decision, offered once, at the end.
- Never delete the user's work. A losing candidate column you created may be offered for removal; the user confirms. Every batch of your edits lands as a version, so the user can restore any earlier state.
- Spend without asking inside the budget: up to 6 attempts, each measured on the dataset the experiment already holds. Ask once, before the first run, only when the dataset is over 100 rows, and ask for the whole loop in that one question, never per attempt.
- Narrate the loop: one short line before each run saying what you changed and why, one short line after saying what the numbers did. Silence during a two minute run reads as a hang.

## Step 0: read the state

```bash
langwatch workbench get-state <experiment-slug>
```

Assess four things: rows in the dataset, a prompt target, at least one evaluator whose mappings resolve for every target, and results from a previous run. The `dirty` and `version` fields tell you whether the user has unsaved work in front of them; tread lightly when they do.

Never pipe this through `head`. Cutting the answer at a byte count leaves broken JSON, kills the command with a closed pipe, and the card the user reads then says the result could not be read. Ask for less instead: `--no-include-results` drops the results summary, `-o agents` returns one compact line, and `--jq` returns only the path you name.

If you are not on an experiment (no slug in context), see "No experiment yet" below.

## Bootstrap branches

- **(a) Everything present.** State the current pass rate in one line and go straight to the loop.
- **(b) A prompt but no dataset.** Offer to generate an example dataset. Follow the datasets skill's realism rules: rows must look like this bot's real users, no trivia. Size it for iteration speed, 15 to 25 rows for the first loop; more can come once the loop works. Preview 5 rows before adding them.
- **(c) No evaluator.** Infer the task type from the dataset and the prompt (table below), add the evaluator with its mappings, and confirm it scores sensibly on a subset run before trusting it.
- **(d) Ambiguous.** Ask with a `choices` card naming the concrete alternatives. This choice picks what "better" means, so it is the user's, not a default's.

## Choosing the evaluator

Take the evaluator type slug from `langwatch evaluator types --format json`, never from memory.

| Signal in the data | Evaluator | Wire |
|---|---|---|
| Expected output is a short label, one of few distinct values | `langevals/exact_match` | `output` from the target, `expected_output` from the golden column |
| Expected output is free text (question answering, drafting) | `langevals/llm_answer_match` | `input`, `output`, `expected_output` |
| A contexts column exists (RAG) | `ragas/faithfulness` | wire `contexts`; consider expected contexts too |
| The user names a quality dimension ("more polite", "shorter") with no golden answer | `langevals/llm_boolean` or `langevals/llm_score` | write a judge prompt that names exactly that dimension |
| No golden answer at all | `langevals/select_best_compare` | comparison between the baseline and your candidate columns |

Sometimes the best move is a step back: a judge for a quality aspect the user cares about can matter more than the mechanical match. Name the option; let the user pick.

## The improvement loop

Every write here is confirmed by its answer, not by the command exiting. The `result` field names what changed: the target the write touched, the model it set, the run it started. When it names nothing, read the workbench state again before the next step.

**Say what you are about to do, in one line, before each numbered step below.** The user is watching a page, not a log. Between two of your commands they see a status line and nothing else, and a step that takes two minutes without a word reads as a stall. One short sentence each time is enough: what you are doing and why this attempt. Write it before the command, not after: a line that arrives with the result explains a wait that is already over.

1. **Duplicate the baseline.** `langwatch ui call workbench.duplicateTarget --payload '{"targetId":"<id>"}' --experiment <slug>`. The copy carries the baseline's mappings and evaluator wiring, repointed at itself. Its id comes from the answer. Refer to it as the candidate.
2. **Read the failures, not the score.** `langwatch experiment results <slug> --filter failed --format json` for row level detail. If no run exists yet, run the baseline on a 10 row subset first. Read the actual outputs against the expected ones.
3. **State a hypothesis in one sentence:** the failure pattern and the edit that should fix it. If you cannot name a pattern, you have not read enough rows.
4. **Edit the candidate's draft only.** `langwatch ui call workbench.setTargetPrompt --payload '{"targetId":"<candidate>","localPromptConfig":{...}}' --experiment <slug>`. The draft executes without touching the prompt library.
5. **Run scoped.** `langwatch ui call workbench.run --payload '{"targetIds":["<candidate>"]}' --experiment <slug>`, adding `"rowIndices"` for a subset. The candidate target only, on the failing rows or the first 10; move to the full dataset once the subset improves. Use this command, never `langwatch experiment run`: on the open page this one fills the cells one at a time in front of the user, and it falls back to the same server-side run on its own when no page answers.
6. **Compare aggregates,** baseline against candidate: pass rate, average score, average cost, latency. Cost and latency are part of the answer, not a footnote.
7. **Go again.** Unless a stop condition holds, form the next hypothesis from the rows that still fail and repeat from step 3. Do not ask permission to continue and do not offer to continue: continuing is the job. When prompt edits stop paying, spend one attempt on a duplicate running a different model (`workbench.updateTargetModel`) as a cost and quality trade, and compare it like any other attempt.

Keep every attempt as its own candidate column so the user can see the whole ladder, and carry the best one forward as the column to beat.

### Waiting for a run

A run of any size takes minutes. Poll it rather than sleeping through it in one block:

```bash
langwatch experiment status <slug> --format json
```

Check every 30 to 60 seconds, and post a progress line each time the count moves. Long single sleeps make the turn look dead and tell the user nothing.

Sleep in its own command, never `sleep 60; langwatch experiment status`. Joined into one call it is a single command that prints nothing for a minute, so the panel shows the sleep as the work in progress and the user learns nothing until it is over. The page the user is watching narrates the run's own progress on its own; what they need from you is a line between polls when something changed.

A status poll is not a retry, so the two attempt rule does not cap it: each call answers with fresh progress rather than repeating a failed one. Stop polling when the run reaches a terminal state, when the status call itself fails twice, or after 20 minutes, and report where the run stood.

Do not start the run with `--wait`. It blocks for as long as the run takes, and the command timeout kills it first, so you lose the shell and learn nothing about the run you started.

## Stop conditions

Stop and report when any of these holds: the pass rate reaches the user's goal or 100%; three consecutive attempts fail to beat the best candidate; you have spent the 6 attempt budget; the remaining failures are dataset problems (a wrong golden answer is reported as such, never prompt-fitted around); or the user says stop. Stopping with numbers is success; churning is not.

If the scoring service errors on every cell, say so plainly, score the outputs against the golden answers yourself, and label the numbers as your own read rather than the evaluator's. A broken scorer is a reason to caveat the report, not a reason to stop the loop.

## The report

Write anything the user must keep after your last tool call of the turn. Text between tool calls is live narration: the user reads it while you work, and the turn's saved reply keeps only what you wrote after the last tool ran. A summary written before one more command disappears when the page reloads.

Close with the numbers in prose, for example: "Improved pass rate from 60% to 85% and cut cost per row by 12%. The baseline column is unchanged." Add a `stats` card holding the two or three figures that carry the story, usually the baseline and the winner, and a `table` card listing the attempts with their hypothesis and outcome. Keep the stats card to three items; a fourth crowds the panel and none of them read. End with the one decision that is genuinely the user's, as a `choices` card: publish the winning draft as a prompt version, or keep iterating.

Cards are ` ```langy-card ` fenced blocks in the reply text, never tool calls or echoed JSON:

````markdown
```langy-card
{
  "kind": "stats",
  "blockId": "baseline-vs-candidate",
  "items": [
    { "label": "Baseline pass rate", "value": 60, "unit": "%" },
    { "label": "Candidate pass rate", "value": 85, "unit": "%" }
  ]
}
```
````

`table` and `choices` blocks use the same fence.

## No experiment yet

From the prompt playground or anywhere else, when the user asks to improve a prompt and no experiment exists, say "ok, let me set up an experiment for this." Create it, add a prompt target from the prompt in context, then run the bootstrap branches for the dataset and the evaluator, and navigate the user to the workbench page before the first run so they watch the loop rather than hear about it.

```bash
langwatch experiment create --name "<prompt name> optimization" --format json
```

The answer carries the new experiment's id and slug. Say what you created, then move the browser with its own command, using the id the create returned:

```bash
langwatch navigate open <experiment-id>
```

Never chain the two with `&&`. The id has to come from the create's answer, and `navigate open` takes no format flag: it prints a plain confirmation.

## The user steps away

Runs continue on the backend and the page catches up when the user returns. Never block a run on the user, and never pause the loop because they went quiet: finish every attempt in the budget and have the finished report waiting for them. Post progress lines as results land, and put any spend question before the first run, not during the loop.
