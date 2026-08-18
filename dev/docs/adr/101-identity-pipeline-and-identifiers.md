# ADR-101: Identity pipeline, identifiers, and the column-truth rule

**Date:** 2026-08-18

**Status:** Proposed

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`, plan `../identity-platform/delivery-plan.md`, deliverable `../identity-platform/D01-identity-pipeline-and-identifiers.md`. This is the "ADR-1" those documents refer to.

**Amends:** [`022-event-log-source-of-truth.md`](./022-event-log-source-of-truth.md) and [`015-projection-replay-coordination.md`](./015-projection-replay-coordination.md) — cited by filename because both numbers are collided in the corpus. The amendment text is §Amendments below; it is appended to those files in the PR that changes the replay tooling (D01 PR 2), not before.

**Relates to:** [`007-event-sourcing-architecture.md`](./007-event-sourcing-architecture.md) (pipeline doctrine), ADR-052 (process-manager substrate and the content boundary identity deliberately deviates from), ADR-066 (fold contract), ADR-029 §4 (purge tractability), ADR-092 §13 (the grants ledger's dispatch discipline, mirrored here).

## Context

Sign-in identity lives today as protocol rows better-auth writes for us: `Account`, `Session`, plugin tables. Nothing records *why* a row exists, when a method was verified, or what was linked to what — identity state is not data, so every deliverable in the identity program (routing, SSO connections, MFA, migrations off Auth0) has nothing to build on. D01 makes identity an event-sourced pipeline and turns the existing `Account` table into the identifiers projection, backfilled from current state, with no product behavior change.

Three architectural questions have to be settled before that code exists, because each one cuts against a standing doctrine:

1. **Who writes the database when better-auth is the protocol engine?** Interception (endpoint hooks after the write) leaves a drift window between better-auth's row and our events, and plugin tables escape hook coverage entirely.
2. **Can one table hold both protocol secrets and event-sourced state?** ADR-022 says `event_log` is the *single* durable source of truth and ADR-015 says replay's writes always win. Password hashes and OAuth tokens must never ride in events, so those two rules, taken literally, forbid the adapted-`Account` design — or a naive replay clobbers real credentials.
3. **Can events carry emails?** The grants ledger pseudonymizes every payload. Identity facts *are* emails — attach, verify, invite targeting — and pseudonymizing them would make the log useless for the routing and matching the program exists to build, while GDPR erasure still has to work against an append-only log.

## Decision

### 1. The identity pipeline — same framework, one shared log

`platform/app/src/server/event-sourcing/pipelines/identity/` follows the langy/automations doctrine unchanged: commands via `defineCommand`/`CommandHandler`, per-aggregate FIFO through GroupQueue, events appended to the **same ClickHouse `event_log` as every other pipeline** — no identity-private store, no outbox (epic R13). Postgres holds the projections and every row-truth value. The sign-in hot path reads Postgres only; ClickHouse being down degrades *ceremonies* (sign-up, attach, admin changes) to a retryable error, never sign-in itself, because sessions and token refreshes emit no events (epic R12).

Aggregate tenancy: `user_identity` uses `tenantId = userId` — the user is the tenant of their own identity history, so erasure and support lookup are a single tenant scan (ADR-029 §4). Org-rooted aggregates in later deliverables (`sso_connection`, `join_request`) use `tenantId = organizationId`.

### 2. The identity adapter — better-auth never writes the database

We implement better-auth's `database` contract with its `createAdapter` factory — the same first-class plug point the stock Prisma adapter implements. No wrapping, no interception, uniform across core and every plugin. Inside the adapter:

```text
                             better-auth (protocol engine)
                                        │
                            identity adapter (createAdapter)
                                        │
        ┌───────────────────────────────┼─────────────────────────────────┐
        │ READS                         │ DOMAIN-SIGNIFICANT WRITES       │ PROTOCOL CHURN
        │                               │ account create/delete,          │ session rows,
        │ pass through to PG            │ verification, passkey,          │ OAuth token refresh
        │ (the tables ARE the           │ MFA enroll/disable, user create │
        │ projections; hot path         │                                 │ row-truth repository
        │ never touches CH or           │ identity COMMAND:               │ writes, NO events
        │ the queue)                    │  guards veto before any row     │ (SessionRepository /
        │                               │  exists → events appended to    │ credentials repo)
        │                               │  CH (waited) → apply writes     │
        │                               │  lifecycle columns on the       │
        │                               │  calling path → row returned    │
        └───────────────────────────────┴─────────────────────────────────┘
          every (model, operation) is declared in a ROUTING TABLE in the module;
          an unrouted write is a startup error — nothing is implicitly captured
```

Command → event → projection, never a hand-written upsert in a handler. Protocol values (password hash, tokens) ride only on the command — transient, never durably stored — and land through the credentials repository as row-truth. Read-your-writes holds because the apply runs on the calling path; the queue fold re-applies the same events later and converges because applies are idempotent (the ledger's dispatch discipline, ADR-092 §13). A thin endpoint-hook plugin stamps ceremony context (flow, actor, request metadata) onto request-scoped storage so the adapter knows why a row is written.

This is what makes "every identity write produces its event" **structural** rather than a hook-coverage promise: guards veto before a row exists, plugin tables are covered by the same seam, and there is no enrich-after-write drift window for replay to disagree with.

### 3. The column-truth rule

One table, two truth classes, disjoint columns — this is the carve-out from ADR-022/015:

```text
Account (adapted in place, additive migration)
├─ row-truth   value/secret columns: password · access_token · refresh_token
│              · id_token · providerAccountId · raw identifier value
│              written ONLY through the credentials repository from command
│              payloads · EXCLUDED from replay · deleted on erasure
└─ event-truth lifecycle columns: state · connectionId · verifiedAt
               · attachedAt · detachedAt
               written ONLY by the pipeline's apply · the log is the record
               · replay rebuilds them
