# ADR-101: Identity pipeline and the identifiers projection

**Date:** 2026-08-18 (revised 2026-08-20 — the identifiers head moved off `Account` onto a new projection table; see §Revision)

**Status:** Proposed

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`, plan `../identity-platform/delivery-plan.md`, deliverable `../identity-platform/D01-identity-pipeline-and-identifiers.md`. This is the "ADR-1" those documents refer to.

**Relates to:** [`007-event-sourcing-architecture.md`](./007-event-sourcing-architecture.md) (pipeline doctrine, and its Redis-loss amendment identity joins in D02), [`022-event-log-source-of-truth.md`](./022-event-log-source-of-truth.md) and [`015-projection-replay-coordination.md`](./015-projection-replay-coordination.md) (both left **unamended** — see §Revision), ADR-052 (process-manager substrate and the content boundary identity deliberately deviates from), ADR-066 (fold contract), ADR-029 §4 (purge tractability), ADR-092 §13 (the grants ledger — the rollout shape this ADR now mirrors end to end).

## Revision (2026-08-20)

The first draft of this ADR adapted `Account` in place — one table holding both protocol secrets (row-truth) and pipeline lifecycle columns (event-truth), under a "column-truth rule" that amended ADR-022/015 and required per-pipeline column scoping in the replay tooling. That draft predates the grants ledger merging. The ledger's final shape on `main` (ADR-092 PRs 1–3, #7143/#7147/#7151) proved the pattern this draft rejected: **mint the native head as a new table, keep the old rows where they are, and move behavior over with data gates — migration first, then reads, then writes — so every intermediate release is production-safe.** With that machinery real, the objection to a parallel table (a dual-write drift window) is dissolved — the fold is the only writer of the new head, and nothing flips until a parity proof lands. The identifiers head is now a **new `Identifier` table, pure event-truth**; `Account` stays a 100% row-truth protocol table, is not a projection, and never enters replay. The ADR-022/015 amendments and the replay column-scoping work are **deleted from the program**.

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

### 2. The identity adapter — better-auth never writes the database

We implement better-auth's `database` contract — the same first-class plug point the stock Prisma adapter implements — as a **routing facade whose row engine is the stock prismaAdapter** (decided 2026-08-20; reimplementing the adapter's query/field-mapping translation from scratch would duplicate hundreds of lines of the stock adapter on the most sensitive surface we own, for no structural gain). The facade is uniform across core and every plugin, and the guarantees live in the facade, not the engine: every write is routed, gated, and vetoable before the engine sees it. Inside the adapter:

```text
                             better-auth (protocol engine)
                                        │
                            identity adapter (routing facade)
                                        │
        ┌───────────────────────────────┼─────────────────────────────────┐
        │ READS                         │ DOMAIN-SIGNIFICANT WRITES       │ PROTOCOL WRITES
        │                               │ account create/delete,          │ session rows, OAuth
        │ pass through to PG            │ verification, passkey,          │ token refresh, and the
        │ (protocol reads hit           │ MFA enroll/disable, user create │ protocol row of every
        │ Account/Session as            │                                 │ domain write
        │ always; domain reads          │ WRITE GATE (per user):          │
        │ hit Identifier from           │  latched   → identity COMMAND:  │ row-truth repository
        │ D03 on)                       │    guards veto before any row   │ writes to Account /
        │                               │    exists → events appended to  │ Session — identical to
        │                               │    CH (waited) → fold applies   │ stock adapter behavior,
        │                               │    to Identifier on the calling │ NO events
        │                               │    path → row returned          │ (SessionRepository /
        │                               │  unlatched → protocol write     │ credentials repo)
        │                               │    only, no events (yet)        │
        └───────────────────────────────┴─────────────────────────────────┘
          every (model, operation) is declared in a ROUTING TABLE in the module;
          an unrouted write is refused, loudly, naming itself — and the routing
          coverage test pins the full mounted surface in CI
