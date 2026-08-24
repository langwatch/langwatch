# ADR-001: Billing is a runtime-neutral enterprise feature

**Status:** Accepted

**Behavioural contract:** [Enterprise billing compatibility](../specs/billing.feature)

**Related:** [ADR-111](../../../../../dev/docs/adr/111-physical-application-workspaces.md)

## Context

Billing previously mixed portable plans and prices, Stripe orchestration,
Customer.io nurturing, persistence, tRPC handlers, and React consumers beneath
the application-owned `ee` directory.

## Decision

Create separate Billing contract, server, and web packages. The contract owns
portable plan, price, notification, and service vocabulary. The server owns
injected Stripe, Customer.io, ClickHouse, and Prisma-backed behavior. The web
package owns browser-safe pricing helpers and presentation surfaces.

## Public surfaces and transports

Each package has one root export. Billing does not own a transport protocol;
the application keeps its tRPC route composition and delegates to the contract
and server service classes.

## Dependencies

The contract uses Zod 4 and portable core contracts. The server depends on the
contract and explicit provider SDKs. The web package depends on the contract,
React, Chakra, and the Design System only.

## Persistence

Concrete Prisma repositories live only under `server/src/repositories/prisma`
and ClickHouse repositories beneath their provider-specific repository path.
Services consume narrow repository classes rather than generated client types.

## Runtime and registration

Concrete services and adapters have private constructors and `static create`.
Imports do not instantiate Stripe, read configuration, or register handlers.

## Environment and configuration

Feature packages read no ambient environment. API or worker composition passes
Stripe keys, Customer.io configuration, price environment, and host values.

## Errors

Existing handled Billing errors and stable error codes remain contract-owned.
Best-effort integrations still report failures without breaking their caller.

## Contracts and validation

Portable inputs are validated with Zod 4. Stripe webhook signatures and SDK
objects remain server-bound and never appear in browser exports.

## Consequences

Billing's browser and backend dependency graphs can now be checked separately,
while existing routes, jobs, and UI callers retain their behavior through
explicit feature capabilities.
