# ADR-001: One Presence service boundary

**Status:** Accepted

**Behavioural contract:** [Collaborative presence](../specs/presence.feature)

## Context

Collaborative presence currently spans a tRPC router, Redis storage, project
policy, broadcast infrastructure, and browser state inside the application.
The service depends on a caller-shaped Project lookup and the concrete
application broadcaster, which hides the product boundary.

## Decision

Presence is a singular core feature. Its portable Zod 4 contract owns presence
locations, sessions, deltas, cursors, and the abstract `PresenceService`.

The server service owns TTL and delta semantics. It receives the canonical
Project service for the effective policy, a private Presence repository, and a
narrow broadcast port. Redis and in-memory repositories are private. The
runtime adapter builds one service for the process and the existing tRPC
procedures remain compatibility transports over that instance.

Presence does not own Project configuration or the Redis connection. It reads
the former through `@langwatch/project-contract` and receives the latter from
runtime composition.

## Consequences

Presence has one service implementation, Project policy has one owner, and a
request no longer constructs presence persistence or reaches a global Prisma
client. Browser extraction can follow through a browser API port without
changing the contract or server lifecycle.