```

Command → event → projection, never a hand-written upsert in a handler. Protocol values (password hash, tokens) ride only on the command — transient, never durably stored in events — and land through the credentials repository as row-truth on `Account`. Read-your-writes holds because the fold apply runs on the calling path; the queue fold re-applies the same events later and converges because applies are idempotent (the ledger's dispatch discipline, ADR-092 §13). A thin endpoint-hook plugin stamps ceremony context (flow, actor, request metadata) onto request-scoped storage so the adapter knows why a row is written.

**The write gate** is the grants write gate transplanted (`ledger-write-gate.ts` shape): the command-emitting branch fires only for users whose `identity-d01-identifier-backfill` migration state is `migrated | finalized` — read from `SystemMigrationTenantState` with tenant = the user, cached per user with the shared `perOrganizationCachedFlag` primitive generalized to arbitrary subjects, fail-safe to the protocol-only path. The gate ships **closed for everyone**: deploying the adapter changes nothing on its own; a user's events start only after their backfill has landed, so live events never precede their history. Protocol writes are identical on both sides of the gate — the gate governs *whether events are also emitted*, never whether better-auth works.

**Dispatch order is pinned** (this is the identity analog of the ledger's enforcement-first discipline, and it is deliberately the *reverse* of the ledger's merged `send()`-first revocation path, which has a Redis-down hole): durable append to ClickHouse first (waited), fold apply on the calling path second, GroupQueue staging **last and best-effort** — staging exists for convergence re-apply, and a failed staging is a metric, not a failed ceremony. The cursor-guarded fold catches any missed apply on the aggregate's next event or on replay.

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
  written by repositories from the adapter; NOT a projection; NOT in replay;
  deleted on erasure
```

No table mixes truths, so **ADR-022 and ADR-015 stand unamended**: `Identifier` is an ordinary whole-row projection (replay's writes win, exactly as doctrine says), and `Account` is an ordinary operational table the event system never touches. Identity enters replay discovery from its first release. Deterministic ids make backfill and live emission converge on the same rows (adoption, not re-creation — the genesis-import discipline). No DB unique constraint on the natural key — tombstones and replay make constraints lie; uniqueness of verified values is a command-time guard re-checked inside the verify command.

`User.email` stays polyfilled from the PRIMARY identifier once a user is latched; switching PRIMARY updates it through the fold.

### 4. The payload rule — emails yes, secrets never

Identity event payloads carry opaque ids, enums, timestamps, email **domains**, `identifierHash = HMAC-SHA256(userHashKey, normalized value)` — and the normalized **email itself where the fact is about one**. Secrets never appear in any event. This is a deliberate divergence from the grants ledger's full pseudonymization (and from ADR-052's content boundary): identity's facts *are* emails, and hashing them would gut routing, linking, and join-matching. `userHashKey` is a row-truth PG value minted at user creation.

### 5. Erasure is an event — and the one sanctioned log mutation

The erase command wipes the email fields out of the user's prior events (a ClickHouse mutation; ids, enums, hashes stay), wipes the value columns on the user's `Identifier` rows and deletes the protocol rows, shreds the `userHashKey` (every remaining hash becomes unlinkable noise), and emits `user_erased`. Replay reproduces the erased state because the log itself no longer carries the value. Encrypting event PII under a rotatable key was rejected: a key inside an immutable log cannot rotate.

### 6. Rollout rides `@langwatch/system-migrations` — migration, then reads, then writes

The rollout is the grants rollout, re-tenanted:

- **Tenant = user.** The runner is generic over its `TenantSource`; identity registers a user-rooted source alongside the existing organization source. Migration state (`SystemMigrationTenantState`), the latch, and the gates are all per-user.
- **Pacing = organization.** On cloud, the ops page enrolls *organizations*; the runner migrates the users who are members of enrolled organizations ("check the user's orgs"), with org-less users and stragglers swept by a final everyone-else cohort. Self-hosted runs everything a release declares ready (`runsAutomaticallyOnSelfHosted`), silently, as always. Org is the operator's knob; the user's own latch is the enforcement.
- **`identity-d01-identifier-backfill`** emits adoption events from existing `Account`/`User` rows (deterministic command ids `backfill:<accountId>`, backdated `occurredAt` from the source row), idempotent per user, **self-proving** — a user is `finalized` only when the fold-built `Identifier` rows match what the live `Account`/`User` rows imply; a diff holds the user at `migrated` with a report on the ops migrations page.
- **Writes flip per user** via the adapter's write gate (§2) the moment the user's backfill lands. **Reads flip in D03** (the router), also gated per user: resolve the identifier in the new table first, and fall back to legacy routing for users not yet finalized — the same read-fork discipline as the ledger's cutover gate.

