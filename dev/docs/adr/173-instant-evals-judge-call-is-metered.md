# ADR-173: An LLM judge on Instant Evals is one metered, budget-checked call built in the evaluation module

**Date:** 2026-10-03

**Status:** Accepted

> One line: when an LLM-as-a-judge evaluator names Instant Evals as its model, the **evaluation module** turns its settings into one classifier **question** and maps the verdict back to today's result shape, and a new leaf module, the Instant Evals judge, answers it with a **budget check, a classification and one spend record keyed by the evaluation's own retry key**.

## Context

- tasks#915 makes Instant Evals a judge model on every LLM-as-a-judge evaluator. tasks#902 asks for the same thing and says every call goes through the gateway on purpose. The two issues are to be merged before wave 2.
- This record covers wave 1 only: question building, result mapping, the metered call and the picker entry. Wave 1 calls the classifier the way the search bar and runs already do, inside the app. Whether the call later travels out through a Lambda and back through the gateway is wave 2. Self-hosted installs are wave 3.
- ADR-144 says a search-bar classification is "counted, not metered". That stays true for the search bar. A judge call is a customer's evaluation, so it is metered. This record is the exception, and ADR-144 is unchanged.
- ADR-153 (the run is a judgment job) holds a budget reservation per run. A judge call is not a run.
- What breaks if this is wrong: customer money, and guardrails that block the wrong outputs.

## Decision

1. **The builder lives in the evaluation module.** Every built-in judge in the app (monitors, guardrails, experiments, evaluations v3 cells, and the REST route the SDK and workflow evaluator nodes call) reaches `runEvaluation` in `evaluation-execution.service.ts`. Simulation judges run in the scenario runtime with their own model picker, so they are out of wave 1. The Instant Evals branch sits beside the native branch, before the langevals dispatch. The builder is a pure rule there. Instant Evals keeps taking plain questions and never learns evaluator type names. Rejected: the builder in Instant Evals, which would make it depend on the evaluator contract's generated settings.
2. **The text keeps today's labels.** The builder writes input, output and contexts as labelled sections, the way langevals `build_content_parts` does, so a prompt that says "the output answers the input" still has both to point at. Each section is cut on its own to fit the classifier's token cap, so a long input never pushes out the whole output.
3. **Boolean keeps its polarity.** The question asks whether the instructions, applied to the text, call for `true`. Its criteria are "the instructions call for true" and "the instructions call for false". A prompt that states a fail condition ("return false if it mentions a competitor") then reads the same way it does today. `passed` is the probability of `true` against 0.5. The score stays 1 or 0, as today.
4. **Score has a range setting, read as 0 to 1 when unset.** The score judge gains an optional `min` and `max`, shown when Instant Evals is the model. The schema gives them no default, so the REST route does not stamp them onto every judge. The builder reads a missing range as 0 to 1, matching the default prompt.
   - 0 to 1 is a fraction scale, not two levels. It is asked as 1 to 10 and mapped back in a straight line with no rounding, so a weighted mean of 5.5 returns 0.5.
   - Any other whole-number range with at most 10 levels (1 to 5, 1 to 10) is asked directly and the weighted mean is returned as is. Ten is the classifier's own cap (`maxScoreLevels`).
   - Any other range (0 to 10, 0 to 100) is asked as 1 to 10 and mapped back in a straight line, 1 to `min` and 10 to `max`. When `min` and `max` are whole numbers, the mapped score is rounded to a whole number, so an answer of 2 on 0 to 10 returns 1, not 1.11.
   - The new optional fields reach the generated SDK types, the CLI catalogue and the API docs. That is the whole public change.
   - Trade-off accepted: when the judge is unsure between neighbouring levels, the weighted mean is pulled slightly toward the middle.
   - Rejected: always 0 to 1. A prompt that scores 1 to 5 would return 0 to 1, and its thresholds would stop firing.
5. **Category maps to options.** `categories` become `options`, since both use `{ name, description }`. The label is the most likely option. `passed` stays unset, as today.
6. **Details is a fixed line with the confidence.** For example "Instant Evals: true, 82% confident" or "Instant Evals: refund, 64% confident". No second model call. Rejected: asking a model for a reason, which adds a call, cost and a second billing path.
7. **A skip maps to today's statuses.**

   | Classifier outcome                                                          | Result status                                                   |
   | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
   | No content to judge                                                         | `skipped`                                                       |
   | `classifier_input_too_large`                                                | `skipped`, with the reason in details                           |
   | `classifier_not_configured`, `classifier_rate_limited`, `classifier_failed` | `error`, so alerts fire                                         |
   | Free budget spent (decision 12)                                             | `error`, carrying the code `instant_eval_free_budget_exhausted` |

   An `error` reaches each caller the way any judge error does today, such as a missing provider key. A guardrail follows its own fail-open or fail-closed setting, so a fail-closed guardrail blocks once a free organization is past $1. This was the user's call. A monitor records the error, so its alerts fire.
   - The Instant Evals branch catches the refusal and returns the `error` result itself. A thrown refusal would reach the outcome handler as a customer fault and become `skipped`, which a guardrail allows.

