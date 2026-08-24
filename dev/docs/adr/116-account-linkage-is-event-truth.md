# ADR-116: Account linkage is event-truth; better-auth reads a projection

**Date:** 2026-08-24

**Status:** Proposed (2026-08-24)

**Builds on:** ADR-101 (the identity pipeline and identifiers — this ADR
changes §2's seam for ONE model and the truth split for ONE table; the
payload rule, the per-user gate, `tenantId = userId` and erasure all stand),
ADR-110 (finishing the migration IS the switch, per tenant), ADR-115 (where
the code lives).

**Related:** PR #7333, ADR-022 (the event log is the source of truth),
ADR-019 (repository / service layering).

## Context

ADR-101 drew a truth split and was explicit about it: `Account`, `Session`
and `Verification` are **row-truth** protocol tables written by better-auth;
`Identifier` is an **event-truth** projection built by the fold. No table
mixes truths.

The split is clean on paper and leaks in one place. `Account` and
`Identifier` both record that a user holds a sign-in method, and they
overlap on exactly `(userId, provider, providerAccountId)` plus existence.
Two tables, two writers, one fact. That is why the backfill's parity check
is **bidirectional** and why a user whose rows disagree is *held* — the
proof exists because the duplication does.

Nothing about the write seam caused this. The routing facade that ADR-101
originally specified had the identical overlap: better-auth wrote its row
and we mirrored the fact into an event. The `databaseHooks` seam that
replaced it (ADR-101 §2, revised 2026-08-24) has it too. Changing where we
intercept never changed how many copies exist.

## Decision

**`Identifier` becomes the only truth for linkage, and better-auth stops
owning a copy of it.**

### 1. The table splits along the truth line, physically

```text
BEFORE                          AFTER
Account                         Identifier            (event-truth, exists)
  id                              id, userId, provider, providerAccountId,
  userId          ─┐              value, state, lifecycle
  provider         │ linkage
  providerAccountId┘            AccountCredential     (row-truth, new)
  access_token    ─┐              id            ← the old Account.id
  refresh_token    │              identifierId  → Identifier.id
  id_token         │ secrets      type
  password         │              accessToken, refreshToken, idToken,
  expires_at, …   ─┘              password, expiresAt, scope, …
```

`AccountCredential.id` **is** the old `Account.id`, and `Identifier.accountId`
already points at it. Nothing has to be re-keyed, and better-auth's `id` for
an account keeps meaning what it meant.

Column-scoped truth was considered and is still rejected: this is a physical
split, not a rule about which columns of one table to believe. That
carve-out was deleted from this programme once already and does not come
back.

### 2. Secrets are why "event sourcing only" has a floor

`access_token`, `refresh_token`, `id_token` and `password` can never enter
the event log (ADR-101's payload rule, R11), and OAuth refresh rewrites them
on a cadence events should never carry. So a row-truth credential store is
not a compromise to be removed later — it is the correct home for that data
forever. What this ADR removes is the duplicated **linkage**, which is the
only part that was ever stated twice.

Sessions likewise stay row-truth (ADR-101 R12): the sign-in hot path emits
no commands, and event-sourcing sessions would put every login through the
queue for nothing.

### 3. better-auth's `account` model is served by an adapter

`IdentityAccountAdapter` implements better-auth's `DBAdapter` for the
`account` model and delegates every other model to the stock `prismaAdapter`
untouched.

**This is not the facade ADR-101 §2 removed.** That one kept better-auth's
storage *and* emitted events, which is precisely what produced two writable
copies — it was the worst of both. This one **replaces** storage for one
model: better-auth has no `Account` table to write, its reads are a join of
the two tables above, and its writes are commands.

Reads:

| better-auth call | served from |
|---|---|
| `findOne(account, [accountId, providerId])` | `Identifier` by `(provider, providerAccountId)` ⋈ credential |
| `findOne(account, [id])` | credential ⋈ its `Identifier` |
| `findMany(account, [userId])` | the user's live `Identifier`s ⋈ credentials |
| `updateMany({password}, [userId, providerId])` | credential rows only |
| `update([id], {tokens})` | credential row only — no event |
| `create` / `delete` | see below |

**The adapter supports exactly the query shapes better-auth issues and
throws, naming the shape, on anything else.** The routing table came back,
and this time it is load-bearing rather than bookkeeping: an unsupported
shape is a *correctness* bug — a silent wrong answer on the auth path — not
an unclassified write. A better-auth upgrade that issues a new shape fails
in CI against the coverage test rather than answering `null` in production.

Writes:

- `create` → the attach ceremony's command, waited to the fold (the ledger's
  bounded convergence wait, ADR-101 §2), then the credential row. Returns
  the joined row better-auth expects.
- `update` / `updateMany` → credential rows only. A token refresh is not a
  domain event and never was.
- `delete` → the detach command, then the credential row.

### 4. Cutover is per user, dual-read, on the existing gate

The adapter is one instance; the fork is per user; and
`findOne(account, [accountId, providerId])` does not know the user until it
has found something. So reads try the projection **first** and fall through
to the legacy `Account` table:

- a finalized user has identifiers, so the projection answers and the legacy
  row — stale from that point on — is never consulted;
- an unmigrated user has no identifiers, the projection finds nothing, and
  the legacy table answers exactly as it does today.

Writes fork on the same `finalized` status every other identity path uses.
No new gate, no new switch, and the same rollback: `rolled_back` returns the
user to the legacy table within the cache TTL.

**Per user, one truth** — which is ADR-110's discipline, not a weaker
version of this ADR's claim. The fleet holds two shapes only while a
migration is in flight, which is what a migration is.

## Consequences

- **Sign-up waits for the fold.** `create` must return the row, so
  registration now costs append + stage + convergence wait, and a Redis
  outage stops registrations. This is only acceptable because the Redis-loss
  requirement (D02) was withdrawn on 2026-08-24 and identity took ADR-110's
  "Redis down ⇒ writes down" position. If that requirement ever returns,
  this decision has to be revisited with it.
- **The backfill's parity proof keeps its job** for as long as any user is
  unmigrated, and becomes dead weight once none are. It is what makes the
  legacy fallback safe to delete.
- **`Account`'s linkage columns become write-only for migrated users**, then
  droppable once the fallback goes. That drop is the deliverable's real exit
  gate, not the adapter landing.
- **A better-auth upgrade is now a real review item** for the `account`
  model: new query shapes fail loudly. Every other model is untouched and
  upgrades as before.
- The app reads `Account` directly in seven places outside generated code;
  each becomes a read of the identity surface or of the credential
  repository.

## Alternatives considered

**Keep the split, rely on the parity proof (status quo).** Honest and
already built, and the proof genuinely catches divergence. Rejected because
"two writers, one fact, reconciled afterwards" is a design that needs a
prover forever, and the prover holds users when it disagrees.

**Column-scoped truth on one `Account` table** — the fold owns the linkage
columns, better-auth owns the secret columns. No migration, no adapter.
Rejected: this programme deleted the column-truth carve-out once already,
and a table whose rows have two writers is exactly what ADR-022 forbids,
whichever columns they touch.

**Rows are truth, events derived by outbox or CDC.** Simplest of all, and it
does give one truth. Rejected because identity would no longer be
event-sourced in any meaningful sense — D03's identifier-first router needs
the projection to be authoritative, not a mirror.

**A Postgres view named `Account` over the join.** No adapter, reads just
work. Rejected: writes then need triggers, which moves the ceremony into the
database and out of the guards.
