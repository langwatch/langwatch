# ADR-116: `Account` is a projection of the event log, not a source of truth

**Date:** 2026-08-24

**Status:** Proposed (2026-08-24)

**Builds on:** ADR-101 (the identity pipeline and identifiers — this ADR
changes the *status* of one table and leaves §2's `databaseHooks` seam, the
payload rule, the per-user gate, `tenantId = userId` and erasure exactly as
they are), ADR-110 (finishing the migration IS the switch, per tenant),
ADR-115 (where the code lives), ADR-022 (the event log is the source of
truth).

**Related:** PR #7333, ADR-019 (repository / service layering).

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

Nothing about the write seam caused this, and no seam fixes it. The routing
facade ADR-101 originally specified had the identical overlap; so does the
`databaseHooks` seam that replaced it. Changing where we intercept never
changed how many copies exist.

### What the first attempt at this ADR got wrong

The first version of this decision tried to remove the copy by taking the
`account` model away from better-auth: split `Account` into `Identifier`
(linkage) plus a new `AccountCredential` (secrets), and put an adapter in
front of better-auth's storage that served `account` from the join.

It does not work, and the reason generalises:

- better-auth's `findUserByEmail(email, { includeAccounts: true })` asks for
  the user with `join: { account: true }`. Joins are **off by default**
  (`advanced.database.joins`), and when they are off `createAdapterFactory`
  satisfies the join *itself*, with a second query issued through the
  adapter instance **the factory was built around**.
- An adapter that wraps a finished `prismaAdapter` sits **above** that
  factory, so it never sees that query. A migrated user's sign-in read the
  legacy table, found nothing, and failed with "Credential account not
  found".
- Separately, better-auth runs sign-up inside `adapter.transaction`, and for
  that request `transaction` is the **only** method it calls on the adapter.

Both are instances of one rule: **wrapping a built adapter cannot intercept
a model, because the factory's own traffic is below the wrapper.** Serving a
model from other storage has to happen at or below the factory — which means
owning better-auth's Prisma CRUD — and better-auth documents no per-model
storage routing at all.

Rather than fight the library's read paths, this ADR stops standing in front
of them.

## Decision

**`Account` is demoted from a source of truth to a projection of the event
log, alongside `Identifier`. better-auth keeps reading and writing it with
the completely stock `prismaAdapter`.**

```text
                    better-auth
                   /           \
      databaseHooks             stock prismaAdapter
      (state a fact)            (reads + writes its own table)
             |                            ^
             v                            |
        event_log  ───── fold ────────────┤
        (TRUTH)            |              |
                           v              |
                       Identifier      Account
                    (identity's view) (better-auth's view)
```

One truth, two projections. `Account` stops being a peer of `Identifier` and
becomes its sibling: nobody hand-edits it, the fold owns its linkage
columns, and every better-auth join, transaction and query shape works by
construction because nothing intercepts them.

### 1. There is no adapter

`database:` is `prismaAdapter(prisma, { provider: "postgresql" })` and
nothing else. `IdentityAccountAdapter`, `IdentityAccountStore`,
`account-queries.ts` and `account-projection.ts` are deleted, and with them
the enumerated query surface, the dual-read, the legacy-table fallback and
the `UnsupportedAccountQueryError` a better-auth upgrade could trip.

The seam stays exactly where better-auth documents it — `databaseHooks` —
and does exactly what it says: **better-auth calls event sourcing.**

### 2. `Account` is a mixed-truth table, deliberately

ADR-101's "no table mixes truths" rule is broken here on purpose, and this
is the trade-off the whole decision rests on:

| `Account` column | Owner | Truth |
|---|---|---|
| `id`, `userId`, `provider`, `providerAccountId` | the fold | event |
| `access_token`, `refresh_token`, `id_token`, `password`, `expires_at`, `ext_expires_in`, `token_type`, `scope`, `session_state` | better-auth | row |
| `type` | nobody | its default |

`type` belongs to neither: it is a legacy NextAuth column that better-auth's
field map does not even mention, so the fold leaves it to its `@default`
rather than deriving a value it would only be guessing at.

The fold writes a **restricted column set** and must never touch a secret
column: a replay that clobbered `access_token` would undo a token refresh
that legitimately happened after the event. The list is
`FOLD_OWNED_ACCOUNT_COLUMNS` in the projection store, and an integration
test writes real secrets, re-asserts the row from the log, and fails if any
of them moved.

