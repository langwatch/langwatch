# ADR-001: One User service owns profile and avatar lifecycle

## Status

Accepted

## Decision

User profile, activation, session invalidation and avatar mutation are one
feature and one public `UserService`. Avatar is not a second feature or public
service. The server package owns its User repository and receives Organization
as a service plus technical session, CLI-token and byte-storage ports.

The core package does not import Enterprise governance. Application composition
adapts the optional CLI-token implementation to the core port. Existing tRPC
procedure names and `/api/user-avatar/:projectId/:id` remain compatibility
transports.

## Consequences

- Callers cannot construct a separate avatar repository or service.
- Email changes and deactivation keep their existing session-revocation rules.
- Avatar validation errors and portable Zod 4 values are shared at the package
  root; binary parsing remains server-only.
