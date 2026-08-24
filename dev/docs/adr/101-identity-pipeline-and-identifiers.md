# ADR-101: Identity pipeline and the identifiers projection

**Date:** 2026-08-18 (revised 2026-08-20 — the identifiers head moved off `Account` onto a new projection table; see §Revision)

**Status:** Proposed

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`, plan `../identity-platform/delivery-plan.md`, deliverable `../identity-platform/D01-identity-pipeline-and-identifiers.md`. This is the "ADR-1" those documents refer to.

**Relates to:** [`007-event-sourcing-architecture.md`](./007-event-sourcing-architecture.md) (pipeline doctrine), [`022-event-log-source-of-truth.md`](./022-event-log-source-of-truth.md) and [`015-projection-replay-coordination.md`](./015-projection-replay-coordination.md) (both left **unamended** — see §Revision), ADR-052 (process-manager substrate and the content boundary identity deliberately deviates from), ADR-066 (fold contract), ADR-029 §4 (purge tractability), ADR-092 §13 and [`110-grant-aggregates-are-grants.md`](./110-grant-aggregates-are-grants.md) (the grants rollout as it finally shipped — the shape this ADR mirrors, and the one rule it deliberately departs from; see §Revision 2026-08-23).

## Revision (2026-08-20)

The first draft of this ADR adapted `Account` in place — one table holding both protocol secrets (row-truth) and pipeline lifecycle columns (event-truth), under a "column-truth rule" that amended ADR-022/015 and required per-pipeline column scoping in the replay tooling. That draft predates the grants ledger merging. The ledger's final shape on `main` (ADR-092 PRs 1–3, #7143/#7147/#7151) proved the pattern this draft rejected: **mint the native head as a new table, keep the old rows where they are, and move behavior over with data gates — migration first, then reads, then writes — so every intermediate release is production-safe.** With that machinery real, the objection to a parallel table (a dual-write drift window) is dissolved — the fold is the only writer of the new head, and nothing flips until a parity proof lands. The identifiers head is now a **new `Identifier` table, pure event-truth**; `Account` stays a 100% row-truth protocol table, is not a projection, and never enters replay. The ADR-022/015 amendments and the replay column-scoping work are **deleted from the program**.

## Revision (2026-08-24)

The code shape moved under ADR-115: the vocabulary, facts, reducer and errors are `@langwatch/identity`; the guards, the five verbs, the ceremonies and the better-auth facade are `@langwatch/identity-server`; the app keeps the Prisma repositories, the ledger writer (this ADR's §2 dispatch order), the write gate, and one composition root, `platform/app/src/server/app-layer/identity/runtime.ts`. Every decision below stands; the paths it names are where each piece now lives.

## Revision (2026-08-23)

ADR-110 collapsed the grants rollout this ADR mirrored: the cutover table, the cutover flag and the cached gate in front of it are gone, and **the migration's own `finalized` status is the fork** (`engine-gate.ts`). Enrollment is a switch, not a programme — no cohorts, no sampling, no pacing ladder. A migration **does not wait**: it states its facts, checks once, and a tenant whose projection is behind is *held* with the outstanding facts named. This ADR now says the same things in identity's terms (§2, §6): the write gate opens on `finalized` only (`migrated` is held), org enrollment expands to member users and the everyone-else cohort is deleted, and the backfill restates every pass with compensating detaches. Identity adopts ADR-110's queue-only rule too: every write goes through the group queue, with no inline fold. An earlier revision of this ADR kept the fold apply on the calling path, so that ceremonies would survive a Redis outage (the D02 deliverable). **That requirement was withdrawn on 2026-08-24** — the complexity was not worth it at ceremony volume — and with it the divergence. Read-your-writes is now a bounded wait on the projection's cursor, the same shape the grants ledger uses.

## Context

Sign-in identity lives today as protocol rows better-auth writes for us: `Account`, `Session`, plugin tables. Nothing records *why* a row exists, when a method was verified, or what was linked to what — identity state is not data, so every deliverable in the identity program (routing, SSO connections, MFA, migrations off Auth0) has nothing to build on. D01 makes identity an event-sourced pipeline whose projection is a new `Identifier` table, backfilled from current `Account`/`User` state through `@langwatch/system-migrations`, with no product behavior change.

Three architectural questions have to be settled before that code exists:

1. **Who writes the database when better-auth is the protocol engine?** Interception (endpoint hooks after the write) leaves a drift window between better-auth's row and our events, and plugin tables escape hook coverage entirely.
2. **Where does event-sourced identity state live when the protocol table also holds secrets?** Password hashes and OAuth tokens must never ride in events, and ADR-022/015 (single durable source of truth; replay's writes always win) forbid a table that mixes handler-written secrets with fold-written state — unless the doctrine is amended, or the two kinds of state live in different tables.
3. **Can events carry emails?** The grants ledger pseudonymizes every payload. Identity facts *are* emails — attach, verify, invite targeting — and pseudonymizing them would make the log useless for the routing and matching the program exists to build, while GDPR erasure still has to work against an append-only log.

## Decision

### 1. The identity pipeline — same framework, one shared log

`platform/app/src/server/event-sourcing/pipelines/identity/` follows the langy/automations doctrine unchanged: commands via `defineCommand`/`CommandHandler`, per-aggregate FIFO through GroupQueue, events appended to the **same ClickHouse `event_log` as every other pipeline** — no identity-private store, no outbox (epic R13). Postgres holds the projections and every row-truth value. The sign-in hot path reads Postgres only; ClickHouse being down degrades *ceremonies* (sign-up, attach, admin changes) to a retryable error, never sign-in itself, because sessions and token refreshes emit no events (epic R12).

Aggregate tenancy: `user_identity` uses `tenantId = userId` — the user is the tenant of their own identity history, so erasure and support lookup are a single tenant scan (ADR-029 §4). The event store treats tenant ids as opaque (the ledger already appends under a reserved non-org `"platform"` tenant), so a user-rooted tenant is infrastructure-clean. Org-rooted aggregates in later deliverables (`sso_connection`, `join_request`) use `tenantId = organizationId`.

### 2. The identity ceremonies — better-auth's own hooks carry the meaning

**Revised 2026-08-24.** This section previously specified a routing facade
implementing better-auth's `database` contract, with the stock prismaAdapter
as its row engine. That is withdrawn: better-auth keeps the stock adapter,
and identity binds to its **`databaseHooks`** instead. §Rationale records why
the original reasoning did not survive contact.

Four hooks, four ceremonies (`IdentityCeremonies`, one class):

```text
                     better-auth (protocol engine)
                                │
        ┌───────────────────────┴────────────────────────┐
        │                                                │
   databaseHooks                              stock prismaAdapter
        │                                     (every row write, untouched)
        │  account.create.before  → attach the identifier, pin the row id
        │  account.delete.before  → detach what the row mirrors
        │  user.create.after      → mint the user's HMAC hash key
        │  user.delete.before     → erase the user
        │
        └── WRITE GATE (per user)
              latched   → identity COMMAND: guards veto while no row
                          exists → events appended to CH (waited) →
                          command staged onto the user's queue lane →
                          bounded wait for the fold
              unlatched → nothing; the row write proceeds untouched and
                          the backfill adopts the row on its next pass

   A `before` hook that returns false refuses the row write, which is what
   keeps veto-before-write true. better-auth resolves the row for the delete
   hooks itself and fires them PER ROW on a deleteMany, so a batch cannot
   skip one. It also calls the adapter with `forceAllowId: true` on every
   create, so returning `{ data: { id } }` from the create hook pins the
   Account id — which is what makes the live identifier id and the id the
   backfill later derives from that row the same id.

   Reads are untouched: protocol reads hit Account/Session as always;
   domain reads hit Identifier from D03 on.
