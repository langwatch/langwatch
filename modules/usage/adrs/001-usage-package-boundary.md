# ADR-001: Usage package boundary

**Status:** proposed

**Behavioural contract:** [Usage owns all counting](../specs/usage-counting.feature),
[Usage meters and decisions](../specs/usage.feature)

## Context

Counting billable events and deciding when an organization is over its limit
were spread across callers.

## Decision

`usage` owns all counting. It answers by events, so `UsageApi` has no
operations; the contract holds the Api token and the usage events.

## Public surfaces and transports

No REST or tRPC transport. Other modules learn usage decisions from its fact
events.

## Dependencies

`EntitlementApi`, `BillingApi` and `ProjectApi`. ClickHouse and `isSaas` are
the members read.

## Persistence

The billable-events meter, a ClickHouse repository with a memory twin.

## Runtime and registration

`usageProcessModule` registers the Api and the usage pipeline: the meter
projection, the meter-count subscriber and the `refusedOrganizations`
process manager, which recounts a refused organization on each wake.

## Environment and configuration

None read directly; infrastructure enters as members at composition.

## Errors

Commands are keyed so a redelivery records a decision once.

## Contracts and validation

Event payloads are contract schemas, parsed by the pipeline.

## Consequences

One owner for counting; an upgrade clears a refusal within minutes.
