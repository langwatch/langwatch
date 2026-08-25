# ADR-001: Enterprise packages have one legal and catalogue root

**Status:** Accepted

**Behavioural contract:** [Enterprise package catalogue](../specs/enterprise-catalogue.feature)

**Related:** [ADR-111: physical application workspaces](../../../dev/docs/adr/111-physical-application-workspaces.md)
and [ADR-112: singular feature ownership](../../../dev/docs/adr/112-singular-feature-ownership.md)

## Context

Enterprise code previously lived below the legacy application, mixing legal,
feature ownership, and runtime composition in one physical source tree.

## Decision

`packages/enterprise` is the governing legal root and `@langwatch/enterprise`
is a portable catalogue of explicitly named Enterprise feature contracts. The
catalogue contains only `audit-log`, `billing`, `governance`, `licensing`,
`managed-provider`, `saas`, `scim`, `sso`, and `webhook`; core `ops` is not an
Enterprise feature. SaaS is classified here because its implementation source
is governed by the Enterprise licence, even though SaaS deployment selection
is not itself an Enterprise entitlement check.

## Public surfaces and transports

The root exports feature identifiers and descriptors only. It exposes no HTTP,
RPC, user interface, persistence, or runtime installation surface.

## Dependencies

The catalogue may depend only on portable Enterprise feature contracts and Zod
4. It cannot depend on implementations or composition packages.

## Persistence

Not applicable. The catalogue owns no repository, storage model, migration, or
other persisted state.

## Runtime and registration

Imports are side-effect-free. Runtime construction and feature registration
belong exclusively to the API, worker, and web composition packages.

## Environment and configuration

The catalogue reads no environment variables. Applications resolve environment
configuration before passing values to their matching composition boundary.

## Errors

Invalid catalogue data is rejected by portable Zod schemas during explicit
catalogue construction; runtime errors belong to feature implementations.

## Contracts and validation

Feature identifiers and descriptors use Zod 4 schemas, while feature-specific
contracts remain owned and versioned by their individual verticals.

## Consequences

Legal ownership is visible from the filesystem, imports remain portable, and
runtime composition cannot accidentally become a catch-all implementation package.