```

**What this gives up, stated plainly.** `databaseHooks` cover `user`,
`session`, `account` and `verification`. A future plugin table (MFA in D06,
passkeys in D07) has no hook, so it gets no ceremony *and no alarm* — where
an unrouted write used to fail loudly. That gap is the backfill's: it already
reconciles rows the live path missed, and a deliverable that adds a table
adds its ceremony in the same change.

Command → event → projection, never a hand-written upsert in a handler. Protocol values (password hash, tokens) ride only on the command — transient, never durably stored in events — and land through the credentials repository as row-truth on `Account`. Read-your-writes holds because the ledger waits, bounded, for the queue's fold to move the projection cursor past the events it just appended. The wait is an observation, never a second writer: a fold that cannot run makes the wait expire, the facts stay durable, and the next pass restates whatever the heads do not yet carry. A thin endpoint-hook plugin stamps ceremony context (flow, actor, request metadata) onto request-scoped storage so a ceremony knows why a row is written.

**The write gate** is the authz engine gate re-tenanted (ADR-110: finishing the migration IS the switch): the command-emitting branch fires only for users whose `identity-d01-identifier-backfill` migration state is **`finalized`** — read from `SystemMigrationTenantState` with tenant = the user, cached per user with the shared per-subject cache (`_shared/per-subject-cached-gate.ts`, the same module `engine-gate.ts` uses keyed by organization), fail-safe to the protocol-only path. `migrated` is the **held** state, exactly as for the engine gate: the history landed but the proof found the projection behind or disagreeing, so the user stays protocol-only and the next pass restates and heals. The gate ships **closed for everyone**: wiring the ceremonies changes nothing on its own; a user's events start only after their backfill has proven itself, so live events never precede their history. Protocol writes are identical on both sides of the gate — the gate governs *whether events are also emitted*, never whether better-auth works. Both directions of the gate (a latch opening, an operator rollback closing) take effect within the cache TTL — there is no cross-pod invalidation, and that bound is documented rather than discovered.

**Dispatch order is pinned**, and it is the grants ledger's order: durable append to ClickHouse first (waited), the command staged onto the per-user GroupQueue second (awaited — the fold is the queue's, so a staging failure is a real failure, not a metric), and a bounded read-your-writes wait third. Nothing applies the projection except the fold.

This is what makes "every identity write produces its event" **structural** rather than a hook-coverage promise: guards veto before a row exists, plugin tables are covered by the same seam, and there is no enrich-after-write drift window for replay to disagree with.

### 3. The identifiers projection — a new table, born clean

Both tables are Postgres — only the events live in ClickHouse.

```text
Identifier (NEW Postgres table — pure event-truth, fold-written, replay rebuilds it whole-row)
  id            deterministic KSUID (grant-id discipline: every bit derived from
                (userId, provider, providerAccountId | value-hash, occurredAt))
  userId · provider (widened enum) · value (normalized; erasure wipes)
  domain · identifierHash · accountId? (FK-shaped link to the protocol row)
  state · connectionId · verifiedAt · attachedAt · detachedAt

