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

`@langwatch/presence-web` now owns the reusable, browser-only half of that
extraction: the peer/self session store, the section-visibility store, the
ghost-mode preference store, the presence colour/display-name helpers, the
stable per-tab session id hook, and the presentational components built on
them (`PresenceAvatar`, `PresenceAvatarStack`, `PresenceMarker`,
`PresenceSection`, `SectionPresenceDot`, `TracePresenceAvatars`). None of it
imports tRPC or an app-only hook.

The tRPC-wired half stays in the application under
`platform/app/src/features/presence/**`: `useCursorBroadcast`,
`usePeerCursors`, `usePresence`, `usePresenceFeatureEnabled` (reads
`useOrganizationTeamProject`), `useTracesV2Presence` (reads traces-v2's
`drawerStore`), and the `PeerCursorOverlay` component that composes them.
That is the "network/tRPC/router composition" the app is meant to own; moving
it into the package would mean the package depending on the app's tRPC client
and cross-feature stores, which the package boundary forbids.

The app has not yet been cut over to `@langwatch/presence-web` — its callers
still import the pre-extraction paths under `src/features/presence/{components,stores,utils}`,
which remain byte-identical duplicates of what moved. That cutover needs one
line in `platform/app/package.json` (`"@langwatch/presence-web": "workspace:*"`)
plus a `pnpm install`; both were out of scope for the extraction pass that
created this package (shared, concurrently-edited file). Until that lands,
`src/features/presence/{components,stores,utils}` is deliberate, temporary
duplication rather than a second implementation to design around.
