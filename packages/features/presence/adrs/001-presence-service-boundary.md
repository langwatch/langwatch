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

## Public surfaces and transports

`@langwatch/presence-contract`, `@langwatch/presence-server`, and
`@langwatch/presence-web` are the public feature surfaces. Existing tRPC
procedures remain compatibility transports; application hooks compose those
procedures with the reusable web state and components.

## Dependencies

The server receives the canonical Project service, a private Presence
repository, and narrow broadcast and diagnostics ports. The web package
depends on the contract and UI libraries, never app transport hooks.

## Persistence

Redis and in-memory repositories are private server adapters. Presence owns
TTL and delta semantics but neither Project configuration nor the Redis
connection.

## Runtime and registration

Composition builds one service per process and supplies Redis, Project, and
broadcast implementations. Requests use that composed instance.

## Environment and configuration

The feature reads no environment variables. Boot composition supplies typed
TTL and infrastructure configuration.

## Errors

Invalid service configuration throws at composition. Transport middleware
maps service failures without redefining domain behaviour.

## Contracts and validation

Zod 4 schemas in the contract validate portable locations, sessions, deltas,
and cursors at transport and persistence boundaries.

## Consequences

Presence has one service implementation, Project policy has one owner, and a
request neither constructs persistence nor reaches a global Prisma client.

`@langwatch/presence-web` now owns the reusable, browser-only half of that
extraction: the peer/self session store, the section-visibility store, the
ghost-mode preference store, the presence colour/display-name helpers, the
stable per-tab session id hook, and the presentational components built on
them (`PresenceAvatar`, `PresenceAvatarStack`, `PresenceMarker`,
`PresenceSection`, `SectionPresenceDot`, `TracePresenceAvatars`). None of it
imports tRPC or an app-only hook.

The tRPC-wired composition stays in the application under
`platform/app/src/features/presence/**`: `useCursorBroadcast`,
`usePeerCursors`, `usePresence`, `usePresenceFeatureEnabled` (reads
`useOrganizationTeamProject`), `useTracesV2Presence` (reads traces-v2's
`drawerStore`), and the `PeerCursorOverlay` component that composes them.
Moving those hooks would make the package depend on the app's tRPC client and
cross-feature stores.

Application composition imports the reusable presentation and browser state
from `@langwatch/presence-web`; no duplicate implementation remains in the app.
