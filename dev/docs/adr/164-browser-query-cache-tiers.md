# ADR-164: Browser query cache tiers, disk persistence and the session version

**Date:** 2026-09-30

**Status:** Accepted

## Context

Every page load and navigation refetches the same identity and workspace reads:
the organization graph (`organization.getAll`, large and slow), the caller's
permissions, feature flags, the plan and `user.isAdmin`. They change rarely, and
when they do the server knows. The browser's one `QueryClient` gives every read
the same 30 second `staleTime`, so it cannot tell a trace list, which should
always be fresh, from the organization graph, which should be trusted until
something changes. Alex (2026-09-30): "when you have an app that needs things to
load, it doesn't make sense to fetch fresh every time", "send last updated at",
and on the revalidation wire, "or etag".

ARCHITECTURE.md §10.1 keeps reads per module: `useOrganizationTeamProject` and
the host mounts keep their API and their own queries. This ADR changes only what
sits under them.

## Decision

**1. A read declares its tier on its contract.** `defineTrpcContract(...).query(name, { cache: { tier, persist } })`
(`packages/api/src/contract/trpc-contract.ts`). Tiers:

| tier        | staleTime | for                                                 |
| ----------- | --------- | --------------------------------------------------- |
| `live`      | 0         | runs, traces, anything streaming                    |
| `session`   | Infinity  | org graph, permissions, flags, plan, `user.isAdmin` |
| `reference` | 1 hour    | model provider lists, catalogues                    |
| undeclared  | 30 s      | everything else, unchanged                          |

`@langwatch/browser-host/cache-tiers` folds the declared contracts into a plan
and applies it with `queryClient.setQueryDefaults` keyed by procedure path, so
no call site states a `staleTime`. A call site that states one still wins.

**2. Marked reads persist to IndexedDB.** `persist: true` (to start:
`organization.getAll`, `modelProvider.getAllForProjectForFrontend`) is saved by
`@langwatch/browser-host/query-persistence` through
`@tanstack/react-query-persist-client` and `idb-keyval`. One entry per user id;
the build id is the persister's `buster`, so a new build discards it; `maxAge`
24 hours, and a persisted read's `gcTime` matches. `shouldDehydrateQuery` admits
only marked, successful reads. Starting for a user removes every other user's
entry first, and logout calls `clearPersistedUiQueries()`. A reload paints the
restored copy and then invalidates it, so it revalidates behind the paint.

**3. The session version invalidates the session tier.** Every tRPC answer
carries `x-lw-session-version`, a monotonic stamp bumped whenever membership,
role bindings, teams, projects, the organization, flags, the plan or the licence
change. The bump comes from subscribers in the modules that own those writes,
never from each mutation by hand. `@langwatch/browser-host/session-version`
reads the header through a `fetch` handed to the transport's existing `fetch`
option; the first stamp is the baseline, a newer one invalidates every
`session`-tier read. A 403 on any mutation, or on a read of another tier, does
the same; a session read refused itself does not, or the refusal would loop.
Mutation invalidation stays the normal tRPC model; the model-provider
BroadcastChannel stays.

**4. Session and reference reads revalidate by a content ETag** (Alex, 2026-09-30:
"can we not set an etag ourselves. if the backend hasn't changed ... then we return
nothing new"). The host hashes the serialised answer body (SHA-256) and answers
`ETag: "<user id>.<hash>"` with `Cache-Control: private, no-cache` and
`Vary: Cookie` on every 200 of a `session`- or `reference`-tier read served as an
unbatched GET. When the browser's HTTP cache sends a matching `If-None-Match`, the
answer is a 304 with no body. This is correct by construction: nothing a 304 hides can
have changed, so no read opts in and no write bumps anything for it. The user prefix
keeps one user's tag from revalidating another's body. Session- and reference-tier
reads travel unbatched (`unbatchedPaths`), so one URL is one read; small reads stay
batched and carry no tag. The procedure still runs: the saving is transfer (the org
graph and model provider lists are 400 KB to 1.2 MB), not compute. A cheap source
version (a projection's last event, a max `updatedAt`) can later skip the compute for
the heaviest reads. The version header still rides every answer and is what
invalidates the in-memory cache; a 403's refetch gets a new hash when the body changed.

## Rationale / Trade-offs

Tiers on the contract keep one source of truth next to the schema, rather than a
table in the browser that drifts from the procedures it names. The stamp plus
content ETag means "trust until told" costs one Redis GET per request and a bodyless
304 per unchanged revalidation, instead of the org graph on every navigation. Persisting only
marked reads bounds what sits on disk: the large, slow, rarely changing ones.

Rejected: persisting the whole cache (unbounded, and it would put traces on disk);
a timer-based staleTime for session reads (either stale after a role change or no
saving); a hand-written bump in every mutation (the first forgotten one is a
permission shown after it was revoked).

## Rulings (Alex, 2026-09-30)

1. **authz owns the session version.** It is authz's state, kept beside the
   per-organization permission epoch (`AuthzEpochRepository`): a Redis counter
   per user, in memory without Redis. `AuthzApi.getSessionVersion({ userId })`
   is the one new operation (approved) and answers 0 for a user never bumped.
   An authz subscriber on the grant pipeline bumps it on membership and
   permission events, after the grant projection has written: the grant's
   principal (a revocation or role change resolves it from the marked grant row,
   so a removed member is bumped), a group's members, every organization member
   for team, organization and role events; API-key, project and share-link
   grants bump no one. The tRPC host reads it through that operation, one Redis GET a request.
2. **The version is per user.** The ETag is not the version: it hashes the answer
   body, prefixed with the user id (decision 4, superseding `"<userId>.<version>"`).
3. **The plan travels with the module's browser Api.** A browser declaration
   states `.withApi(api, { contracts })`; the kernel folds every installed
   module's contracts into one plan for the shell. No public-config field.

Organization, flag and entitlement writes do not bump the version yet, so those
reads are invalidated only by a newer version from a grant, a 403 or a reload; the
content ETag does not depend on the version at all.

## Consequences

- A session read is never refetched by focus, navigation or time; only a newer
  version, a 403, a mutation's own invalidation or a reload revalidates it.
- The shell (ui-kernel) composes three more things: the plan into
  `createUiQueryClient({ cachePlan })`, `sessionVersionFetch` into the transport,
  and `persistUiQueries` once the session names the user and the deployment the
  build.
- Dependencies added to `@langwatch/browser-host`:
  `@tanstack/react-query-persist-client`, `@tanstack/query-async-storage-persister`
  (both pinned to the react-query version) and `idb-keyval`.

## References

- Spec: specs/ui/browser-query-caching.feature
- ARCHITECTURE.md §10 (ruling), §10.1 (reads stay per module)
- ADR-128 (public REST, internal tRPC)
