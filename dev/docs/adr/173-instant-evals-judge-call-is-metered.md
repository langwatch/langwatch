# ADR-173: An LLM judge on Instant Evals is one metered, budget-checked call built in the evaluation module

**Date:** 2026-10-03

**Status:** Accepted

> One line: when an LLM-as-a-judge evaluator names Instant Evals as its model, the **evaluation module** turns its settings into one classifier **question** and maps the verdict back to today's result shape, and the Instant Evals module answers it with a **budget check, a classification and one spend record keyed by the evaluation's own retry key**.

## Context

- tasks#915 makes Instant Evals a judge model on every LLM-as-a-judge evaluator. tasks#902 asks for the same thing and says every call goes through the gateway on purpose. The two issues are to be merged before wave 2.
- This record covers wave 1 only: question building, result mapping, the metered call and the picker entry. How the call travels (in the app, or out through a Lambda and back through the gateway) is wave 2. Self-hosted installs are wave 3.
- ADR-144 says a search-bar classification is "counted, not metered". That stays true for the search bar. A judge call is a customer's evaluation, so it is metered. This record is the exception, and ADR-144 is unchanged.
- ADR-153 (the run is a judgment job) holds a budget reservation per run. A judge call is not a run.
- What breaks if this is wrong: customer money, and guardrails that block the wrong outputs.

## Decision

1. **The builder lives in the evaluation module.** Every built-in judge in the app (monitors, guardrails, experiments, evaluations v3 cells, simulations, and the REST route the SDK and workflow evaluator nodes call) reaches `runEvaluation` in `evaluation-execution.service.ts`. The Instant Evals branch sits beside the native branch, before the langevals dispatch. The builder is a pure rule there. Instant Evals keeps taking plain questions and never learns evaluator type names. Rejected: the builder in Instant Evals, which would make it depend on the evaluator contract's generated settings.
2. **The text keeps today's labels.** The builder writes input, output and contexts as labelled sections, the way langevals `build_content_parts` does, so a prompt that says "the output answers the input" still has both to point at. Each section is cut on its own to fit the classifier's token cap, so a long input never pushes out the whole output.
3. **Boolean keeps its polarity.** The question asks whether the instructions, applied to the text, call for `true`. Its criteria are "the instructions call for true" and "the instructions call for false". A prompt that states a fail condition ("return false if it mentions a competitor") then reads the same way it does today. `passed` is the probability of `true` against 0.5. The score stays 1 or 0, as today.
4. **Score has a range setting, default 0 to 1.** The score judge gains an optional `min` and `max`, shown when Instant Evals is the model. It defaults to 0 to 1, matching the default prompt.
   - When the range is whole numbers with at most 11 levels (1 to 5, 0 to 10), those levels are asked directly and the weighted mean is returned as is.
   - Any other range (0 to 1, 0 to 100) is asked as 0 to 10 and mapped back in a straight line to `min` and `max`.
   - Trade-off accepted: when the judge is unsure between neighbouring levels, the weighted mean is pulled slightly toward the middle.
   - Rejected: always 0 to 1. A prompt that scores 1 to 5 would return 0 to 1, and its thresholds would stop firing.
5. **Category maps to options.** `categories` become `options`, since both use `{ name, description }`. The label is the most likely option. `passed` stays unset, as today.
6. **Details is a fixed line with the confidence.** For example "Instant Evals: true, 82% confident" or "Instant Evals: refund, 64% confident". No second model call. Rejected: asking a model for a reason, which adds a call, cost and a second billing path.
7. **A skip maps to today's statuses.**

   | Classifier outcome | Result status |
   |---|---|
   | No content to judge | `skipped` |
   | `input_too_large` | `skipped`, with the reason in details |
   | `not_configured`, `rate_limited`, `failed` | `error`, so alerts fire |

8. **One call is check, classify, record.**
   - Check the free budget with `assertWithinBudget`.
   - Classify the text.
   - Price it with `priceOf`.
   - Record one spend row through `recordSpend`.
   - A call with no input tokens records nothing.
   - The result's `cost` is the price the customer pays, matching the spend row.
9. **The spend id comes from the evaluation's retry key.** When the caller carries an operation key (monitors, guardrails, and any queued command), the spend request id is derived from it, so a redelivered command lands on the same row and the ledger drops the copy. A call with no key (a REST call) gets a fresh id. A client that retries such a call pays twice, as it would at its own provider today. Rejected: a fresh id on every call. A command redelivered after the judge succeeded would be billed twice.
10. **A new method on the Instant Evals contract** answers one judge call. It takes the project, the text, the question and an optional request key, and returns the verdict plus the price charged.
11. **The picker reuses the release flag `release_instant_evals`.** This was the user's call over a separate judge flag. The picker ships in the same pull request as the rest of wave 1, by the user's call. Until wave 2 gives the option a working path, it shows to every organization with Instant Evals and fails with "Provider langwatch is not configured".
12. **Only usage-billed organizations judge without a cap.** The $1 cap applies to every organization the meter does not bill: free plans, and paid plans on tiered pricing. Before, the cap read only the plan's free flag and the meter read only the pricing model, so a paid tiered organization was neither capped nor charged. Nobody had decided that overlap. The cap now asks the billing lookup whether the organization is usage billed. Consequence: a paying tiered customer stops at $1 until top-up lands in wave 3, then uses their own provider key. This also closes the gap for Instant Evals runs, which share the check.

