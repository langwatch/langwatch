# ADR-001: One User service owns profile and avatar lifecycle

**Status:** Accepted

**Behavioural contract:** [Canonical user lifecycle](../specs/user.feature)

## Context

Profile reads and mutations, activation state, user-scoped preferences, and
avatar storage were previously split between application services. Credential
account creation was also a legacy application helper. This made persistence
and validation ownership unclear while requiring transports to know the User
row shape.

## Decision

The User feature has one public `UserService` contract and one concrete server
implementation. Its private Prisma repository owns profile persistence,
credential/passkey account creation, and avatar URL updates. Avatar is a User
capability rather than a second feature or public service; binary parsing is a
server-only `UserAvatarCodec` collaborator under `services/`.

User state transitions do not depend on Auth or governance implementations.
Deactivation/reactivation update User state only. Process composition owns the
follow-up session and CLI-token revocation using complete Auth/governance
services; this avoids a cyclic User/Auth graph and callback ports.

The core package does not import Enterprise code. Existing tRPC procedure names
and `/api/user-avatar/:projectId/:id` remain compatibility transports.

## Public surfaces and transports

`@langwatch/user-contract` exports portable Zod 4 values, concrete errors, and
the abstract `UserService`. `@langwatch/user-server` exports the composition
adapter and service ports. The application retains the user tRPC router and
avatar REST compatibility route as root-owned transports.

## Dependencies

User server consumes the complete Organization contract for personal-workspace
resolution and a byte-storage port for avatar persistence. Auth/session and
CLI-token lifecycle work is deliberately outside this feature.

## Persistence

Generated Prisma is imported only by `repositories/prisma/prisma.user.repository.ts`.
The repository maps rows through contract schemas and exposes no Prisma types
from the server package root. The composition adapter supplies the semantic
credential issuer; the User package does not duplicate BetterAuth issuer rules.
Credential and passkey creation writes User and Account rows in one transaction;
the old helper is now displaced.

## Runtime and registration

Composition creates one `UserService` instance through `PostgresUserAdapter`.
The deleted legacy credential helper is replaced by `UserService` methods while
Auth root rewiring is completed. Package imports do not register handlers or
construct per-request services.

## Environment and configuration

The feature reads no environment modules. Runtime roots inject Organization,
storage, and other technical capabilities.

## Errors

Avatar validation errors and `UserNotFoundError` are concrete contract errors.
Optional discovery uses only `try*` methods (`tryFindById`, `tryFindByEmail`,
and `tryGetLastHomePath`); required account information uses the throwing
`getAccountInfo` method.

## Contracts and validation

Zod 4 schemas define User profile, account-creation, preference, and avatar
inputs/results. The codec bounds data URLs, validates allowed media types and
binary signatures, and preserves the compatibility delivery URL.

## F-USER-01 strict-layout residuals

The canonical User implementation is under the version-0 layout. Root-owned
compatibility seams remain intentionally outside this slice: the user tRPC
router, avatar REST route, application runtime adapter, and User page shells.
Auth/identity root callers invoke the composed User service for credential and
passkey creation and emit the existing `signed_up` analytics event. The user
transport orchestrates session/CLI-token revocation after state transitions
through complete Auth/governance services. These are composition/transport
obligations, not duplicate User implementations.

## Consequences

- Callers cannot construct a separate avatar repository or service.
- User state has no Auth/governance callback-port cycle.
- Credential and passkey creation preserve the legacy two-row transaction and
  null-password recovery row semantics.
- Avatar validation errors and portable values are shared at the package root;
  binary parsing remains server-only.
