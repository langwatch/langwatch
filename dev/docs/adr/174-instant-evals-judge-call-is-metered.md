# ADR-174: An LLM judge on Instant Evals is one metered, budget-checked call built in the evaluation module

**Date:** 2026-10-03

**Status:** Accepted

> One line: when an LLM-as-a-judge evaluator names Instant Evals as its model, the **evaluation module** turns its settings into one classifier **question** and maps the verdict back to today's result shape, and a new leaf module, the Instant Evals judge, answers it with a **budget check, a classification and one spend record keyed by the evaluation's own retry key**. The meter, the pricing rule and the $1 budget check already exist in Instant Evals and are reused; wave 1 only connects the judge to them.

## Context

- tasks#915 makes Instant Evals a judge model on every LLM-as-a-judge evaluator. tasks#902 asks for the same thing and says every call goes through the gateway on purpose. The two issues are to be merged before wave 2.
- This record covers wave 1 only: question building, result mapping, the metered call and the picker entry. Wave 1 calls the classifier the way the search bar and runs already do, inside the app. Whether the call later travels out through a Lambda and back through the gateway is wave 2. Self-hosted installs are wave 3.
- Hard rule (the user, 2026-10-08): customers use LangWatch's servers and never supply their own classifier key. The judge runs on cloud only in wave 1 (decision 14).
- Instant Evals is on main today, under `platform/app`. This pull request stacks on #7536, which moves it into `modules/instant-eval` and lands on main first. Nobody is charged for Instant Evals yet: the meter (`langwatch_instant_eval_usd`), its pricing rule and the $1 budget check exist, but neither Stripe catalogue holds an Instant Evals price.
- ADR-144 says a search-bar classification is "counted, not metered". That stays true for the search bar. A judge call is a customer's evaluation, so it is metered, by the existing Instant Evals meter. This record is the exception, and ADR-144 is unchanged.
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
   | Project the judge leaf does not know yet (decision 15)                      | `error`, carrying the code `instant_eval_project_unknown`       |
   | Install is not LangWatch cloud (decision 14)                                | `error`, as `classifier_not_configured`                         |
   | Guardrail on the stream chunk direction (decision 16)                       | `skipped`, with the reason in details                           |

   An `error` reaches each caller the way any judge error does today, such as a missing provider key. A guardrail follows its own fail-open or fail-closed setting, so a fail-closed guardrail blocks once a free organization is past $1. This was the user's call. A monitor records the error, so its alerts fire.
   - The Instant Evals branch catches the refusal and returns the `error` result itself. A thrown refusal would reach the outcome handler as a customer fault and become `skipped`, which a guardrail allows.
   - The error code survives into the stored result, in its error text. The judge's error details name the code, and the outcome handler stores them as the error. Wave 1 adds no error-code column; a test pins that the text keeps the code.

8. **One call is check, classify, record.**
   - Check the organization's spend against the free budget, with the existing $1 check. A spent budget refuses here, before the classifier is called.
   - Classify the text.
   - Price the tokens the classifier billed, with the existing Instant Evals pricing rule.
   - Record one spend row. A call with no input tokens records nothing.
   - A call cancelled after the classifier answered still records its spend, because the classifier was paid.
   - A spend row that cannot be written is logged and the verdict kept, as a judged query does today.
   - Calls that pass the check together can take an organization past $1. The leaf's total updates after each call is priced, so calls in flight together can still pass the check. The user accepted this. Every call past $1 still writes its spend row, so the overshoot is on record and can be charged later.
   - A spend row reaches the gateway ledger after gateway handles the priced event, a short delay. The run check reads that ledger, so it lags by the same delay. This adds to the overshoot above, and every row is still written.
   - The result's `cost` is the price the customer pays. The evaluation cost row the costs page shows carries that price, as for any other judge, so it counts toward the customer's monthly spend limit. Stripe reads only the spend row.
