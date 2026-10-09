# ADR-002: Metering inside entitlement

**Status:** proposed

**Note:** Was `modules/usage` ADR-001; usage merged into entitlement (Alex, 2026-10-06, late evening).

**Behavioural contract:** [Entitlement owns all counting](../specs/usage-counting.feature),
[Entitlement's meters and decisions](../specs/usage.feature)

## Context

Counting billable events and deciding when an organization is over its limit
were spread across callers.

## Decision

`entitlement` owns all counting. Metering answers by events and adds no
`EntitlementApi` operation; the contract holds the usage events beside the Api.

## Public surfaces and transports

No transport of its own. Other modules learn the decisions from entitlement's
fact events.

## Dependencies

Entitlement's own `BillingApi` and `ProjectApi` peers; the month's plan comes
from the module's own plan resolution. ClickHouse and `isSaas` are read.

## Persistence

The billable-events meter, a ClickHouse repository with a memory twin.

## Runtime and registration

`entitlementProcessModule` registers the usage pipeline beside its others: the meter
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