```

Nobody hand-edits either kind; nobody emits identity events outside command handlers (lint/review-enforced). Replay tooling gains **per-pipeline column scoping**: a projection declares which columns it owns, and a rebuild writes those and only those. Until that scoping ships, identity projections stay out of replay discovery — the ordering is pinned in the delivery plan's PR breakdown.

### 4. The payload rule — emails yes, secrets never

Identity event payloads carry opaque ids, enums, timestamps, email **domains**, `identifierHash = HMAC-SHA256(userHashKey, normalized value)` — and the normalized **email itself where the fact is about one**. Secrets never appear in any event. This is a deliberate divergence from the grants ledger's full pseudonymization (and from ADR-052's content boundary): identity's facts *are* emails, and hashing them would gut routing, linking, and join-matching. `userHashKey` is a row-truth PG value minted at user creation.

### 5. Erasure is an event — and the one sanctioned log mutation

The erase command wipes the email fields out of the user's prior events (a ClickHouse mutation; ids, enums, hashes stay), deletes the PG value columns and protocol rows, shreds the `userHashKey` (every remaining hash becomes unlinkable noise), and emits `user_erased`. Replay reproduces the erased state because the log itself no longer carries the value. Encrypting event PII under a rotatable key was rejected: a key inside an immutable log cannot rotate.

### 6. Backfill rides `@langwatch/system-migrations`

`identity-d01-identifier-backfill` (#7079's expected second rider): cohort-gated on cloud, everything-at-once self-hosted, idempotent per tenant (`backfill:<accountId>` idempotency keys), **self-proving** — a tenant is `finalized` only when replaying its events rebuilds lifecycle columns identical to the live table; a diff holds it at `migrated` with a report on the ops migrations page.

## Rationale / Trade-offs

**Adapter over hooks.** The rejected shape — endpoint hooks emitting events *after* better-auth's own Prisma adapter wrote the row — is less code, but it makes coverage a promise instead of a structure: every new plugin adds tables the hooks don't know, guards can only refuse after the fact, and the row-vs-event drift window is permanent. The adapter costs us implementing the full model surface up front (the routing table is the discipline that keeps that honest: unrouted writes fail at startup, not silently pass through), and buys veto-before-write, uniform plugin coverage, and read-your-writes on the calling path.

**One table over a parallel `identifiers` table.** A new table would keep ADR-022/015 pristine but forces a dual-write/dual-read window against every better-auth read path, and `Account` already *is* the identifier-per-provider shape. Adapting in place costs a doctrine amendment; a parallel table costs a migration with a drift window on the front door. We take the amendment.

**Emails in events over pseudonymization.** The ledger's pseudonymization works because grants facts are about opaque subjects. Identity would have to join every event against PG to mean anything, and the joins would resurrect exactly the coupling event payloads exist to avoid. Erasure-as-mutation is routine ClickHouse practice for PII in append-only logs; the cost — replay reproduces a tombstone, not the original — is precisely the requirement.

## Amendments

Appended to the two doctrine files in the PR that ships replay column scoping (D01 PR 2, per the delivery plan's Wave 1 breakdown):

**To `022-event-log-source-of-truth.md`** — *Amendment: handler-written value columns are row-truth (ADR-101).* "Single durable source of truth" acquires one structural exception: a pipeline may declare **row-truth columns** on a projection table — values written by command handlers through a repository, never carried in events (secrets, erasable PII values). For those columns the row is the record; `event_log` remains the sole truth for every event-truth column. Row-truth columns are excluded from replay and deleted on erasure. The identity pipeline's `Account` value columns are the first instance.

**To `015-projection-replay-coordination.md`** — *Amendment: replay writes are column-scoped per pipeline (ADR-101).* "The replay's writes always win" holds per **owned column set**, not per row. A projection declares the columns it owns; rebuild writes exactly those. A projection that declares no scoping keeps today's whole-row semantics. A pipeline with row-truth columns (ADR-101) MUST NOT enter replay discovery until its column scoping is in place.

## Consequences

- Identity state becomes queryable data with history — the foundation D02–D13 build on. No product behavior changes in D01 itself.
- Two doctrine ADRs acquire a carve-out; the carve-out is lint-enforced and replay-tested (the replay-parity exit gate rebuilds lifecycle columns from CH and diffs against the live table) rather than convention-enforced.
- better-auth version upgrades now review one seam (the adapter + routing table) instead of a hook inventory; a new better-auth model shows up as a startup error until explicitly routed — deliberately noisy.
- The erasure path owns a ClickHouse mutation — operationally heavier than a PG delete, bounded by `tenantId = userId` making it a single-tenant scan.
- Commands carrying transient secrets means command payloads must never be durably logged; the dispatch path already holds this (commands are queue jobs, not events), and review keeps it true.

## References

- Epic: `dev/docs/identity-platform-redesign.md` (decisions R8, R10–R13) · Plan: `dev/docs/identity-platform/delivery-plan.md` (Wave 1 PR breakdown) · Deliverable: `dev/docs/identity-platform/D01-identity-pipeline-and-identifiers.md` (schemas, payload examples, state machine)
- Doctrine anchor: `specs/event-sourcing/pipeline-model.feature`
- Dispatch discipline mirrored: ADR-092 §13 (grants ledger); `@langwatch/system-migrations` #7079
- better-auth adapter contract: `createAdapter` — the `database` option's sanctioned "you handle reading and writing" plug point
