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

`@langwatch/instant-eval-judge-process` exports the process module only.

## Dependencies

No peer `*Api`. The contract depends on `zod` only. The process half reads two peers' event
contracts, never their Apis: project's `lw.project.created` and billing's
`lw.billing.usage_billing_changed`. A peer subscriber is not a dependency edge.

## Persistence

Three Postgres tables, created in migration `20261007120000_instant_eval_judge_tables` (ADR-174
Schema). Each is the leaf's own copy of a fact; none has a relation or foreign key.

- `InstantEvalJudgeProject`, keyed by `projectId`: the project's organization and creation time.
- `InstantEvalJudgeUsageBilling`, keyed by `organizationId`: whether the organization is usage-billed,
  when that was true, and whether a catch-up wrote it.
- `InstantEvalJudgeSpend`, keyed by `organizationId` and `requestId`: one judge request's spend in
  nano USD. The organization's total is the sum of its rows.

One Prisma repository claims each table, with an in-memory twin. Every query names the project or
the organization. Each write is safe to repeat, since a peer event is delivered at least once:

- The project row is written once and never changed, since a project never leaves its organization.
- The billing row keeps the newest stamp, and a real fact wins a tie over a catch-up
  (`usageBillingFactWins`, ADR-174 decision 17). The Postgres update states the same rule in SQL, so
  two folds racing on one row cannot both land.
- A spend row is never rewritten. A request that already has one keeps it.

## Runtime and registration

`defineProcessModule("instant-eval-judge")` with its repositories, `InstantEvalJudgeModule` as its
Api and one eventing module. Installed by api, worker and tasks from each app's generated list.

The pipeline `instant_eval_judge_facts` (aggregate `global`) appends no events. Its two peer
subscribers fold project's created fact and billing's usage-billing fact into the tables above. The
spend rows have no event source yet. The judge's priced event lands with the judge method.

## Environment and configuration

None yet.

## Errors

None yet. The judge's refusal codes are listed in ADR-174 decision 7.

## Contracts and validation

The question schemas are Zod. The scenarios under `specs/` are bound by the contract's unit tests.
The process half binds the fold scenarios of Instant Evals' judge model spec. Its repository
contract test runs every case against memory and Postgres.

## Consequences

Instant Evals and evaluation price and name a judgement from one place, and neither depends on the
other for it.