8. **One call is check, classify, record.**
   - Check the organization's spend against the free budget. A spent budget refuses here, before the classifier is called.
   - Classify the text.
   - Price the tokens the classifier billed.
   - Record one spend row. A call with no input tokens records nothing.
   - A call cancelled after the classifier answered still records its spend, because the classifier was paid.
   - A spend row that cannot be written is logged and the verdict kept, as a judged query does today.
   - Calls that pass the check together can take an organisation past $1. The leaf's total updates after each call is priced, so calls in flight together can still pass the check. The user accepted this. Every call past $1 still writes its spend row, so the overshoot is on record and can be charged later.
   - The result's `cost` is the price the customer pays. The evaluation cost row the costs page shows carries that price, as for any other judge, so it counts toward the customer's monthly spend limit. Stripe reads only the spend row.
9. **The spend id comes from the evaluation's retry key.** When the caller carries an operation key (a monitor's queued command, `tenantId:evaluationId:execution`), the spend request id is derived from it, so a redelivered command lands on the same row and the ledger drops the copy. A call with no key gets a fresh id: a REST call, an experiment cell, simulation grading and a guardrail check. Rejected: a fresh id on every call. A command redelivered after the judge succeeded would be billed twice.
   - Experiment cells and simulation grading retry by themselves, and each retry is billed again. The user accepted this for wave 1. Their stable keys exist (the cell's run and position, the scenario run and evaluator) and can be passed through later.
   - The monitor key is only as stable as the trigger. A trigger redelivered more than 30 seconds later mints a new evaluation id and is billed again.
   - A client that retries a REST call pays twice, as it would at its own provider today.
10. **A new method on the Instant Evals judge's contract** answers one judge call. It sits on the leaf's contract, not the Instant Evals contract (decision 13). It takes the project, the text, the question and an optional request key, and returns the verdict plus the price charged.
11. **The picker reuses the release flag `release_instant_evals`, and the option works in wave 1.** This was the user's call over a separate judge flag. The picker ships in the same pull request as the rest of wave 1. The judge model id is `langwatch/instant-evals`. The evaluation module answers it before any provider lookup, so a project with no model provider can pick it too.
12. **Only usage-billed organizations judge without a cap.** The $1 cap applies to every organization the meter does not bill: free plans, and paid plans on tiered pricing. Before, the cap read only the plan's free flag and the meter read only the pricing model, so a paid tiered organization was neither capped nor charged. Nobody had decided that overlap. Billing keeps the rule for whether the meter bills an organisation: usage pricing, a Stripe customer and an active subscription, or a connected self-hosted account. Billing now publishes that rule as an event the judge leaf folds (decision 13), and the monthly report reads the same rule. The Instant Evals run row cap reads the same fold, so the two caps agree. Consequence: a paying tiered customer stops at $1 until top-up lands in wave 3, then uses their own provider key. This also closes the gap for Instant Evals runs, which share the check. A tiered organization already past $1 is refused for runs as well as judges on the day this ships. The refusal message must not tell an organization that already pays to upgrade to a paid plan, so its copy changes in wave 1 to fit both free and paid tiered organizations.
13. **The judge call lives in a leaf module, so wave 1 adds no peer cycle.**
    - Why: evaluation calling Instant Evals closes a loop through gateway, and a second one through trace. Removing the gateway path alone leaves the trace loop. The policy allows no cycle, so wave 1 adds none.
    - Shape: a new module, the Instant Evals judge (`modules/instant-eval-judge`), with no peer Api dependency. It owns the classifier client, the pricing rule, the budget check and the judge method. Evaluation and Instant Evals both depend on it. This is the shape the guardrail ruling gives the evaluation runtime: a dependency leaf.
    - Own total: the leaf appends one priced event per call on the organisation's aggregate and folds them into that organisation's Instant Evals spend. The $1 check reads that total before the classifier is called, so the check stays as immediate as today. This follows entitlement counting from its own meters.
    - Gateway learns by event: gateway peer-subscribes to the priced event and writes the spend row the meter already reads, as it does for governance's priced pulled usage. The meter does not change.
    - Organisation lookup: the leaf folds project's `lw.project.created` into its own project to organisation map, as analytics does. Callers pass only the project.
    - Usage billing: the leaf folds a billing event that says whether the meter bills the organisation. Billing's current events carry only whether there is a subscription, so billing adds this event in wave 1.
    - Instant Evals runs record through the leaf too, so runs and judges share one total. Instant Evals drops its gateway spend reads and writes.
    - Search-bar classification moves with the classifier client and stays unmetered (ADR-144).

## Constants

| Name                       | Value                                  | Purpose                                                    |
| -------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Score range default        | min 0, max 1                           | Matches the default score prompt                           |
| Most levels asked directly | 10 (`maxScoreLevels`)                  | Wider or fractional ranges are asked as 1 to 10 and mapped |
| Judge model id             | `langwatch/instant-evals`              | What the picker stores as the judge's model                |
| Boolean threshold          | 0.5 (`INSTANT_EVAL_DEFAULT_THRESHOLD`) | `passed` on `llm_boolean`                                  |
| Free budget                | $1 (`INSTANT_EVAL_FREE_BUDGET_USD`)    | Unchanged, per free organization                           |
| Flag                       | `release_instant_evals`                | Shows the picker entry                                     |

## Invariants

| Invariant                            | Meaning                                                       | How it holds (test anchor)                                                                                       |
| ------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| One evaluation, one spend row        | A redelivered command is not billed twice                     | Unit test: the same request key gives the same spend id, and a keyed ledger keeps one row                        |
| No tokens, no row                    | A skipped judgement is never billed                           | Unit test on the judge method with a skipped classifier                                                          |
| Unbilled orgs refused past $1        | A call after the spend shows $1 is refused before classifying | Unit test: the budget check throws `InstantEvalFreeBudgetExhaustedError` and the classifier is never called      |
| Overshoot is on record               | A call that runs past $1 still writes its spend row           | Unit test: a call admitted while the leaf's total was under $1 records its full price                            |
| Fail-condition prompts keep polarity | "Return false if X" fails when X holds                        | Builder unit test on the question text, plus one live classifier check before the picker merges                  |
| Score stays on the customer's scale  | A 1 to 5 prompt returns 1 to 5                                | Builder unit tests for 0 to 1, 1 to 5 and 0 to 100                                                               |
| Every skip has a status              | No skip reads as a pass or a crash                            | Unit test over every `skippedReason`                                                                             |
| Search bar stays unmetered           | ADR-144 still holds                                           | Existing `classify` path untouched; test that it records no spend                                                |
| No peer cycle                        | Wave 1 adds no edge whose peer reaches back                   | `pnpm lint:architecture --policies peer-cycles --all` shows no new finding, and the ratchet test is not loosened |

## Assumptions

| Assumption                                              | What breaks if false                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud runs Instant Evals with Redis and `IS_SAAS`       | `INSTANT_EVAL_BOUNDED` arrives with the module tree and is not set in production (checked on the prod cluster, 2026-10-07), so unset follows `IS_SAAS`: cloud is bounded from the day the stack lands, self-hosted is not. Without Redis a bounded process refuses to boot |
| Every project has an organization                       | A project with none is uncapped and its spend row is dropped, so it judges for free                                                                                                                                                                                        |
| The langevals service port is internal in production    | Anyone reaching it runs judges with no app in between. It never reaches Instant Evals, so it is not a billing hole                                                                                                                                                         |
| The three judge settings shapes stay as generated today | The builder maps the wrong field. Its tests read the generated schemas                                                                                                                                                                                                     |
| No Instant Evals spend exists in production yet         | The module tree has not shipped, so the leaf's total starts at zero with nothing to carry over. If spend exists, the leaf must be seeded from the gateway ledger before the cap goes live                                                                                  |

## Gates

| Path                         | Reversible?                    | Blast radius                              | Gate                                                                                                                   |
| ---------------------------- | ------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Spend row per judge call     | No, it feeds the monthly meter | Large                                     | Human review of the judge method and the redelivery test before merge                                                  |
| Budget check                 | Yes                            | Large                                     | Unit tests that a refusal happens before the classifier is called and becomes an `error` result                        |
| Cap moves to `isUsageBilled` | Yes                            | Large, paying tiered customers stop at $1 | Unit tests for usage billed, tiered and free organizations, and the monthly report reading the same rule               |
| Builder and result mapping   | Yes                            | Large for guardrails                      | Unit tests against the generated schemas, plus the polarity check                                                      |
| Picker entry                 | Yes                            | Large, customer-visible                   | Ships with wave 1 behind `release_instant_evals`. Reviewer confirms the bounded flag in the deploy config before merge |
| Judge leaf                   | Yes                            | Medium                                    | The peer-cycle policy shows no new finding before merge                                                                |

## Schema

No database change. The score judge's settings gain an optional `min` and `max` in the langevals settings definition, regenerated into `evaluators.generated.ts`. Old settings without them read as 0 to 1.

## Rejected alternatives

- A hold per call: its release ran before the spend landed, so it never closed the overshoot. It cost two Redis writes per call, and a redelivered call deleted another call's hold.
- Fresh spend id per call: double bills a redelivered command.
- Score always 0 to 1: breaks prompts on other scales.
- A model-written reason: a second call and a second billing path.
- Separate judge flag: hides the picker cleanly, but the user chose not to add a flag.
- Builder in Instant Evals: one pull request, but couples it to evaluator settings.
- Accepting the cycle: the policy refuses every cycle and the ratchet test expects none.
- Removing only the gateway dependency: the loop still closes through trace.
- Evaluation reading plan or spend from entitlement, billing or gateway: each of those reaches evaluation again.

## Consequences

- Positive: one dispatch point covers every in-app judge.
- Positive: results keep today's shape and scale.
- Negative: a busy unbilled organisation can go past $1 by the calls in flight together. The spend rows record all of it.
- Negative: a retried experiment cell or simulation grading is billed per attempt.
- Negative: a fail-closed guardrail blocks a free organization's traffic once it is past $1.
- Negative: connected self-hosted accounts are billed only up to their contract ceiling, and the meter stops reporting when its breaker trips. Those organizations stay uncapped either way. A past-due organization stays usage billed, since billing has no past-due state.
- Negative: a paying tiered organization stops at $1 until top-up lands in wave 3.
- Negative: details is a confidence line, not a reason.
- Positive: wave 1 adds no peer cycle, and Instant Evals loses its gateway dependency for spend.
- Negative: wave 1 grows by one module, one priced event, one gateway subscriber and one billing event.
- Neutral: the Instant Evals process lists the evaluator contract as a dependency it never imports. Remove it in the same change.

## Open questions

- Transport: in the app or through the gateway. Owner: the user (tasks#902). Blocks wave 2.
- Merging tasks#902 into tasks#915. Owner: the user. Not blocking.
- Whether an organization's model restrictions should be able to block Instant Evals. The judge skips the provider lookup, which is where restrictions are checked. Owner: the user. Not blocking.
- Whether the priced event also lets billing meter Instant Evals directly, retiring the gateway spend row. Owner: the user. Not blocking.

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
- v4, 2026-10-07, after the second red-team pass. Captain: Sergio Esteban.
  - The option works in wave 1: the evaluation module answers `langwatch/instant-evals` before any provider lookup (decision 11).
  - The cap reads the meter's own rule through billing's `isUsageBilled` (decision 12).
  - A budget refusal is an `error` result with the reason; guardrails and monitors handle it as any judge error (decision 7).
  - Each call holds its estimated price and releases it, replacing check then call (decision 8).
  - Scores ask at most 10 levels, the classifier's cap (decision 4). Skip reasons use the classifier's own names (decision 7).
- v5, 2026-10-07, after the third red-team pass. Captain: Sergio Esteban.
  - The hold was refuted: release ran before the spend landed. The user accepted a small overshoot as long as it is recorded, so a call is check, classify, record (decision 8).
  - The user kept guardrails on their own fail setting (decision 7) and accepted per-attempt billing on experiment and simulation retries (decision 9).
  - Simulations left wave 1, since they never reach `runEvaluation` (decision 1).
  - Whole-number score ranges wider than ten levels return whole numbers; 0 to 1 is a fraction scale and is not rounded. The range has no schema default (decision 4).
  - The run row cap reads `isUsageBilled` too (decision 12).
- v6, 2026-10-07, after the dependency review. Captain: Sergio Esteban.
  - The judge call moves into a leaf module with its own spend total, and gateway learns of each call by event (decision 13). Calling Instant Evals from evaluation would have added a peer cycle the policy refuses.
  - Billing publishes whether the meter bills an organisation as an event (decision 12).
