# ADR-001: GitHub has one service boundary

**Status:** Accepted

**Behavioural contract:** [GitHub service](../specs/github-service.feature)

## Decision

The singular `github` feature owns the organization GitHub App installation,
webhook, repository access and pull-request linkage lifecycle. Its contract
exports portable Zod 4 values and one abstract `GithubService`. Its server
package composes one concrete `GithubFeatureService` through
`GithubCompositionAdapter.create` at process boot.

Installation and pull-request persistence ports are private abstract classes;
Prisma adapters and the GitHub HTTP client stay private to the server package.
The service receives those ports plus complete collaborating feature services
when composition requires them. It never accepts another feature's
repository, reads environment values, or constructs a process-global client.

The server package root exports only the composition adapter. Existing REST,
tRPC, worker and Langy transports remain application-owned compatibility
adapters and are migrated to the process-owned service graph at the central
composition hook; they do not import server internals or create per-request
services.

Required lookups throw; genuine optional discovery uses an explicit `try*`
name. Tokens are minted on demand and never persisted.

## Context

GitHub installation, webhook and pull-request linkage behavior previously
crossed application services, repositories and transports. A singular feature
boundary keeps the organization connection reusable by Langy and Coding Agent.

## Public surfaces and transports

The contract root is the cross-feature surface. The server root exposes only
the composition adapter. Existing API paths and tRPC names remain compatibility
transports owned by the application.

## Dependencies

The contract depends only on Zod 4. The server depends on the contract and
infrastructure packages. Cross-feature calls receive complete service
contracts, never repositories or concrete feature implementations.

## Persistence

Private installation and pull-request repository ports own the feature's rows.
Prisma adapters map generated records to portable values and are not exported.

## Runtime and registration

The API or worker composition root calls `GithubCompositionAdapter.create` once and
passes the resulting `GithubService` through its process graph. Imports register
no routes, timers or clients.

## Environment and configuration

The feature reads no environment or global application state. App credentials,
host configuration, Redis and other capabilities are injected at boot.

## Errors

Required lookups throw concrete GitHub domain errors. Optional installation,
repository and token discovery is explicitly named with `try*`.

## Contracts and validation

Portable inputs and outputs use the contract package's Zod 4 schemas. Generated
Prisma values and provider response types do not cross the contract boundary.

## Consequences

Consumers depend on one GitHub capability and one composed implementation while
the legacy transports can migrate incrementally without changing public paths.
