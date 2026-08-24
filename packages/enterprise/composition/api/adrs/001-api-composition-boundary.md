# ADR-001: Enterprise API composition stays role-specific

**Status:** Accepted

**Behavioural contract:** [Enterprise API composition](../specs/api-composition.feature)

## Context

API feature implementations need one explicit assembly boundary without making
feature packages register themselves or importing worker and web composition.

## Decision

`@langwatch/enterprise-api` exports a class with `static create` that holds the
portable catalogue and explicitly supplied API-facing feature capabilities.

## Public surfaces and transports

The package exposes composition state only. Feature packages continue to own
their HTTP, RPC, validation, and transport-specific public surfaces.

## Dependencies

The API composition may depend on portable contracts and Enterprise server
surfaces, but never worker, web, Prisma, or legacy application aliases.

## Persistence

Not applicable. Persistence implementations remain feature-owned and arrive as
already constructed dependencies supplied by the physical API application.

## Runtime and registration

Construction is explicit through `EnterpriseApiComposition.create`; importing
the package performs no registration, startup work, or singleton mutation.

## Environment and configuration

The package reads no environment variables. Validated application configuration
is converted into feature services before those services are supplied here.

## Errors

Feature-specific handled errors remain owned by feature contracts. Composition
does not translate or swallow errors returned by installed capabilities.

## Contracts and validation

Options name portable service capabilities directly, preserving compile-time
surface checks without introducing a second transport validation layer.

## Consequences

API assembly becomes discoverable and class-based while existing application
registration can migrate incrementally without cross-role dependencies.
