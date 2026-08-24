# ADR-001: One Secret service with RPC as the public API

**Status:** Accepted

## Context

Project secrets are already used by the application and must keep their
encrypted-at-rest lifecycle while gaining a versioned public RPC surface.

## Public surfaces and transports

`@langwatch/api` mounts dated and `latest` `secrets.*` RPC operations. The
unversioned REST routes and existing tRPC procedures remain compatibility
transports and delegate to the same service. REST is deprecated and excluded
from generated API documentation.

## Dependencies

The server implementation depends on its private repository and encryption
port. Application composition supplies AuthZ, actor, and project context to
the transports; the Secret package does not depend on Langy.

## Persistence

`PrismaSecretRepository` is the only persistence implementation. It returns a
metadata-only shape and never selects encrypted values for reads.

## Runtime and registration

Application composition builds one `PostgresSecretAdapter` and exposes its
memoized `SecretService` as `App.secrets`. Transports read it from their
request context and never construct services per request.

## Environment and configuration

Encryption is injected by application composition. Reserved names and the
per-project limit are configuration passed to the service at process setup.

## Errors

The service raises handled errors for missing/reserved/duplicate secrets and
the project limit. Public transports preserve their status mapping; REST also
emits deprecation headers.

## Contracts and validation

Portable Zod 4 schemas define lifecycle inputs and metadata-only outputs. Each
RPC input includes `projectId`; project authentication verifies it matches the
authorized project before dispatch, while writes obtain the actor from
`context.actor().id`.

## Decision

The Secret feature owns project-secret metadata, validation, limits,
reserved-name policy and encryption-at-rest orchestration behind one public
`SecretService`. Its repository and encryption port are server-private. The
runtime constructs the service once and supplies it to every transport through
the App context.

The documented public API uses `@langwatch/api` RPC operations below the
versioned `/api/secrets/{version}/secrets.*` namespace. The existing tRPC
procedures remain application compatibility adapters. The unversioned REST
family remains live for existing SDKs, but is hidden from newly generated API
documentation and warns on every response. It delegates directly to the same
service and introduces no second Secret implementation.

Every RPC input carries its target `projectId`. Project authentication must
authorize that exact project before the handler runs, so a multi-project
credential can select a project without making the body tenant-authoritative.
Handlers reach the one service as `context.app.secrets`. Create and update
take their user attribution from `context.actor().id`; credentials without a
user identity can read but receive a handled refusal when they attempt a write.

Langy owns the value of its reserved secret name. Application composition
passes that name into Secret; the core Secret package does not depend on
Langy.

## Consequences

- Secret values never occur in service results, RPC outputs or logs.
- RPC, tRPC and deprecated REST cannot drift on lifecycle rules.
- Existing REST clients keep working while new clients target the versioned
  RPC surface.
- Removing the deprecated REST family later does not change the service.
- Public handlers have no service resolver or per-request construction path.

Executable behaviour: [secret.feature](../specs/secret.feature).