Account (UNCHANGED in role — 100% row-truth protocol table, like Session)
  password · access_token · refresh_token · id_token · providerAccountId · …
  written by repositories and by better-auth itself; NOT a projection; NOT in replay;
  deleted on erasure
```

No table mixes truths, so **ADR-022 and ADR-015 stand unamended**: `Identifier` is an ordinary whole-row projection (replay's writes win, exactly as doctrine says), and `Account` is an ordinary operational table the event system never touches. Identity enters replay discovery from its first release. Deterministic ids make backfill and live emission converge on the same rows (adoption, not re-creation — the genesis-import discipline). No DB unique constraint on the natural key — tombstones and replay make constraints lie; uniqueness of verified values is a command-time guard re-checked inside the verify command.

`User.email` stays polyfilled from the PRIMARY identifier once a user is latched; switching PRIMARY updates it through the fold.

### 4. The payload rule — emails yes, secrets never

Identity event payloads carry opaque ids, enums, timestamps, email **domains**, `identifierHash = HMAC-SHA256(userHashKey, normalized value)` — and the normalized **email itself where the fact is about one**. Secrets never appear in any event. This is a deliberate divergence from the grants ledger's full pseudonymization (and from ADR-052's content boundary): identity's facts *are* emails, and hashing them would gut routing, linking, and join-matching. `userHashKey` is a row-truth PG value minted at user creation.

### 5. Erasure is an event — and the one sanctioned log mutation

The erase command wipes the email fields out of the user's prior events (a ClickHouse mutation; ids, enums, hashes stay), wipes the value columns on the user's `Identifier` rows and deletes the protocol rows, shreds the `userHashKey` (every remaining hash becomes unlinkable noise), and emits `user_erased`. Replay reproduces the erased state because the log itself no longer carries the value. Encrypting event PII under a rotatable key was rejected: a key inside an immutable log cannot rotate.

### 6. Rollout rides `@langwatch/system-migrations` — migration, then reads, then writes

The rollout is the ADR-110 rollout, re-tenanted: one migration, and finishing it is the switch.

- **Tenant = user.** The runner is generic over its `TenantSource`; identity registers a user-rooted source alongside the existing organization source and the pass runs a second leg over it (same lease, same state table, same ops page). Migration state (`SystemMigrationTenantState`), the latch, and the gate are all per-user.
- **Enrollment = organization, and it is a switch.** On cloud, the ops page enrolls *organizations* — the one pacing lever ADR-110 leaves — and a user is in the cohort when any organization they belong to is enrolled. There is no everyone-else cohort, no sampling and no pacing ladder. A user outside every organization has nothing to enroll them on cloud and simply stays on the legacy path (gate closed, protocol-only writes, D03 falls back to legacy routing) until they join one. Self-hosted runs everything a release declares ready (`runsAutomaticallyOnSelfHosted`) for every user, silently, as always.
- **`identity-d01-identifier-backfill` does not wait.** Each pass re-reads the user's `Account`/`User` rows, states only the facts the heads do not carry (deterministic command ids `backfill:<accountId>`, backdated `occurredAt` from the source row; the guards read the projection first, so a restated fact emits nothing — the store's dedupe is read-side, and a restated row would still be a row written, PR #7429), **detaches identifiers whose account row is gone** (`backfill:detach:<identifierId>:<accountId>`), and proves the fold-built `Identifier` rows against the rows it just read. It consults no `previous` record. Agreement ⇒ `finalized`; a missing or disagreeing row ⇒ **held** at `migrated` with the outstanding identifiers *named* in the report on the ops migrations page, and the next pass revisits. Held is a normal outcome, not an error; parked is what a thrown pass is.
- **Writes flip per user** via the ceremonies' write gate (§2) the moment the user's backfill finalizes. **Reads flip in D03** (the router), gated per user by the *same* status row: resolve the identifier in the new table for finalized users, fall back to legacy routing for everyone else. One source of truth for both forks, as ADR-110 has it.
- **Rollback is a status change.** An operator moves the user's row to `rolled_back`; the gate closes within its TTL, the events stay and are inert until the user is finalized again.

## Rationale / Trade-offs

**Database hooks over an adapter (revised 2026-08-24).** The original decision here was "adapter over hooks", and it rejected *endpoint* hooks emitting events **after** better-auth's own Prisma adapter wrote the row — on three grounds: coverage becomes a promise rather than a structure, guards can only refuse after the fact, and the row-vs-event drift window is permanent.

Two of those three were arguments against the wrong mechanism. `databaseHooks` are not endpoint hooks: `before` fires while no row exists, returning `false` refuses the write, and returning `{ data }` replaces it. So guards refuse *before* the fact and there is no drift window — the same two properties the adapter was chosen to buy.

What the adapter cost, meanwhile, was five mechanisms that existed only because the seam sat below intent: reconstructing which ceremony a write was from a row bag; minting the Account id early and passing `forceAllowId` (better-auth already sets it on every create); pinning deletes to pre-selected ids (better-auth resolves the rows itself); paging `findMany` around its silent 100-row default; and a transaction guard that could only *log* an event gap it had no way to close. It also meant the app carried two interception layers over the same table writes, since `databaseHooks` were already wired for four other concerns.

The third objection stands and is accepted, in §2: a plugin table better-auth has no hook for gets no ceremony and no alarm. The backfill covers it, as it covers every other way the live path can miss a row.

**New table over adapting `Account` in place.** The first draft chose adapt-in-place to avoid a dual-write window on the front door, at the price of amending two doctrine ADRs, building per-pipeline column scoping into the replay tooling, lint-enforcing a column ownership split inside one table, and keeping identity out of replay discovery until all of that shipped. The grants ledger's merged shape showed the window was never the real cost: with one writer (the fold), deterministic ids, a per-subject latch that ships closed, and a parity proof gating every flip, a parallel head has no drift to leak — and the doctrine amendments, the column scoping, and the load-bearing PR seam all disappear. We now pay for a second table and a backfill (both machinery we already own) and keep both doctrine ADRs pristine.

**Queue-only, like ADR-110 — the calling-path apply was withdrawn (2026-08-24).** An earlier revision kept the fold on the calling path so a Redis outage could not stop a sign-in ceremony (D02). The requirement was dropped: it bought resilience nobody had asked to pay for, and it cost a second writer racing the queue's fold, a best-effort staging leg whose failure mode was invisible, and a divergence from ADR-110 that every future reader had to be told about. Identity now stages like every other pipeline, and D03's router takes the same bounded convergence wait the grants ledger takes. A Redis outage stops identity ceremonies landing in the projection, exactly as it stops authorization writes — the facts are still durable, and the backfill restates whatever the heads lack.

**Emails in events over pseudonymization.** The ledger's pseudonymization works because grants facts are about opaque subjects. Identity would have to join every event against PG to mean anything, and the joins would resurrect exactly the coupling event payloads exist to avoid. Erasure-as-mutation is routine ClickHouse practice for PII in append-only logs; the cost — replay reproduces a tombstone, not the original — is precisely the requirement.

## Consequences

- Identity state becomes queryable data with history — the foundation D03–D13 build on. No product behavior changes in D01 itself.
- No doctrine amendment: ADR-022/015 stand; the replay tooling gains nothing identity-specific; identity projections are in replay discovery from the first release.
- The rollout inherits the ADR-110 guarantees: every release ships gated closed by data; flips are per-user, enrolled per-org, proven before they happen, and rolled back by a status change, not a deploy. Rollback applies within the gate's cache window, and that bound is stated (§2).
- better-auth version upgrades review the four hook bindings. A new better-auth model with no binding is silent, unlike the routing table's startup error — the trade §2 records, and the backfill is what closes it.
- The erasure path owns a ClickHouse mutation — operationally heavier than a PG delete, bounded by `tenantId = userId` making it a single-tenant scan.
- Commands carrying transient secrets means command payloads must never be durably logged; the dispatch path already holds this (commands are queue jobs, not events), and review keeps it true.
- The system-migrations runner gains a second tenant source (users) and a second leg per pass. That is new surface in the runner's app composition, not in the generic engine — the engine was generic over tenants from birth. The ops migrations page lists held and parked tenants by id, so a held identity tenant shows as a user id; naming the user is a D05 surface.
- Users outside every organization are not reachable by cloud enrollment. They lose nothing (sign-in is unchanged, and D03 routes them through legacy) and are adopted the moment they join an organization that is enrolled.

## References

- Epic: `dev/docs/identity-platform-redesign.md` (decisions R8, R10–R13) · Plan: `dev/docs/identity-platform/delivery-plan.md` (Wave 1 PR breakdown) · Deliverable: `dev/docs/identity-platform/D01-identity-pipeline-and-identifiers.md` (schemas, payload examples, state machine)
- Doctrine anchor: `specs/event-sourcing/pipeline-model.feature`
- Rollout shape mirrored: ADR-110 (a grant is an aggregate; finishing the migration is the switch — #7358, #7404) on top of ADR-092 §13's engine; `@langwatch/system-migrations` (#7079, #7337)
- better-auth `databaseHooks`: the sanctioned before/after hooks on `user`, `session`, `account` and `verification` writes — where the ceremonies bind (§2)
