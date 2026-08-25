# ADR-001: Webhook endpoints own a portable delivery contract

**Status:** Accepted

**Behavioural contract:** [Enterprise webhook endpoints](../specs/webhooks.feature)

## Context

Webhook endpoint contracts, database access, Eventing process behavior, and
browser-facing event catalog data previously lived together below an app alias.

## Decision

Create a portable contract for endpoint configuration, envelopes, event
selectors, errors, and service capabilities, with class implementations in a
strict server package. Delivery remains an at-least-once Eventing workflow.

## Public surfaces and transports

The contract and server each expose only their package root. REST, RPC, tRPC,
and UI callers consume the same types and classes without owning persistence.

## Dependencies

The contract uses only handled errors and Zod 4. The server depends on the
contract, Eventing, observability, and portable contracts of adjacent features.
Webhook access consumes the core Entitlement service contract and does not
create a webhook-specific plan provider.

## Persistence

Endpoint and delivery rows are accessed only in the strict Prisma repository
adapter. Emitted events use a private ClickHouse repository abstraction.

## Runtime and registration

Delivery schemas and executors are explicit and class services take their
dependencies at construction. Importing either package registers no consumer
or timer. Eventing process-manager registration remains at the composition
boundary and consumes the feature's Zod 4 schemas directly.

## Environment and configuration

Unsafe local URLs and ambient AWS credentials are explicit server configuration
values. Encryption, endpoint id minting, and transport dispatch are ports.

## Errors

Invalid endpoints, missing endpoints, missing emitted events, and entitlement
failures retain stable handled error codes and customer fault classification.

## Contracts and validation

All transport-facing values have Zod 4 schemas. Secrets are write-only and no
server, Prisma, environment, or request-framework type reaches declarations.

## Consequences

Endpoint CRUD, delivery retry, health, and event listing can be composed into
API and worker runtimes independently while sharing one browser-safe catalog.