The consequence is stated plainly: **a from-scratch replay restores linkage,
not secrets.** It cannot do otherwise — secrets are barred from events by
ADR-101's payload rule, which is not a limitation to route around but the
reason the rule exists. Recovering `Account` from the log alone yields rows
that identify every sign-in method correctly and hold no credentials.

### 3. Why `AccountCredential` is gone

The first version's split put secrets in their own table so the adapter
could serve `account` from the join. With no adapter, that table is not
optional — it is **unreachable**: better-auth's stock adapter writes tokens
to `Account.access_token`, and it has no way to write them anywhere else.
Keeping it would reintroduce the duplication this ADR removes, one table
further along.

The payload rule is enforced by the fold's restricted column set instead,
which is where it belongs — it is a rule about what may become an event, not
about how many tables exist.

### 4. What `Identifier` keeps, and what it now means

Two columns change meaning rather than existence:

- `providerAccountId` — the provider's own subject. Added by this ADR's
  migration. It was already part of the derived identifier id but never
  stated on the fact, so the projection could not reproduce
  `Account.providerAccountId` without it.
- `accountId` — was "the `Account` row this identifier **mirrors**", and is
  now "the `Account` row this identifier **projects to**". Same column, same
  values, opposite direction. That inversion is the whole ADR in one line.

### 5. Convergence, not atomicity

The live ordering is **fact → row → fold**:

1. `account.create.before` states the attach and waits for the fold.
2. better-auth writes its own row through the stock adapter.
3. A later fold re-asserts the linkage columns.

All three write the same values, so the sequence is convergent. Between (1)
and (2) the fact exists and the row does not; between (2) and (3) the row is
better-auth's own write rather than a projected one. Neither window is
observable as a wrong answer, because every writer agrees on the value.

A `before` hook that refuses still vetoes the row write, so the guard
contract is unchanged.

### 6. Deletes

Unlink deletes the row through the stock adapter, and `account.delete.before`
states the detach first. The fold then reconciles a row that is already
gone: a DETACHED identifier projects to **no** `Account` row, so the fold
deletes one if it finds it and creates none. Erasure reaches the same state
through the same path.

## Consequences

- **better-auth works, entirely.** Joins, transactions, plugin tables and
  every query shape — present and future — are the library's own, because
  nothing sits in front of them. This is the consequence that motivated the
  rewrite.
- **Much less code.** Four modules and their suites are deleted; what
  remains is the fold writing a second table.
- **The duplication is gone in the sense that matters.** `Account` still
  holds linkage columns, but it is no longer *authoritative* for them — it is
  derived, like `Identifier`. There is one writer of record and one truth.
- **`Account` mixes truths.** New, and the honest cost. It is contained: one
  table, a fixed column list, and a test that fails if the fold's write set
  grows.
- **Replay is partial for one table.** Linkage returns, secrets do not. See
  §2 — this is the payload rule doing its job.
- **The backfill's bidirectional parity check can retire.** Once `Account`
  is derived, "do the two tables agree?" stops being a question about two
  authorities and becomes a question about whether the fold ran. That
  simplification is follow-up work, not part of this change.
- **Migration behaviour is unchanged.** The per-user gate still forks the
  ceremonies and the legacy-email read; an unenrolled organization still
  writes nothing extra, because the hooks still return having done nothing.

## Alternatives considered

**Own better-auth's Prisma CRUD (`createAdapterFactory`).** The documented
way to serve a model from other storage: be the adapter the factory is built
around, so join emulation lands on our `findMany`. Rejected for cost and
coupling — it means absorbing and re-syncing better-auth's Prisma adapter on
every upgrade, to keep a table we do not need to own.

**Intercept at the Prisma client instead of the adapter.** Hand the stock
`prismaAdapter` a client whose `account` delegate is served from our tables.
Rejected: it is the same interception one layer down, it trades better-auth's
`Where[]` for Prisma's much larger argument surface, and it breaks silently
the day anyone sets `advanced.database.joins`.

**A Postgres view for `account`.** Map better-auth's model onto a view over
the identity tables. Rejected: writes need `INSTEAD OF` triggers, which puts
domain rules in the database and out of the ceremonies' reach.

**Leave `Account` authoritative and reconcile.** The status quo ante, and
what the bidirectional parity check exists to police. Rejected because it is
the duplication itself: two writers of the same fact, with a proof obligation
attached forever.

**Keep the storage-replacing adapter and intercept joins too.** Add
`model === "user"` with an `account` join to the interception. Rejected: it
guesses at the library's internal read paths, and the next one it adds is
undetectable until a customer cannot sign in.
