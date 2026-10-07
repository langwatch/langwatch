# ADR-001: Instant-eval-judge is a dependency leaf

**Status:** Accepted

**Behavioural contract:** [Instant Evals judge pricing](../specs/instant-eval-judge-pricing.feature)

**Related:** [The Instant Evals judge call is metered](../../../dev/docs/adr/174-instant-evals-judge-call-is-metered.md),
decision 13, and `dev/docs/ARCHITECTURE.md` section 5.

## Context

Evaluation needs to judge with Instant Evals, and Instant Evals already reaches evaluation through
gateway and trace. Evaluation depending on Instant Evals would close a peer cycle. ADR-174 decision
13 puts the judge in a leaf module that both depend on and that depends on no peer.

## Decision

`instant-eval-judge` owns what a judge is asked and answers (questions, verdicts, skip reasons,
the classifier's limits) and the pricing rule, moved from Instant Evals unchanged. Instant Evals and
evaluation import them from this module's contract. Later steps of ADR-174 add the cloud classifier
client, the module's own tables, the $1 check and the judge method.

## Public surfaces and transports

`@langwatch/instant-eval-judge-contract` exports the question, verdict and judgement types, the skip
reasons, the classifier limits, `INSTANT_EVAL_PRICING`, `instantEvalCostUsd` and
`instantEvalPriceUsd`. `InstantEvalJudgeApi` is declared with no methods yet. The judge method lands
on it later (ADR-174 decision 10). There is no transport.

## Dependencies

None. The contract depends on `zod` only, and the module names no peer `*Api`.

## Persistence

Three Postgres tables, created in migration `20261007120000_instant_eval_judge_tables` (ADR-174
Schema). Each is the leaf's own copy of a fact; none has a relation or foreign key.

- `InstantEvalJudgeProject`, keyed by `projectId`: the project's organization and creation time.
- `InstantEvalJudgeUsageBilling`, keyed by `organizationId`: whether the organization is usage-billed,
  when that was true, and whether a catch-up wrote it.
- `InstantEvalJudgeSpend`, keyed by `organizationId` and `requestId`: one judge request's spend in
  nano USD. The organization's total is the sum of its rows.

The repositories that claim them land with the folds (ADR-174 decision 13).

## Runtime and registration

None yet: there is no process package, so nothing is installed.

## Environment and configuration

None yet.

## Errors

None yet. The judge's refusal codes are listed in ADR-174 decision 7.

## Contracts and validation

The question schemas are Zod. The scenarios under `specs/` are bound by the contract's unit tests.

## Consequences

Instant Evals and evaluation price and name a judgement from one place, and neither depends on the
other for it.
