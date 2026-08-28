# ADR-001: One Secret service with modern REST

**Status:** Accepted

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
