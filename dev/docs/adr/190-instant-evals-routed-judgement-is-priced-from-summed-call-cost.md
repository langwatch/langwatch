# ADR-190: A routed Instant Evals judgement is priced from the summed cost of its calls, at the one published markup

**Date:** 2026-10-29

**Status:** Proposed

> One line: when a judge call carries a **route**, the Instant Evals judge may ask a decision model, Jev and an LLM judge, add up what every call cost at deploy-time prices, and charge that sum at the one published markup. Unrouted calls keep the ADR-174 rule.

## Context

- ADR-174 makes an Instant Evals judgement one classifier call, priced from the tokens the classifier billed, with one pricing rule that moved into the judge leaf unchanged (decisions 6, 8 and 13).
- The judge router (PR #9118) adds a second way to answer. A call that carries a route can go to a decision model, to Jev, and to an LLM judge from Anthropic or OpenAI, as an escalation or as a pair. Each leg bills its own input and output tokens, so the classifier's input-only rule no longer describes the cost.
- ADR-174 does not allow this in three places. Decision 6 rejected a second model call and a second billing path. Decision 8 prices the tokens the classifier billed with the existing rule. Decision 13 says the leaf owns one pricing rule and calls only the classifier. Decision 11 reuses `release_instant_evals` over a separate judge flag.
- Nothing in the repository recorded the change before this ADR. The pricing rationale lived only in the flag description, `.env.example`, the router feature and the pull request body.
- Hard rule from ADR-174 holds: customers never supply a classifier key. Every router leg uses LangWatch's own keys, on LangWatch cloud only.

## Decision

1. **A routed call may make several calls.** When a judge call carries a route, the judge leaf may call a decision model, Jev and an LLM judge (escalation or pair). The leaf reaches them through two outbound channels (hosted decisions, and Anthropic or OpenAI), with LangWatch's keys, on cloud only.
2. **Each leg is priced from its own tokens.** A leg costs its reported input and output tokens at a deploy-time per-backend price (`INSTANT_EVAL_JUDGE_PRICING`, versioned, with an optional long-context tier). Every backend reports both counts in its response's `usage`, and the leaf carries both from every leg: Jev (`usage.input_tokens`, `usage.output_tokens`), OpenAI's Decisions API (the same two fields, with `output_tokens` documented as 0), and the Anthropic and OpenAI LLM judges. A leg that reports output tokens alone is billed for them. Jev publishes no output price and Decisions charges none, so the default output rate for both is 0; a pricing file that sets one is billed, never ignored. A backend the route can reach that has no price refuses boot. When the variable is unset, the default route prices Jev at its published rate. The hosted classifier on an unrouted call is still priced from its input tokens alone (decision 6).
3. **The customer price is the summed cost times the one markup.** The sum covers every paid leg. The markup is the single published one (1.3). It is recorded as one spend row per request, under the model `langwatch-judge` and the rate version `instant_eval_judge_router@<version>x<markup>`. Legs paid before a stop (a deadline, a cancel or a failed later leg) are still billed. A judge call records a stop's spend under a freshly minted request id, never the retry key, so the redelivery that completes under the key keeps its own row and every paid attempt is billed.
4. **A routed judgement is identified by carrying a cost, including 0, and names the tokens that cost covers.** A judgement with a cost field is a routed one; a judgement without one is unrouted. Next to the cost (`costNanoUsd`) travels `routedInputTokens`, the input tokens that cost already covers. It is carried on the `page_judged` event, the run's process state and the finish intent, and reads as 0 on older events. A judgement, page or run costs `costNanoUsd + classifier rate x (inputTokens - routedInputTokens)`, rounded to nano-USD, and its price is that cost at the markup (`instantEvalSpentCostUsd`). Routed tokens are never priced twice, and unrouted tokens are never priced at zero.
5. **A run may mix routed and unrouted calls.** Because each token is billed by the rule that covers it, a run that routes some calls and not others is billed correctly. Resolving the route once per run is still recommended, so one run's spend row names one model and rate version. A routed call whose question kind the table does not route still asks the hosted classifier, and carries that classifier's cost at its routed price.
6. **Unrouted calls keep ADR-174 pricing.** Unrouted calls, runs and judged queries keep the classifier's input-token rule, the `jev` model and the `instant_eval@<rate>x<markup>` rate version.
7. **A judged query is held at the dearest base input rate it can reach, as a best-effort hold, not a hard cap.** Before a query is judged, its hold is the query token budget priced at the dearest base input rate over every backend the route table can reach (enabled entries and enabled fallbacks), never below the classifier rate, at the one markup. The leaf computes the rate once at boot and exposes it as `InstantEvalJudgeApi.queryHoldPricing()`. With the public jev-only table the hold is unchanged. A routed query can spend past its hold: it may send the same text on several legs (a pair, a fallback, an escalation), its LLM leg sends the full text once per question, and it pays output tokens and long-context input rates, none of which the hold counts. Queries do not route today, so this is not reachable yet; see "Before queries route".
8. **Routing is gated per organization by `release_instant_evals_judge_router`,** off by default, so decision 11 of ADR-174 does not cover routing. Turning it on needs a caller that builds the route (see the open questions).
9. **Rollout.** Routing stays off until a deploy has fully rolled out. The routed event fields (`costNanoUsd`, `routedInputTokens`) are new, and an old pod that reads a new event strips them, which would price a routed judgement from tokens alone.

## Relation to ADR-174

This record supersedes ADR-174 in part:

- decision 6, for routed calls (a second call and a second cost basis are allowed there);
- the pricing bullet of decision 8, for routed calls;
- decision 11, for routing (a separate flag).

It amends decision 13. The leaf now owns two pricing rules and four upstreams: the hosted classifier, the hosted decisions endpoint, Anthropic and OpenAI. It still calls no peer Api.

## Open questions

These are for Andrei and Rogerio. The code assumes the first answer in each pair and changes in one place if the answer differs.

1. **Does the 1.3 markup apply to third-party LLM cost?** The markup was set for Jev at its published rate. The router applies it to the summed cost, so the cost of an Anthropic or OpenAI leg is marked up at 1.3 too. The alternative is a separate markup per backend, which needs a field on the price table (it has none today).
2. **Does the router ship dark, or with one caller behind the flag?** Today no non-test code sets a route, so the router, its flag and its event fields are unreachable in production. One option is to ship dark and add the caller in a later pull request. The other is to wire one caller, read the flag where the judged rows build their classify input, and ship it behind `release_instant_evals_judge_router`.

## Before queries route

Decision 7's hold is not a cap. Before any caller sends a route for a judged query, one of these must land, with tests:

- Price the hold at the worst case the route can reach: the dearest rate including the long-context tier, times the route's maximum re-sends (a pair, each fallback, an escalation, and the LLM leg once per question), plus an output-token allowance per LLM call.
- Or pass a cost ceiling into the router, so a routed call stops escalating once its summed cost reaches the hold.

## Rationale / Trade-offs

One summed price keeps the customer's bill to a single number per judgement, and the ledger to a single row per request. Pricing each leg at the cost we pay, and applying one markup to the sum, avoids a price table the customer would need to read. The cost is that a cheap path and an expensive path share one markup, which is open question 1.

Carrying a cost, including 0, as the marker of a routed judgement avoids a separate flag on every event. A zero-cost routed judgement (every leg cost nothing) is still routed and is not priced from tokens. Carrying `routedInputTokens` next to the cost lets a page or run that mixes routed and unrouted judgements bill each token once, by the rule that covers it, instead of requiring a run to route all calls or none. The price is one more field to sum wherever a run or page is priced.

Billing legs paid before a stop is the same rule ADR-174 applies to a call cancelled after the classifier answered: the upstream was paid, so the customer is charged.

Rejected: a second judge module for the router. Evaluation and Instant Evals would then depend on two leaves, and the pricing rule would still be split.

## Consequences

- The judge leaf has two pricing rules, chosen by whether a judgement carries a cost. Spend rows have a second model name and rate version, which gateway and the ledger already accept as free text.
- Deploy-time JSON now sets prices (`INSTANT_EVAL_JUDGE_PRICING`) and routes (`INSTANT_EVAL_JUDGE_ROUTES`). A price or route change needs a deploy, and the rate version in the ledger tells a replay from a re-rating.
- A run's cost and price are the sum of routed cost and unrouted token price, both marked up once.
- The page budget check reads a running row that stores no routed token count, so it prices every token at the classifier rate on top of the routed cost. That is an upper bound on the bill, never an under-count.
- Once a deploy sets a route table with LLM backends, judged query holds rise to the LLM rate, even before a caller routes queries. A free organization's query can be refused earlier. That is the conservative side.
- Until a caller sends a route, production prices every call the ADR-174 way.

## References

- Related ADRs: [ADR-174](./174-instant-evals-judge-call-is-metered.md), [ADR-182](./182-instant-evals-decision-model-is-a-default-model-column.md)
- Module record: `modules/instant-eval-judge/adrs/001-instant-eval-judge-boundary.md`
- Behaviour: `modules/instant-eval-judge/specs/instant-eval-judge-router.feature`, `modules/instant-eval-judge/specs/instant-eval-judge-pricing.feature`
- Pull request: langwatch/langwatch#9118
