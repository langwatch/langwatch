# ADR-001: One Secret service with modern REST

**Status:** Accepted

## Context

Project secrets had a lifecycle spread across the transports that used them:
name rules, the reserved-name list, the per-project ceiling and encryption were
each re-stated where they were needed. Secrets are also the one resource where a
leak is unrecoverable, so a second implementation is a second place for a value
to escape.

## Decision

The Secret feature owns project-secret metadata, name and value validation,
reserved-name policy, the intrinsic limit of 50 secrets per project, and
encryption-at-rest orchestration behind one canonical `SecretService`.
`PrismaSecretRepository` and the encryption port are server-private. Runtime
composition constructs the service once and supplies it through the App
context. Transports do not construct services or repositories.

The preferred public Secret API is the modern validated REST API rooted at
`/api/v1/secret`, with `/api/v1/secrets` and `/api/secret` retained as stable
aliases. Each has a direct collection route at its root and item routes below
`/:id`; `v1` is the explicit path version, while the unversioned modern route
selects `latest` unless `X-API-Version` selects `v1`. REST input and output schemas
are portable Zod 4 contracts. Every request supplies its target `projectId`;
transport authentication and authorisation check that exact target before the
service call. Writes use `context.actor().id` for attribution.

`/api/v1/secret` is the preferred public API; `/api/v1/secrets` and
`/api/secret` are stable aliases. The deployed unversioned REST family at
`/api/secrets` remains a thin compatibility transport for released clients. It
delegates to the same canonical service. Its existing URLs, inputs, outputs,
authentication, authorisation, error mapping, and deprecation signals are the
compatibility target; the review ledger records the known actor-attribution and
duplicate-message parity gaps. All four REST prefixes appear in generated
OpenAPI so existing integrations and newly generated clients see their actual
choices. The branch-only public RPC family at
`/api/secrets/{version}/secrets.*` is removed; app tRPC procedures remain
first-party application adapters and do not add output validation.

Transport layers own authentication, authorisation, wire validation, and
transport-specific limits. The service owns domain invariants, encryption, and
handled domain errors.

Modern REST intentionally opts out of generic transport rate and resource
limits today. Requests remain bounded by the framework input-size ceiling and
the service's 50-secrets-per-project invariant; no additional quota is
invented by this migration. These actor-sensitive operations do not enable
caching. A reviewed per-operation rate/resource policy remains a follow-up
rather than an implied protection.

## Public surfaces and transports

The contract publishes the secret values, the permission vocabulary its queries
require, the errors and the abstract service. Unlike most features, Secret also
publishes its own transports: a REST installer and a tRPC router live in the
server package, so every host mounts the same routes rather than restating them.
The application mounts the REST installer three times, at `/api/v1/secret`,
`/api/v1/secrets` and `/api/secret`, and mounts the deployed `/api/secrets`
family alongside as a compatibility transport. The tRPC router is composed both
by the platform application's internal router and by the standalone API
application.

## Dependencies

The contract depends on the authorization contract for the permission a query
declares, on the shared handled-error package and on Zod. The server depends on
that contract, on the shared REST service type its installer targets, on the
shared tRPC types its router builds against, and on the generated Prisma
client. Secret depends on no other feature, and the encryption
implementation is a port the host fills rather than a dependency.

## Persistence

One private Prisma repository owns the `ProjectSecret` table. It stores the
encrypted value and the metadata a caller may read; the plain value exists only
inside a service call. Every operation carries the target project identifier, so
a credential valid for several projects still reaches only the one the transport
authorised for that request.

## Runtime and registration

Process composition builds one service from the Prisma client, the host's
encryption port and the reserved-name list, and exposes it on the application
context; the REST and tRPC surfaces are installed from the same package at
router assembly. The feature owns no worker job, subscriber or event pipeline,
so one instance serves every process role and both applications.

## Environment and configuration

Secret packages read no environment value. Encryption keys never enter the
feature: the host implements the encryption port with its own configured
cipher, and the reserved names are passed in, so a deployment changes either
without touching this boundary.

## Errors

A missing secret, a reserved name, the per-project ceiling and a duplicate name
throw handled errors carrying the codes `secret_not_found`,
`secret_name_reserved`, `secret_limit_reached` and `secret_already_exists`. Each
is a customer fault with the status its transports already returned, and none of
their messages carries a secret value.

## Contracts and validation

Zod 4 schemas define the REST inputs and outputs and the service inputs. Output
schemas are metadata-only by construction, so no encrypted or plain value can
reach a response even if a future repository read selects one. Transports own
wire validation and the framework input-size ceiling; the service owns the
domain invariants behind them.

## Consequences

- Secret values never occur in service results, public outputs, or logs.
- There is one lifecycle implementation and one service graph.
- Multi-project credentials can select only a project authorised by the
  transport for that request.
- Public REST responses remain metadata-only and cannot expose encrypted
  values.
- Released legacy REST clients remain supported without creating a second
  Secret implementation.
- Rate/resource policy beyond input-size and the intrinsic project limit is an
  explicit residual, not a claim this surface already makes.

## Review ledger

- F-API-04: the workspace OpenAPI generation task reaches
  `signInDomainRoutingPort` before the task process has an initialized
  environment. It must be restored before checked-in platform and docs
  artifacts can be regenerated.
- The TypeScript CLI's project header behavior for scoped credentials and the
  legacy REST actor/error-text compatibility review remain separate follow-up
  decisions; this route-matrix change does not alter either behavior.
- Direct static mounts now use distinct OpenAPI operation IDs and are included
  in the generator's app-derived pruning set, so those two review findings are
  resolved by this change.

Executable behaviour: [secret.feature](../specs/secret.feature).
