# ADR-193: Platform calls on stored credentials report their usage to the spend ledger

**Date:** 2026-11-03

**Status:** Accepted

## Context

Only the gateway HTTP pipeline writes spend ledger rows. LangWatch also calls models itself with an
organization's stored model provider credentials: langevals runs evaluators, guardrails and topic
clustering (embeddings and naming) through litellm in-process, and nlpgo runs workflows, the
playground and platform features through the gateway's in-process dispatcher. None of those calls
reached the ledger. In one organization over three days the provider bill was 103.03 USD and the
ledger 56.86 USD; 42.7 USD of the gap was topic clustering embeddings. Organization budgets
under-counted and could not stop that spend.

langevals and nlpgo run on Lambda in the hosted cloud. A Lambda sandbox is frozen as soon as it
answers and killed without notice when idle, so an asynchronous spool and drainer there loses the
records of the last calls before every idle shutdown. Both services also run customer-shaped work
(nlpgo runs code blocks), so handing them the gateway's internal HMAC secret, which can call every
`/api/internal/gateway/*` route, widens what a sandbox escape reaches.

## Decision

1. Each runtime records usage at its single choke point and returns it on its own response; the
   TypeScript caller writes it to the ledger. No runtime gains a network path, a secret or a spool.
2. langevals: the litellm patch layer (`langevals_core/litellm_patch.py`) records every answered
   completion, async completion and embedding into a request-scoped collection
   (`langevals_core/usage_ledger.py`), summed per model. An evaluator entry returns it as `usage` on
   its result, whatever the status; a clustering answer returns it as `usage` beside `cost`.
3. The gateway owns the write: `GatewayApi.recordProviderUsage` takes quantities, rates them at the
   same registry seam that prices drained outcomes, resolves the project's team and organization and,
   when the caller names none, the provider row serving the model. It appends a `confirmSpend` with no
   virtual key and the organization set, so the debit writer charges every project, team and
   organization budget the call falls under. The request id is `<type>:<key>:<model>`, so a repeat is
   one row.
4. The evaluation module reaches the gateway through a channel binding (record §5), not a peer:
   gateway already depends on evaluation.
5. Budgets are debited, not enforced at admission. These calls have no admission step and no cached
   budget bundle on the caller's side, so an admit check would cost a ledger read per evaluation. A
   breach still raises the crossing and BUDGET_UPDATED events, and the gateway HTTP path blocks on it.

## Rationale / Trade-offs

Routing langevals and nlpgo through the HTTP gateway would give enforcement for free, but needs a
virtual key per project and a network hop from every Lambda. Emitting from the runtimes through the
gateway spool was the other option; the Lambda lifecycle and the secret scope above rule it out
for the hosted cloud.

## Consequences

- Evaluators, guardrails, batch evaluations and topic clustering land on the ledger under
  `request_type` `evaluation` and `topic_clustering`. A topic clustering page keys its usage on
  its outbox run and page, so a retried page is one row.
- LangWatch features and the prompt playground that call through the execution proxy
  (`/go/proxy/v1`) are metered by a middleware on the model handle model-provider builds, under
  `platform`, keyed by the provider's response id.
- Studio workflow LLM nodes land under `workflow`: the stream's finished node states and the
  synchronous answer carry each node's tokens, and a dataset evaluation's progress event carries
  each row's. The key is trace, workflow, node and model.
- An organization's own Instant Evals decision model records the provider's tokens under
  `instant_eval_decision_model`, so they never count against the Instant Evals free budget.
- A ledger failure is logged with every figure and never fails the call.
- Not covered: scenario agents that the scenario child sends straight to nlpgo on deployments
  without per-project engines, and the Test Connection ping. Entries abandoned at the langevals
  batch deadline, clustering requests that fail after embedding and cancelled workflow rows return
  no usage.

## References

- `modules/gateway/specs/gateway-platform-provider-usage.feature`
- ADR-174 decision 13 (Instant Evals judge spend on the ledger)