## Constants

| Name | Value | Purpose |
|---|---|---|
| Score range default | min 0, max 1 | Matches the default score prompt |
| Most levels asked directly | 11 | Wider or fractional ranges are asked as 0 to 10 and mapped |
| Boolean threshold | 0.5 (`INSTANT_EVAL_DEFAULT_THRESHOLD`) | `passed` on `llm_boolean` |
| Free budget | $1 (`INSTANT_EVAL_FREE_BUDGET_USD`) | Unchanged, per free organization |
| Flag | `release_instant_evals` | Shows the picker entry |

## Invariants

| Invariant | Meaning | How it holds (test anchor) |
|---|---|---|
| One evaluation, one spend row | A redelivered command is not billed twice | Unit test: judge behind the execution receipt, first attempt fails after the judge, redelivery leaves one ledger row |
| No tokens, no row | A skipped judgement is never billed | Unit test on the judge method with a skipped classifier |
| Free orgs refused past $1 | A call after the budget is spent is refused before classifying | Unit test: exhausted budget throws `InstantEvalFreeBudgetExhaustedError` and the judge is never called |
| Fail-condition prompts keep polarity | "Return false if X" fails when X holds | Builder unit test on the question text, plus one live classifier check before the picker merges |
| Score stays on the customer's scale | A 1 to 5 prompt returns 1 to 5 | Builder unit tests for 0 to 1, 1 to 5 and 0 to 100 |
| Every skip has a status | No skip reads as a pass or a crash | Unit test over every `skippedReason` |
| Search bar stays unmetered | ADR-144 still holds | Existing `classify` path untouched; test that it records no spend |

## Assumptions

| Assumption | What breaks if false |
|---|---|
| Cloud sets `INSTANT_EVAL_BOUNDED=true` | It is off by default. Without it, no free organization is ever capped. Check the deploy config before the picker merges |
| Judge calls per free organization per minute stay modest | The spend total is cached a minute per process. A monitor burst inside that minute can go past $1 by what that minute judged |
| Every project has an organization | A project with none is treated as paid and its spend row is dropped, so it judges for free |
| The langevals service port is internal in production | Anyone reaching it runs judges with no app in between. It never reaches Instant Evals, so it is not a billing hole |
| The three judge settings shapes stay as generated today | The builder maps the wrong field. Its tests read the generated schemas |

## Gates

| Path | Reversible? | Blast radius | Gate |
|---|---|---|---|
| Spend row per judge call | No, it feeds the monthly meter | Large | Human review of the judge method and the redelivery test before merge. No caller exists until wave 2 |
| Budget check | Yes | Large | Unit test that refusal happens before the classifier is called |
| Builder and result mapping | Yes | Large for guardrails | Unit tests against the generated schemas, plus the polarity check |
| Picker entry | Yes | Large, customer-visible | Ships with wave 1 behind `release_instant_evals`. Reviewer confirms the bounded flag in the deploy config before merge. Until wave 2 the option fails by name, never silently |

## Schema

No database change. The score judge's settings gain an optional `min` and `max` in the langevals settings definition, regenerated into `evaluators.generated.ts`. Old settings without them read as 0 to 1.

## Rejected alternatives

- Reservation per call: never overshoots, but costs two Redis writes and risks stuck holds.
- Fresh spend id per call: double bills a redelivered command.
- Score always 0 to 1: breaks prompts on other scales.
- A model-written reason: a second call and a second billing path.
- Separate judge flag: hides the picker cleanly, but the user chose not to add a flag.
- Builder in Instant Evals: one pull request, but couples it to evaluator settings.

## Consequences

- Positive: one dispatch point covers every in-app judge.
- Positive: results keep today's shape and scale.
- Negative: a free organization can go past $1 by what one minute of judging costs.
- Negative: details is a confidence line, not a reason.
- Negative: until wave 2, the picker shows an option that fails by name for every organization with Instant Evals, because the flag is shared.
- Neutral: the Instant Evals process lists the evaluator contract as a dependency it never imports. Remove it in the same change.

## Open questions

- Transport: in the app or through the gateway. Owner: the user, with Rogério (tasks#902). Blocks wave 2.
- Merging tasks#902 into tasks#915. Owner: the user. Not blocking.

## Revisions

- v1, 2026-10-03, captain: Sergio Esteban.
  - Locked check-then-call and builder in the evaluation module.
  - Locked score 0 to 10, after the trade-off was laid out.
  - Locked reuse of the release flag, overruling the recommended separate flag.
- v2, 2026-10-03, after the red-team pass.
  - Double billing on redelivery refuted the fresh spend id. The id now comes from the evaluation's retry key.
  - The score mapping was refuted by prompts on other scales. The user chose a range setting with a 0 to 1 default.
  - Lost details: the user chose a fixed confidence line.
  - Boolean polarity, flattened text, skip statuses and the cost field were refuted and fixed in decisions 2, 3, 7 and 8.
  - Dispatch survived, narrowed: every in-app judge reaches one point. Only direct calls to the langevals port go around it.
  - The budget check survived, narrowed by the bounded-flag, cache and no-organization assumptions.
- v3, 2026-10-03, Accepted. Captain: Sergio Esteban.
  - The user capped paid tiered organizations at $1 (decision 12).
  - Wave 1 ships as one pull request stacked on #7536, picker included (decision 11). It first stacked on #8463, whose fixes #7536 now holds.
