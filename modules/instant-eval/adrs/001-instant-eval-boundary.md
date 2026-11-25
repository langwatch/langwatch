# ADR-001: Instant-eval owns the judgment run

**Status:** Accepted

**Behavioural contract:** [Instant-eval pipeline](../specs/instant-eval-pipeline.feature)

**Related:** [An instant-eval run is a judgment job](../../../dev/docs/adr/153-instant-eval-run-is-a-judgment-job.md),
and `dev/docs/ARCHITECTURE.md` section 3.

## Context

An instant eval judges the rows an LWQL statement returns, against questions the caller asks, and
is metered on the gateway spend spine. A run has its own lifecycle (estimate, start, page,
judge, finish or cancel), its own budget and its own opt-in, none of which belong to analytics,
trace or the gateway.

## Decision

`instant-eval` owns run state, judgments, the token budget and rate limit, cancellation, the
judge choice and the pricing rules. `InstantEvalModule` implements `InstantEvalApi`; callers
go through it. The spend a run records goes to the gateway's ledger through `GatewayApi`; no
other module reads the run tables.

## Public surfaces and transports

`@langwatch/instant-eval-contract` exports `InstantEvalApi`, the run, estimate and result
schemas, the errors, the event constants and the tRPC declaration. The process half serves a REST
family whose routes run the statement as the credential's own cut of the project.

## Dependencies

Peers are named on `InstantEvalModule.dependencies` (feature flags, project, analytics, entitlement, gateway, trace, licensing, organization and the Instant Evals judge). The one channel is `InstantEvalJudgeChannel`,
with a memory twin. LangWatch's cloud classifier, its `JEV_API_KEY` and its rate limits belong to
the `instant-eval-judge` leaf, reached only through its Api; Instant Evals asks it whether the key
is set on its first call and otherwise uses Connect.

## Persistence

ClickHouse repositories hold runs and judgments; Redis repositories hold budget reservations
and cancellation. Each has a memory twin. Run progress is an event-sourced
projection built by the module's pipeline.

## Runtime and registration

`instantEvalProcessModule` installs the repositories, the module class, the REST transport and
the processing pipeline. The worker runs the pipeline; the api serves the transports.

## Environment and configuration

`instantEvalConfig` declares the classifier (`jev`, `connect`, `null`, `memory`), the judge URL
(HTTPS only), the model and the global token rate. A deployment with no judge key judges nothing
and says so by name.

## Errors

Refusals are contract `HandledError` subclasses. A run that cannot be afforded or exceeds a cap
is refused before it starts; a run that fails midway records the code that ended it.

## Contracts and validation

Zod validates run input, shorthand and judge responses where they enter. The scenarios under
`specs/` are the requirements, bound by the module's unit and installation tests.

## Consequences

Instant-eval can change its judge, budget and pipeline without a caller noticing. The ledger
write is the one place spend crosses a module edge, and it crosses as the gateway's contract.
