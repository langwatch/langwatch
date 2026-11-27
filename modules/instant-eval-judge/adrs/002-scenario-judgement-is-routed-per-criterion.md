# ADR-002: A scenario judgement is routed per criterion, and its turn decision is not routed

**Status:** Proposed

**Behavioural contract:** [A scenario judgement answered by the judge router](../specs/instant-eval-scenario-judge.feature)

**Related:** [A routed judgement is priced from the summed cost of its calls](../../../dev/docs/adr/190-instant-evals-routed-judgement-is-priced-from-summed-call-cost.md) (ADR-190),
and [Instant-eval-judge is a dependency leaf](./001-instant-eval-judge-boundary.md).

## Context

The route table has had a `scenario_judge` job since the router shipped, with no caller. A scenario
judge is a chat model in an SDK we do not change: after each turn it asks whether the conversation
goes on, and at the end it asks for a verdict on every criterion in one tool call. The router
answers single questions. The routes measured for scenario judging scored one criterion at a time
on a decision model and sent the unsure ones to an LLM that read the judge's whole verdict call.

## Decision

1. **The leaf answers a scenario judge call through `judgeScenario`.** It is metered like `judge`:
   LangWatch Cloud only, a project the judge has learned, the free budget, then one priced fact.
2. **A verdict is routed per criterion.** Each criterion is one `scenario_judge` yes or no question
   with fixed wording, routed alone, so each one escalates alone. The judged text is the scenario's
   description and the judge's content, the same for every criterion, so they share a bucket.
3. **An LLM leg of a scenario criterion reads the judge's own verdict call.** It sends the judge's
   system and user messages with the `finish_test` tool forced, and reads this criterion by its
   key: the `status` (passed, failed or inconclusive) of the scenario SDK's per-criterion object
   since 1.8, or an older SDK's true, false or inconclusive. Inside one judgement that call is
   sent once per backend and billed once, however many criteria need it.
4. **The turn decision is not routed.** No measurement covers it. The judge's own call, with its
   two decision tools, goes to the LLM backend the table names in `scenarioDecision`. A failure
   lets the conversation go on, because the judge's last turn forces the verdict. A table that
   names no decision backend answers no turn decision, so `isScenarioJudgeConfigured` says no
   and a run on LangWatch Judge (preview) is refused before it starts. Each turn decision is its
   own priced spend row under `langwatch-judge-preview`, with a request count of 1, whatever it
   decided; one that billed no tokens records none.
5. **A verdict is never made up.** A criterion no leg answered is inconclusive. A judgement
   nothing answered is `unavailable`, and its caller reports an error, not a failed run.
6. **One paid verdict is one spend row** under the model `langwatch-judge-preview`, priced as ADR-190
   decision 3: the summed cost of every call times the one markup. Its request count is the number
   of criteria. A scenario run therefore writes one row per paid turn decision (decision 4) and
   one for its paid verdict; a verdict that billed no tokens records none. An LLM-as-judge evaluation keeps `langwatch-judge`.
   The SDK sends no stable request id, so a call it retries (a timeout, a 503 after paid legs) runs
   and bills again. This is accepted for the preview; a request key would need one from the SDK.
7. **The table decides the backends.** Nothing in the leaf names a provider for this job. Boot
   checks a price and a key for the decision backend as it does for a slot's backends.
8. **A gated entry works per criterion (2026-11-25).** The gate (ADR-190 decision 11) rates each
   criterion's case. An easy one is answered by the primary alone; the hard ones share the one
   verdict call on the escalation. The call carries the backend's reasoning effort when it sets one.
9. **`gemini_generate_content` is a third LLM kind (2026-11-25).** It exists for long
   conversations, which the measured routes send to a long-context model. It answers the judge's
   own call and a routed question as a required function call, keeps up to 900,000 tokens of the
   judged text where the other LLM wires keep 128,000, and bills thinking tokens as output. Its
   model id rides in the request path, so the table holds it to a bare id; its key rides in a
   header, never the URL, and is read on LangWatch Cloud only. It takes no reasoning effort.
10. **The endpoint speaks the scenario SDK's own tools (2026-11-25).** A criterion's text is the
    one the system prompt's `<criteria>` block lists at its place, the wording the routes were
    measured on, since SDK 1.8 sends its tool with no descriptions. The SDK numbers them 1..N
    and joins them with a line end, so a line not starting the next number continues the
    criterion before it, and a `\r` reads as a line end. Only a block that lists one criterion
    per key is used; otherwise each key falls back to its description, then to the key itself.
    The verdict answers each criterion with its requirement, a short reasoning and its status,
    and no verdict field: the SDK works it out. A verdict call that offers the one-shot
    `wait_for_traces` is answered with that wait, free, so a verdict waits once for traces still
    arriving, as the SDK's own judge may.

## Consequences

- Sharing the verdict call bills its tokens once per judgement, where the measurement paid it per
  check. What a check reads is the same.
- The query hold (ADR-190 decision 7) is computed over the search and LLM-judge routes only, so a
  backend only `scenario_judge` slots or `scenarioDecision` reach never raises it. Such a backend
  still needs a price (and a key) for the table to boot.
- An `isInconclusive` verdict carries no probability. Only a scenario criterion produces one.
- A threshold is compared in floats on the router's scale, `abs(2p - 1)`. `abs(2 * 0.95 - 1)` is
  just under 0.9, so a table that means "an answer of 0.95 stands" names a threshold just under
  0.9 (0.899999), not 0.9. A test pins this.
