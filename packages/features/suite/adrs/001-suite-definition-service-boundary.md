# Suite definition service boundary

## Status

Accepted

## Decision

`@langwatch/suite-contract` owns the portable suite-definition vocabulary and
the abstract `SuiteService`. `@langwatch/suite-server` owns its concrete
service, private repository and Prisma adapter. The service only receives its
repository; transport and application composition construct the adapter once
and share that contract capability.

Suite execution is deliberately not pulled into this initial boundary. It
currently depends on the unextracted Scenario parameter/runtime surface and
the event-sourced suite-run pipeline. Those dependencies will be introduced as
their canonical service contracts are extracted; no Suite-local copies of
Scenario repositories, execution services or Eventing pipeline code are
permitted.

## Consequences

New reusable suite-definition callers import `@langwatch/suite-contract`.
The legacy app service remains only as a transition for execution until App
composition exposes the canonical service and the Scenario/Suite-run contracts
are available.
