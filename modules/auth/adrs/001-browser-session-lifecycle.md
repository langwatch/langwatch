# ADR-001: Browser session lifecycle boundary

**Status:** Accepted

**Behavioural contract:** [Browser session lifecycle](../specs/browser-session.feature)

## Context

Better Auth mints and verifies browser sessions, but the rules that decide
whether a verified session is still usable, which identity email it presents,
whose impersonation is active, and what a revocation must delete lived beside
the transports that needed them. Those rules belong to one owner.

## Decision

Auth owns one canonical browser-session lifecycle service. It adapts a session
already verified by Better Auth, fails closed when its persisted session row is
gone, applies the identity-email and active-impersonation compatibility rules,
and revokes both persisted sessions and Better Auth's optional secondary-store
entries. The service receives its private session repository, the complete
User service, and technical cache and clock ports.

Better Auth remains a transport and session-minting adapter. App composition
constructs one `AuthService`; the legacy `getServerAuthSession` helper supplies
its verified Better Auth result to that instance. A Redis cache failure is
reported, then persistence revocation still proceeds, preserving the existing
database fallback behaviour.

Authorized transports that change an email compose the complete User and Auth
services: they persist the User update first and revoke through Auth only for a
material normalized-email change. User does not receive Auth repositories or
callback ports for that cross-feature operation.

## Public surfaces and transports

The contract publishes the browser-session values and one abstract
`AuthService` with four operations: resolve a verified session, revoke one
session, revoke every session for a user, and revoke every other session for a
user. The server package publishes its composition adapter and the concrete
service. Auth mounts no route: the Better Auth handler, the `getServerAuthSession`
helper, the logout route and the `user` tRPC procedures are application
transports that call the composed instance, and the standalone API application
takes the same contract type in its own authentication composition.

## Dependencies

The contract depends only on Zod. The server depends on that contract, on the
User contract for the account facts a session presents, on Identity for the
canonical email, on the shared Redis client for Better Auth's optional cache,
and on the shared observability logger. Auth depends on no other feature.

## Persistence

A private session repository is the only owner of the persisted session rows.
It reads a session by identifier, checks whether the owning account is still
active, lists a user's tokens, and deletes one session, every session for a
user, or every session but one. Better Auth's optional cache entries are removed
through a separate technical port so the durable rows and the cache never share
an owner.

## Runtime and registration

Process composition builds one adapter from the Prisma client, the optional
Redis connection, the Identity email service and the User service, then hands
the built service to the Better Auth factory and the request application
context. The feature registers no worker job, subscriber or event pipeline, so
one instance serves every process role.

## Environment and configuration

Auth packages read no environment value. The Redis connection is an explicit
constructor argument and may be absent; when it is, no cache port is composed
and revocation works from persistence alone.

## Errors

Session resolution never throws for an absent, revoked or expired session: it
returns null and the caller treats the request as unauthenticated. A cache
failure during revocation is logged and swallowed, so the durable deletion still
completes. Auth defines no error codes of its own.

## Contracts and validation

Zod 4 schemas define the verified session Better Auth supplies, the session
shape the application consumes, and the impersonation record. The service parses
the verified input before it reads persistence, and both schemas are strict, so
an unexpected field is a rejection rather than a silent pass-through.

## Consequences

The compatibility `Session` shape, revocation order, and cache key conventions
have one owner. The remaining app transport adapter is deliberately narrow;
process composition installs the service and Better Auth factory once on the
request `App`.
