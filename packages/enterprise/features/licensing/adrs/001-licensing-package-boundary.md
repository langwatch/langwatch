# ADR-001: Licensing supplies a signed plan source to Entitlements

**Status:** Accepted

**Behavioural contract:** [Enterprise licensing lifecycle](../specs/licensing.feature)

**Related:** [Entitlements provider neutrality](../../../../features/entitlements/adrs/001-provider-neutral-plan-resolution.md)

## Context

Licensing previously combined portable license data, Node cryptography, Prisma,
environment reads, retention orchestration, and application factories together.

## Decision

Create strict contract and server packages. Licensing validates signed product
licenses and supplies plan input; core Entitlements owns final plan resolution.

## Public surfaces and transports

The contract exports Zod schemas, values, handled errors, and abstract service
capabilities. The server exports class implementations and abstract runtime ports.

## Dependencies

The contract depends only on Entitlements contracts, handled errors, and Zod 4.
The server depends only on its contract and Node runtime types.

## Persistence

The server defines an abstract license repository. Application composition owns
the Prisma adapter and supplies seat counts through that same port.

## Runtime and registration

`LicenseService`, `LicenseGenerationService`, and `NodeLicenseCryptography` use
private constructors with `static create`; imports perform no registration.

## Environment and configuration

Neither feature package reads environment variables. The application resolves
verification keys and retention settings into explicit class configuration.

## Errors

Invalid keys and signing failures retain stable handled error codes. Validation
returns closed failure verdicts, while missing organizations throw explicitly.

## Contracts and validation

Signed payloads retain backward-compatible key order and optional historical
fields. All portable schemas execute on Zod version four.

## Consequences

Licensing can serve REST, RPC, or application callers without owning transport,
Prisma, global factories, or final entitlement selection policy.
