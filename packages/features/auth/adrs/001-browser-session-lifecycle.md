# ADR-001: Browser session lifecycle boundary

**Status:** Accepted

**Behavioural contract:** [Browser session lifecycle](../specs/browser-session.feature)

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

## Consequences

The compatibility `Session` shape, revocation order, and cache key conventions
have one owner. The remaining app transport adapter is deliberately narrow;
process composition installs the service and Better Auth factory once on the
request `App`.