9. **The spend id comes from the evaluation's retry key.** When the caller carries an operation key (a monitor's queued command, `tenantId:evaluationId:execution`), the spend request id is derived from it, so a redelivered command lands on the same row and the ledger drops the copy. A call with no key gets a fresh id: a REST call, an experiment cell, simulation grading and a guardrail check. Rejected: a fresh id on every call. A command redelivered after the judge succeeded would be billed twice.
   - Experiment cells and simulation grading retry by themselves, and each retry is billed again. The user accepted this for wave 1. Their stable keys exist (the cell's run and position, the scenario run and evaluator) and can be passed through later.
   - The monitor key is only as stable as the trigger. A trigger redelivered more than 30 seconds later mints a new evaluation id and is billed again.
   - A client that retries a REST call pays twice, as it would at its own provider today.
10. **A new method on the Instant Evals judge's contract** answers one judge call. It sits on the leaf's contract, not the Instant Evals contract (decision 13). It takes the project, the text, the question and an optional request key, and returns the verdict plus the price charged.
11. **The picker reuses the release flag `release_instant_evals`, and the option works in wave 1.** This was the user's call over a separate judge flag. The picker ships in the same pull request as the rest of wave 1. The judge model id is `langwatch/instant-evals`. The evaluation module answers it before any provider lookup, so a project with no model provider can pick it too.
12. **Only usage-billed organizations judge without a cap.** The $1 cap applies to every organization the meter does not bill: free plans, and paid plans on tiered pricing. Before, the cap read only the plan's free flag and the meter read only the pricing model, so a paid tiered organization was neither capped nor charged. Nobody had decided that overlap. Billing keeps the rule for whether the meter bills an organization: usage pricing, a Stripe customer and an active subscription, or a connected self-hosted account. Billing now publishes that rule as an event the judge leaf folds (decision 13), and the monthly report reads the same rule. In wave 1 only the judge call reads the fold. Instant Evals runs and judged queries keep main's free-plan rule for their $1 check and their row cap, so they never read the fold while it starts empty. Moving them to the meter's rule is tiered-pricing work, tracked in the wave 1 issue. Kept in v8 after a review against main: capping every organization would cap Growth customers, who have no cap today. Until the Stripe price for Instant Evals exists, usage-billed organizations judge uncapped and uncharged, and every call still writes its spend row, so it can be charged once the price exists. Consequence: a paying tiered customer's judge calls stop at $1 until top-up lands in wave 3, then uses their own provider key. Their runs keep today's behaviour until the tiered work lands. The refusal message must not tell an organization that already pays to upgrade to a paid plan, so its copy changes in wave 1 to fit both free and paid tiered organizations.
13. **The judge call lives in a leaf module, so wave 1 adds no peer cycle and cuts no edge.**
    - Why: evaluation calling Instant Evals closes a loop through gateway, and a second one through trace. The policy allows no new cycle. Cutting an existing edge needs a ruling first (ARCHITECTURE, peer cycles), and the leaf alone breaks the new loop, so wave 1 cuts none.
    - Shape: a new module, the Instant Evals judge (`modules/instant-eval-judge`), with no peer Api dependency. It owns the cloud classifier client (LangWatch's own key), the pricing rule (moved from Instant Evals unchanged), the existing $1 budget check and the judge method. Evaluation and Instant Evals both depend on it. This is the shape the guardrail ruling gives the evaluation runtime: a dependency leaf.
    - Moving the cloud client moves its key, URL, model and rate settings, and its rate limiter, to the leaf, since each setting has one owner. Instant Evals then cannot tell at startup whether the cloud key is set, because a peer Api cannot be called during startup. The leaf offers a check for it, and Instant Evals makes its cloud or Connect choice on the first call instead. This lands with the judge method.
    - The Connect classifier stays in Instant Evals. Connect goes through licensing, and licensing lists Instant Evals as a dependency (`licensing.app.ts`), so the leaf calling it would close a loop. Instant Evals keeps choosing between the cloud key and Connect for its runs and search bar, as today.
    - Own tables: the leaf keeps its own copy of the facts it needs, in its own tables (Schema). This is the documented pattern: "A peer subscriber writes its own read-model row" (ARCHITECTURE, eventing), and authz learns who is deactivated "into its own table, never from the User table". Data privacy, authz and nurturing already do this.
    - Own total: the leaf appends one priced event per call on the organization's aggregate and writes it as one spend row per request id. A row already there is never written again, so a repeated event, a retried run or a rebuild adds nothing. A running total cannot do this, since the live fold skips repeats by event id and only a rebuild skips them by key. The leaf's total is the sum of the organization's rows. The spend catch-up copies older spend in as rows under their own request ids (decision 17). The judge's $1 check reads that total before the classifier is called, so the check stays as immediate as today.
    - Gateway learns by event: the priced event carries the project, organization, model, tokens, price and request id. Gateway peer-subscribes and writes the spend row the meter already reads, looking up the team through the project dependency it already has. The request id makes a repeated event one row. This is how gateway already handles governance's priced pulled usage. The meter does not change.
    - Organization lookup: the leaf folds project's `lw.project.created` into its own project to organization map, as data privacy does. A project move stays inside its organization, so the map never changes after creation. A judge call passes only the project, since evaluation does not know the organization. Instant Evals runs and judged queries pass the organization Instant Evals already resolves, so they never depend on the map.
    - The leaf's subscribers ignore repeats themselves: a peer event is delivered at least once and never deduplicated for them. The project row and the billing row are upserts by key, and gateway keeps one spend row per request id.
    - Usage billing: the leaf folds a billing event that says whether the meter bills the organization. Billing's current events carry only whether there is a subscription, so billing adds this event in wave 1.
    - Instant Evals keeps its gateway dependency, and its run check keeps reading the gateway total. Its runs and judged queries record spend through the leaf instead of calling gateway. A hosted Connect call keeps writing the gateway ledger itself, since its row names the calling key and the leaf's fact carries no key. The leaf's total then counts runs, queries and judges against one $1. The new Instant Evals to leaf edge closes no loop, since the leaf calls nobody.
    - A run keeps today's rule: if its priced event cannot be stored, the recording fails and the run retries it.
    - Search-bar classification moves with the classifier client and stays unmetered (ADR-144).
    - The picker checks the opt-in. The judge call does not recheck it, since the $1 cap already guards spend.
14. **The judge runs on LangWatch cloud only, with LangWatch's key.** Customers never supply a classifier key (the user's hard rule). The leaf answers `classifier_not_configured` on any install that is not cloud. The public self-hosting docs, `.env.example` and the error tip in `remediation.ts` stop telling customers to set `JEV_API_KEY` with their own key. Self-hosted judging waits for wave 3. Rejected: letting a self-hosted operator judge with their own key, which the hard rule forbids.
15. **A judge call for a project the leaf does not know is refused, never judged free.** The leaf learns each project's organization from project's created event. Until it holds a project, a judge call for it returns `error` with `instant_eval_project_unknown` and calls no classifier. Runs and judged queries are never refused this way, since they pass their organization. Rejected: judging an unknown project uncapped, which would let it judge for free and drop its spend row.
    - A project whose created event fails to write is logged and dropped today, and the log names the wrong recovery. The log is fixed to name `backfill-project-created`, and a re-run of that job teaches the leaf the project.
16. **Guardrails never judge a stream chunk.** A guardrail can run on every chunk of a streamed reply, which would charge one reply many times. The guardrail check passes its direction to the evaluation, and the Instant Evals branch returns `skipped` on the stream chunk direction, with the reason in details. The gateway reads a skip as allow. It still judges the request, and the response of a reply that is not streamed.
    - A streamed reply's output is not judged by an Instant Evals guardrail in wave 1. The gateway checks only the request and each chunk of a streamed reply, never the full response (`services/aigateway/app/pipeline/guardrail.go`). A full-response check on the stream path is later work, tracked in the wave 1 issue.
17. **Three catch-up jobs run right after the rollout.** Subscribers never replay old events (ARCHITECTURE, eventing), so the leaf's tables start empty.
    - Projects: re-run project's existing `backfill-project-created` task. A re-run can store a second copy of a fact. The leaf's project row is an upsert by project, so the copy changes nothing.
    - Usage billing: a new billing task sends the usage-billed fact for every organization, billed or not. Without it, billed organizations read as capped. The task stamps each fact with the instant it read billing and keys it `${organizationId}:usage-billed:catch-up:${readAtMs}`, so a re-run is a new fact the event store keeps. Billing stamps each real fact after the write that changed the answer has committed. The newest stamp wins, and a real fact wins a tie. A catch-up read before a change is stamped before that change's real fact, so it never overrides it. A catch-up read after a change already holds the new answer. A re-run after a rollback corrects any change the leaf missed while old pods ran without its subscriber.
    - Spend: a new Instant Evals task copies each confirmed Instant Evals row in the gateway ledger into the leaf as a spend row under its request id. A request id the leaf already holds is skipped, whichever side wrote it first. There is no cutover, so a re-run at any time adds only rows still missing. A ledger row written after the task ran, by a lagging fold or by an old pod during a rollback, is copied by the next run. The release runs it again once the gateway's spend fold has caught up, and again after any rollback and redeploy.
    - A run records every attempt under one request id, `instanteval_<runId>` (`instant-eval-spend-outcome.rules.ts`). A finish confirmed by an old pod and retried on a new one is one ledger row and one leaf row.
    - Nothing runs module tasks on deploy today (`dev/docs/plans/migrations-rethink-2026-10-06.md`, K4). The release runs the three jobs by hand right after the rollout, in this order: usage billing, spend, then projects. The flag is already on for organizations that use Instant Evals, so the picker shows at deploy. Until the project job finishes, the judge refuses calls for existing projects as unknown, so they are not judged against an empty total or an empty billing copy. A project created live during that window is learned at once and judges against what the leaf holds so far, which can give an organization that already spent its dollar up to one more dollar until the spend job has run. Every such call writes its spend row, and the overshoot stops at one dollar per organization. This is the accepted overshoot: recorded, never free. Runs and judged queries keep working through that window, since they pass their organization and keep main's free-plan rule.
    - A project whose created fact is lost is refused until someone re-runs the project job. The failure log names `backfill-project-created`, and the judge's unknown-project refusal logs the project, so the gap shows on its first refused call.
    - Two billing changes send no usage-billing fact today: an operator setting the self-hosted flag, which lives in the organization module, and the tiered-to-usage pricing task, which moves only organizations with no subscription, so their answer stays "not billed". A re-run of the usage-billing catch-up corrects both.

## Constants

| Name                        | Value                                  | Purpose                                                    |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Score range default         | min 0, max 1                           | Matches the default score prompt                           |
| Most levels asked directly  | 10 (`maxScoreLevels`)                  | Wider or fractional ranges are asked as 1 to 10 and mapped |
| Judge model id              | `langwatch/instant-evals`              | What the picker stores as the judge's model                |
| Boolean threshold           | 0.5 (`INSTANT_EVAL_DEFAULT_THRESHOLD`) | `passed` on `llm_boolean`                                  |
| Free budget                 | $1 (`INSTANT_EVAL_FREE_BUDGET_USD`)    | Unchanged, per free organization                           |
| Flag                        | `release_instant_evals`                | Shows the picker entry, as does the organization's opt-in  |
| Unknown project code        | `instant_eval_project_unknown`         | Refusal before the leaf knows a project (decision 15)      |
| Skipped guardrail direction | `stream_chunk`                         | The guardrail check never judges it (decision 16)          |

## Invariants

| Invariant                            | Meaning                                                         | How it holds (test anchor)                                                                                             |
| ------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| One evaluation, one spend row        | A redelivered command is not billed twice                       | Unit test: the same request key gives the same spend id, and a keyed ledger keeps one row                              |
| No tokens, no row                    | A skipped judgement is never billed                             | Unit test on the judge method with a skipped classifier                                                                |
| Unbilled orgs refused past $1        | A call after the spend shows $1 is refused before classifying   | Unit test: the budget check throws `InstantEvalFreeBudgetExhaustedError` and the classifier is never called            |
| Overshoot is on record               | A call that runs past $1 still writes its spend row             | Unit test: a call admitted while the leaf's total was under $1 records its full price                                  |
| Fail-condition prompts keep polarity | "Return false if X" fails when X holds                          | Builder unit test on the question text, plus one live classifier check before the picker merges                        |
| Score stays on the customer's scale  | A 1 to 5 prompt returns 1 to 5                                  | Builder unit tests for 0 to 1, 1 to 5 and 0 to 100                                                                     |
| Every skip has a status              | No skip reads as a pass or a crash                              | Unit test over every `skippedReason`                                                                                   |
| Search bar stays unmetered           | ADR-144 still holds                                             | Existing `classify` path untouched; test that it records no spend                                                      |
| No peer cycle                        | Wave 1 adds no edge whose peer reaches back                     | `pnpm lint:architecture --policies peer-cycles --all` shows no new finding, and the ratchet test is not loosened       |
| No edge cut                          | Every existing peer dependency stays                            | Instant Evals still lists gateway; the peer-cycle findings list loses no line                                          |
| Unknown project never judged free    | A project the leaf has not learned is refused                   | Unit test: the judge method returns `instant_eval_project_unknown` and the classifier is never called                  |
| Cloud only                           | No install judges with a customer's own key                     | Unit test: off cloud the judge answers `classifier_not_configured` with a key set                                      |
| Stream chunks never judged           | One streamed reply is charged once per direction, not per chunk | Unit test on the guardrail check for the `stream_chunk` direction                                                      |
| Catch-up jobs are safe to re-run     | A second run adds no spend and changes no billing answer        | Integration tests: copying twice gives one row per request; a re-run of the usage-billed task keeps the answer         |
| Copied and live spend never overlap  | A request in both the ledger and the leaf is counted once       | Integration test: the live priced event folded before and after the copy, one row each time                            |
| One request, one leaf row            | Two priced events for one request add one row                   | Integration test: two events with different ids and one request id, live and on rebuild, give one row                  |
| One run, one request id              | Every finish attempt of a run records under the same request id | Unit test: a retried finish records under `instanteval_<runId>`                                                        |
| Newest billing fact wins             | A catch-up read before a change never overrides it              | Integration tests: catch-up read before or after a real change, folded in either order; a re-run fixes a missed change |

## Assumptions

| Assumption                                              | What breaks if false                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud runs Instant Evals with Redis and `IS_SAAS`       | `INSTANT_EVAL_BOUNDED` arrives with the module tree and is not set in production (checked on the prod cluster, 2026-10-07), so unset follows `IS_SAAS`: cloud is bounded from the day the stack lands, self-hosted is not. Without Redis a bounded process refuses to boot. The base branch (#7536) defaults it to false instead, so #7536 must take the same default before it lands, or cloud runs uncapped |
| Every project has an organization                       | The leaf cannot place the project, so it refuses it (decision 15) and the project can never judge                                                                                                                                                                                                                                                                                                             |
| The langevals service port is internal in production    | Anyone reaching it runs judges with no app in between. It never reaches Instant Evals, so it is not a billing hole                                                                                                                                                                                                                                                                                            |
| The three judge settings shapes stay as generated today | The builder maps the wrong field. Its tests read the generated schemas                                                                                                                                                                                                                                                                                                                                        |
| The gateway ledger holds all Instant Evals spend so far | Main records Instant Evals spend there today. The spend job copies it into the leaf (decision 17). Spend recorded anywhere else is missed, and those organizations get headroom back                                                                                                                                                                                                                          |

## Gates

| Path                            | Reversible?                             | Blast radius                                           | Gate                                                                                                                   |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Spend row per judge call        | No, it feeds the existing monthly meter | Large                                                  | Human review of the judge method and the redelivery test before merge                                                  |
| Budget check                    | Yes                                     | Large                                                  | Unit tests that a refusal happens before the classifier is called and becomes an `error` result                        |
| Judge cap reads `isUsageBilled` | Yes                                     | Large, paying tiered customers' judge calls stop at $1 | Unit tests for usage billed, tiered and free organizations, and the monthly report reading the same rule               |
| Builder and result mapping      | Yes                                     | Large for guardrails                                   | Unit tests against the generated schemas, plus the polarity check                                                      |
| Picker entry                    | Yes                                     | Large, customer-visible                                | Ships with wave 1 behind `release_instant_evals`. Reviewer confirms the bounded flag in the deploy config before merge |
| Judge leaf                      | Yes                                     | Medium                                                 | The peer-cycle policy shows no new finding and no removed edge before merge                                            |
| Leaf tables migration           | No, it is a schema migration            | Medium, new tables only                                | Human review of the migration. It only creates tables, so rollback is dropping them                                    |
| Catch-up jobs                   | Yes, each is safe to re-run             | Large, they set every organization's cap               | Re-run tests, then a dry run on staging that prints counts before production                                           |
| Catch-up after rollout          | Yes                                     | Large, customer-visible                                | Run the three jobs right after the rollout, projects last. Judge calls are refused as unknown projects until then      |

## Schema

Three new Postgres tables, owned by the judge leaf. Each holds a copy of facts the judge needs before each call, folded from another module's events or from the leaf's own priced events. None of them is a meter: the monthly report still reads the gateway ledger. They ship in one migration under `packages/prisma-client/prisma/migrations/`, claimed in the table catalogue.

| Table                          | Key                           | Columns                                    | Fed by                                                                   |
| ------------------------------ | ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `InstantEvalJudgeProject`      | `projectId`                   | `organizationId`, `createdAt`              | project's `lw.project.created`                                           |
| `InstantEvalJudgeUsageBilling` | `organizationId`              | `usageBilled`, `occurredAt`, `fromCatchUp` | billing's new usage-billed event, plus catch-up                          |
| `InstantEvalJudgeSpend`        | `organizationId`, `requestId` | `spendNanoUsd`, `occurredAt`               | the leaf's own priced events and the spend catch-up, one row per request |

The score judge's settings gain an optional `min` and `max` in the langevals settings definition, regenerated into `evaluators.generated.ts`. Old settings without them read as 0 to 1.

## Rejected alternatives

- A hold per call: its release ran before the spend landed, so it never closed the overshoot. It cost two Redis writes per call, and a redelivered call deleted another call's hold.
- Fresh spend id per call: double bills a redelivered command.
- Score always 0 to 1: breaks prompts on other scales.
- A model-written reason: a second call and a second billing path.
- Separate judge flag: hides the picker cleanly, but the user chose not to add a flag.
- Builder in Instant Evals: one pull request, but couples it to evaluator settings.
- Accepting the cycle: the policy refuses every cycle and the ratchet test expects none.
- Removing only the gateway dependency: the loop still closes through trace.
- Dropping Instant Evals' gateway dependency as well as adding the leaf: it cuts an existing edge, which needs a ruling, and the leaf alone already breaks the new loop.
- Evaluation reading plan or spend from entitlement, billing or gateway: each of those reaches evaluation again.

## Consequences

- Positive: one dispatch point covers every in-app judge.
- Positive: results keep today's shape and scale.
- Negative: a busy unbilled organization can go past $1 by the calls in flight together. The spend rows record all of it.
- Negative: a retried experiment cell or simulation grading is billed per attempt.
- Negative: a fail-closed guardrail blocks a free organization's traffic once it is past $1.
- Negative: connected self-hosted accounts are billed only up to their contract ceiling, and the meter stops reporting when its breaker trips. Those organizations stay uncapped either way. A past-due organization stays usage billed, since billing has no past-due state.
- Negative: a paying tiered organization stops at $1 until top-up lands in wave 3.
- Negative: details is a confidence line, not a reason.
- Positive: wave 1 adds no peer cycle and cuts no edge.
- Negative: a spend row lands in the gateway ledger a short time after the call, through the event, so the run check lags by that delay.
- Negative: wave 1 grows by one module, three tables, one priced event, one gateway subscriber, one billing event and three catch-up jobs.
- Negative: usage-billed organizations judge uncapped and uncharged until the Stripe price for Instant Evals exists. Every call still writes its spend row.
- Negative: the three catch-up jobs are run by hand, since nothing runs module tasks on deploy. The flag gate is the guard.
- Negative: self-hosted installs lose the documented own-key path. The code still honours an operator-set key for runs and the search bar until wave 3.
- Neutral: the Instant Evals process lists the evaluator contract as a dependency it never imports. Remove it in the same change.

## Open questions

- Transport: in the app or through the gateway. Owner: the user (tasks#902). Blocks wave 2.
- Merging tasks#902 into tasks#915. Owner: the user. Not blocking.
- Whether an organization's model restrictions should be able to block Instant Evals. The judge skips the provider lookup, which is where restrictions are checked. Owner: the user. Not blocking.
- Whether the priced event also lets billing meter Instant Evals directly, retiring the gateway spend row. Owner: the user. Not blocking.
- When the Stripe price for Instant Evals goes live, which turns on charging for usage-billed organizations. Owner: the user. Not blocking.
- Whether runs and the search bar stop honouring an operator-set key on self-hosted. Owner: the user. Wave 3.

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
  - Billing publishes whether the meter bills an organization as an event (decision 12).
- v7, 2026-10-07, after checking v6 against the code. Captain: Sergio Esteban.
  - Renumbered from 173, which the upgrades record already holds.
  - Instant Evals keeps its gateway dependency, since cutting an edge needs a ruling. Runs and judged queries record through the leaf instead (decision 13).
  - Gateway looks up the team itself. The leaf folds only project creation, since a move stays inside the organization (decision 13).
  - The picker checks the opt-in and the judge call does not recheck it (decision 13). The spend row lag joins the overshoot (decision 8).
- v8, 2026-10-07, after a review against main. Captain: Sergio Esteban.
  - The leaf owns three tables. This replaces "no database change" (Schema, decision 13).
  - The Connect classifier stays in Instant Evals, since the leaf calling it would loop through licensing (decision 13).
  - Cloud only, no customer key, self-hosted in wave 3. The own-key lines leave the public docs (decision 14).
  - Unknown projects are refused, not judged free (decision 15).
  - Guardrails skip the stream chunk direction (decision 16).
  - Three catch-up jobs run before the flag, including a spend seed from the gateway ledger (decision 17).
  - Decision 12 kept. Capping every organization was rejected because it would cap Growth customers, who have no cap today.
  - The base branch must default `INSTANT_EVAL_BOUNDED` to `IS_SAAS` before it lands (Assumptions).
  - `error_type` survives into the stored result (decision 7).
- v9, 2026-10-07, wording only. Captain: Sergio Esteban.
  - Wording clarified: the meter, the pricing rule and the $1 budget check are reused. Wave 1 only connects the judge to them (summary, Context, decisions 8 and 13, Gates, Schema). No decision changed.
- v10, 2026-10-07, after the spec was checked against the code. Captain: Sergio Esteban.
  - A streamed reply's full response is never checked by the gateway, so an Instant Evals guardrail leaves streamed output unjudged in wave 1 (decision 16). The guardrail check now passes its direction to the evaluation.
  - The error code already survives in the stored error text. No new column (decision 7).
  - Runs and judged queries are refused at their budget hold, before the classifier (decision 17).
  - The usage-billing catch-up uses its own key, and the spend catch-up sets the total rather than adding (decision 17).
- v11, 2026-10-07, after two refuters attacked the rewritten spec. Captain: Sergio Esteban.
  - The spend catch-up adds ledger spend from before the cutover once, as one seed fact. This replaces setting the total, which counted spend twice when the ledger ran ahead of the leaf (decision 17).
  - A catch-up billing fact never overrides a real billing fact (decision 17).
  - Runs and judged queries pass their organization and are never refused as unknown projects. Only judge calls are (decisions 13 and 15). This removes the window where existing projects were refused, and a run in flight across the deploy no longer loses its spend.
  - Nothing runs module tasks on deploy, so the release runs the jobs by hand behind the flag gate (decision 17).
  - The leaf's subscribers ignore repeats themselves (decision 13).
- v12, 2026-10-07, after two refuters attacked the v11 spec. Captain: Sergio Esteban.
  - The leaf keeps one spend row per request id instead of a running total, since the live fold skips repeats only by event id (decision 13).
  - The seed sits in its own row with its cutover, and a re-run replaces it. The leaf counts only its rows at or after the cutover, so no cutover choice and no rollback counts a dollar twice (decision 17, Schema).
  - A run's spend stamp is set once and reused on retry (decision 17).
  - The billing row records whether it came from a catch-up. A real fact always replaces a catch-up row, in any order (decision 17, Schema).
  - Runs and judged queries keep main's free-plan rule in wave 1. Only the judge call reads the meter's rule (decision 12).
  - The flag is already on for organizations using Instant Evals, so the jobs run right after the rollout and the judge refuses unknown projects until then (decision 17, Gates).
- v13, 2026-10-07, after two refuters attacked the v12 spec. Captain: Sergio Esteban.
  - The spend catch-up copies ledger rows by request id instead of summing a seed before a cutover. A seed missed ledger rows that landed late, and a finish queued by an old pod and retried on a new one counted twice. The seed table and the run stamp rule are gone (decision 17, Schema).
  - The leaf's total is the sum of its rows (decision 13).
  - The newest billing fact wins, and a real fact wins a tie. Billing stamps a real fact after its write commits, and the catch-up covers every organization with a key per read, so a re-run fixes a change the leaf missed during a rollback. This replaces "a real fact always wins", which kept a stale fact forever (decision 17).
  - A project created live before the spend job runs can overshoot by up to one dollar, recorded (decision 17).
  - The cloud client's settings move to the leaf with it, and Instant Evals chooses cloud or Connect on the first call (decision 13).
  - Two billing changes send no usage-billing fact, and the usage-billing catch-up re-run corrects them (decision 17).
- v14, 2026-10-07, after the runs and judged queries were moved onto the leaf. Captain: Sergio Esteban.
  - A run's request id is `instanteval_<runId>`, the id main already writes, not `run:<runId>`. Keeping main's id is what makes a finish confirmed by an old pod and retried on a new one one ledger row (decision 17, Invariants).
  - A hosted Connect call keeps writing the gateway ledger itself, since its row names the calling key. The leaf's total does not count it until the spend catch-up copies it (decision 13).
- v15, 2026-10-07, after the picker entry was built. Captain: Sergio Esteban.
  - The picker shows Instant Evals when the flag is on or the organization opted in, the same answer the access check gives. The flag alone hid it from organizations that opted in (decisions 11 and 13).
  - The score range fields show only while Instant Evals is the judge's model, since no other model reads them (decision 4).
- v16, 2026-10-07, after the three catch-up jobs were built. Captain: Sergio Esteban.
  - The jobs are `usage-billing-catch-up` (billing), `instant-eval-judge-spend-catch-up` (Instant Evals) and project's existing `backfill-project-created`, run in that order (decision 17).
  - The usage-billing catch-up stops on an organization whose fact it cannot record, unlike a real fact, which is logged. A hand-run job that skipped an organization silently would leave it capped (decision 17).
  - The spend catch-up writes each ledger row straight into the leaf's spend table under its request id. It sends no priced fact, since the ledger already holds the row a priced fact would write (decision 17).
  - Gateway reads the ledger's confirmed rows of one request type a page at a time, the rows its request-type sum already counts, filtered by the organization's projects (decision 17).
- v17, 2026-10-07, after the docs strip. Captain: Sergio Esteban.
  - The leaf reads the classifier key on LangWatch Cloud only, so a key a self-hosted install sets builds no classifier. Runs and judged queries then judge through Connect or not at all, as the judge call already did (decision 14).
  - The self-hosting docs, the not configured tip and its customer copy point at Connect and never at a key of one's own. The tracked `.env.example` says a self-hosted install ignores the key (decision 14).
  - The connect-settings scenario that kept an install's own judge key now says a self-hosted install never judges with one (decision 14).