## Rationale / Trade-offs

**Adapter over hooks.** The rejected shape — endpoint hooks emitting events *after* better-auth's own Prisma adapter wrote the row — is less code, but it makes coverage a promise instead of a structure: every new plugin adds tables the hooks don't know, guards can only refuse after the fact, and the row-vs-event drift window is permanent. The adapter costs us implementing the full model surface up front (the routing table is the discipline that keeps that honest: unrouted writes fail at startup, not silently pass through), and buys veto-before-write, uniform plugin coverage, and read-your-writes on the calling path.

**New table over adapting `Account` in place.** The first draft chose adapt-in-place to avoid a dual-write window on the front door, at the price of amending two doctrine ADRs, building per-pipeline column scoping into the replay tooling, lint-enforcing a column ownership split inside one table, and keeping identity out of replay discovery until all of that shipped. The grants ledger's merged shape showed the window was never the real cost: with one writer (the fold), deterministic ids, a per-subject latch that ships closed, and a parity proof gating every flip, a parallel head has no drift to leak — and the doctrine amendments, the column scoping, and the load-bearing PR seam all disappear. We now pay for a second table and a backfill (both machinery we already own) and keep both doctrine ADRs pristine.

**Emails in events over pseudonymization.** The ledger's pseudonymization works because grants facts are about opaque subjects. Identity would have to join every event against PG to mean anything, and the joins would resurrect exactly the coupling event payloads exist to avoid. Erasure-as-mutation is routine ClickHouse practice for PII in append-only logs; the cost — replay reproduces a tombstone, not the original — is precisely the requirement.

## Consequences

- Identity state becomes queryable data with history — the foundation D02–D13 build on. No product behavior changes in D01 itself.
- No doctrine amendment: ADR-022/015 stand; the replay tooling gains nothing identity-specific; identity projections are in replay discovery from the first release.
- The rollout inherits the grants guarantees: every release ships gated closed by data; flips are per-user, paced per-org, proven before they happen, and rolled back by data, not deploys.
- better-auth version upgrades now review one seam (the adapter + routing table) instead of a hook inventory; a new better-auth model shows up as a startup error until explicitly routed — deliberately noisy.
- The erasure path owns a ClickHouse mutation — operationally heavier than a PG delete, bounded by `tenantId = userId` making it a single-tenant scan.
- Commands carrying transient secrets means command payloads must never be durably logged; the dispatch path already holds this (commands are queue jobs, not events), and review keeps it true.
- The system-migrations runner gains a second tenant source (users). That is new surface in the runner's app composition, not in the generic engine — the engine was generic over tenants from birth.

## References

- Epic: `dev/docs/identity-platform-redesign.md` (decisions R8, R10–R13) · Plan: `dev/docs/identity-platform/delivery-plan.md` (Wave 1 PR breakdown) · Deliverable: `dev/docs/identity-platform/D01-identity-pipeline-and-identifiers.md` (schemas, payload examples, state machine)
- Doctrine anchor: `specs/event-sourcing/pipeline-model.feature`
- Rollout shape mirrored: ADR-092 §13 and its merged PRs (#7143 ledger + witnessed migrations, #7147 write gate + genesis adoption, #7151 read gate + parity-proved cutover); `@langwatch/system-migrations` (#7079)
- better-auth adapter contract: the `database` option's sanctioned "you handle reading and writing" plug point — implemented as the routing facade over the stock prismaAdapter row engine (§2)
