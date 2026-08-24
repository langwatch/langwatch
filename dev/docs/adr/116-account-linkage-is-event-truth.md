# ADR-116: better-auth storage goes through the identity adapter, and `Account` retires

**Date:** 2026-08-24

**Status:** Proposed (2026-08-24)

**Builds on:** ADR-101 (the identity pipeline and identifiers — this ADR
restores §2's "no table mixes truths" rule where the `Account` /
`Identifier` duplication breaks it, and keeps the payload rule, the
per-user gate, `tenantId = userId` and erasure exactly as they are),
ADR-110 (finishing the migration IS the switch, per tenant), ADR-115
(where the code lives), ADR-022 (the event log is the source of truth).

**Related:** PR #7333, D03 (identifier-first sign-in router), ADR-019
(repository / service layering), D09 (Auth0 broker cutover — its progress
and proof queries read `Identifier`, never `Account`, since this ADR
retires the table; the cutover itself flows through the one adapter like
every other write).

## Context

ADR-101 drew a truth split: `Account`, `Session` and `Verification` are
**row-truth** protocol tables written by better-auth; `Identifier` is an
**event-truth** projection built by the fold. The split leaks in one place.
`Account` and `Identifier` both record that a user holds a sign-in method,
overlapping on exactly `(userId, provider, providerAccountId)` plus
existence. Two tables, one fact. That is why the backfill's parity check is
**bidirectional** and why a user whose rows disagree is *held* — the proof
exists because the duplication does.

Closing the duplication means better-auth's `account` model has to be
served from the identity tables instead of from a table of its own. That is
a question about **where storage is intercepted**, and better-auth answers
it mechanically. Driving the real `betterAuth()` (1.6.23) end to end
establishes two facts that constrain where an adapter can sit:

- better-auth's `findUserByEmail(email, { includeAccounts: true })` asks for
  the user with `join: { account: true }`. Joins are off by default
  (`advanced.database.joins`), and when they are off `createAdapterFactory`
  satisfies the join *itself*, with a second query issued through the adapter
  instance **the factory was built around** (`handleFallbackJoin` calls
  `adapterInstance.findOne` / `findMany` directly).
- Sign-up runs inside `adapter.transaction`, and for that request
  `transaction` is the **only** method better-auth calls on the adapter.

One rule behind both: **a wrapper over a built adapter cannot intercept a
model, because the factory's own traffic is below the wrapper.** Serving a
model from other storage has to happen *at* the factory — by being the base
implementation `createAdapterFactory` is built around, which is
better-auth's documented seam for exactly this.

The reads this programme needs point at the same seam. Sign-in by any
verified email and identifier-first resolution (D03) both require standing
in better-auth's own read path; no arrangement of shared tables delivers
them from outside it.

## Decision

**better-auth keeps one `database:` entry forever: an identity-owned adapter
built with `createAdapterFactory`. Inside it, a per-user gate routes between
the stock Prisma behaviour (legacy users, verbatim) and event-sourced
storage (latched users). The end state serves the `account` model from
`Identifier` + `AccountCredential`, and the `Account` table is dropped.**

```text
                       better-auth (always, everyone)
                                   │
                 identity adapter (createAdapterFactory base)
                                   │
                 per-USER gate: isUserOnIdentityWrites?
                 (write-gate.ts — finalized-only, cached,
                  fail-CLOSED toward the legacy branch)
                    /                              \
            no — legacy branch              yes — identity branch
                   │                                │
        stock Prisma CRUD, verbatim      writes: fact → event_log → fold
        (Account / User rows,            secrets: AccountCredential row
         authoritative, no events)       reads: Identifier ⋈ AccountCredential
                   │                                │
                   ▼                                ▼
        ┌───────────────────────  Postgres  ───────────────────────┐
        │  Account (bridge, retires)   Identifier  AccountCredential│
        │  User · Session · Verification (row-truth, stock, always) │
        └───────────────────────────────────────────────────────────┘
```

Every table is single-truth again:

| Table | Truth | Writer | Fate |
|---|---|---|---|
| `Identifier` | event | the fold | end state; linkage, emails, primary flag, `providerAccountId` |
| `AccountCredential` | row | the adapter's identity branch | end state; secrets only (`password`, `access_token`, `refresh_token`, `id_token`, `expires_at`, `scope`, …) — barred from events by ADR-101's payload rule |
| `Session`, `Verification`, rate limits | row | stock branch, both populations | untouched forever (ADR-101 R12) |
| `User` | row (profile) + polyfill (`email` from PRIMARY identifier, via the fold) | mixed writers today; the identity branch makes `email` fold-only for latched users | stays — the whole application FKs it |
| `Account` | row (legacy users) / projection (latched users, bridge) | stock branch / the fold | **dropped** when the last tenant finalizes |

### 1. The adapter is the factory's base, not a wrapper

`database:` is our adapter and nothing else. Because we are the
implementation `createAdapterFactory` is built around, both mechanical
facts above land in our favour: fallback-join queries land on **our**
`findOne`/`findMany`, and `transaction` is **ours** to provide. The factory
also does the field-name and type transforms, so the surface we implement is
better-auth's normalized CRUD (`create`, `findOne`, `findMany`, `update`,
`updateMany`, `delete`, `deleteMany`, `count`) over `Where[]` — not raw
Prisma argument shapes. The surface also carries `consumeOne` and
`incrementOne` — verification consumption and rate-limit counters — and both
delegate to the stock logic, because they act only on unrouted models.

`transaction` is ours to provide, and what we provide is what the
application already runs: the stock adapter is configured with `transaction`
unset, which is an as-is passthrough with no real transaction. The identity
adapter preserves that passthrough exactly and invents no cross-branch
transactional promise. The Postgres transaction in §3 is the adapter's own,
inside its create path — not better-auth's.

The legacy branch reuses better-auth's own published Prisma logic rather
than a re-implementation, so an unlatched user's behaviour is byte-for-byte
what the stock adapter did.

### 2. Routing is per record, on the gate that already exists

The fork is `isUserOnIdentityWrites` (`write-gate.ts`): per-user, keyed on
the D01 backfill state row, **`finalized` opens it and nothing else does**,
cached with a TTL, fail-closed. The adapter adds no second flag and no
second state table — ADR-110's "finishing the migration IS the switch",
asked one level lower.

Only the `user` and `account` models are routed at all. Everything else —
sessions, verifications, rate limits, future plugin tables — takes the stock
branch unconditionally, for both populations, forever. Inside those two
models, the fork is narrower than the shape suggests.

**Reads of the `user` model are never routed.** They always serve from the
`User` table, which is complete for *both* populations: the fold polyfills
`email` from the PRIMARY identifier, so a latched user's row still answers
every question it answered before. Population-wide queries — the admin
plugin's `contains` / `starts_with` searches, counts, `OR` connectors — work
unchanged, and they are not per-user routable in the first place. Two things
fork, and only two: **identifier-resolution reads** (find-user-by-email and
the OAuth callback's `(provider, providerAccountId)` lookup), and **`user`
writes that touch `email`**, which become commands on the identity branch
(§6). `identity_unsupported_storage_query` (§7) is scoped to the `account`
model — the only place per-record routing has to be decidable.

A resolution read carries no `userId`, so the identity branch is consulted
**first**, and two conditions must both hold to serve from it: the
identifier **resolves**, and the resolved user's gate is **finalized**. A
miss falls through to the legacy branch; so does a resolution whose user is
*held* (`migrated` — rows exist but the parity proof found them behind or
disagreeing, so `Account` stays authoritative for them until the next pass
heals it).

That `finalized` check reads the migration-state row **directly, joined into
the same Postgres read** — not through the gate's TTL cache. Resolution is
already a Postgres read, so one indexed join adds nothing, and the cache's
failure modes never apply to reads at all; the TTL cache keeps serving write
routing, where it earns its keep. The residual is worth naming: a sign-in by
a secondary verified email has no legacy answer to fall back to, so if the
state table itself cannot be read, that sign-in fails for the duration of
the outage. That is acceptable because the same Postgres serves the legacy
branch — an outage there already takes all sign-in with it. After Phase 3
there is no legacy branch at all, and storage failures surface as errors the
way every other feature's do.

**Resolution normalizes the value first.** better-auth lowercases query
values and does nothing else; `Identifier` values are D01-normalized
(lowercase, plus-strip, fold). The identity branch runs the incoming
`Where` value through the D01 normalizer before resolving, so a
plus-addressed sign-in that works today keeps working the moment its user
latches. Without it, a working sign-in goes dark at latch.

### 3. Born finalized: how a new user starts on the identity branch

A flagged sign-up (the opt-in sign-in page → backend feature-flag check, per
organization/allowlist) sets a request-scoped marker at the auth route
boundary (AsyncLocalStorage).

The reach of that boundary is narrower than it looks today, and saying so is
part of the decision: the product's own sign-up posts to the tRPC
`user.register` procedure, which writes the `User` row through Prisma and
never calls `auth.api.signUpEmail`, so it does not pass the entrance at all.
The entrance is reachable only by a client calling better-auth's sign-up route
directly. Routing `user.register` through `auth.api.signUpEmail` is future
work, and it is a precondition of the general rollout this entrance is
hardened for.

**The marker governs every routed write in that request**, not only the
`user` create. better-auth creates the user and then, in the same request,
the credential account; that second write is routed by the gate, and the
gate cannot see the newborn's state row — it reads on a separate connection
under READ COMMITTED, and `write-gate.ts`'s anyone-finalized short-circuit
caches `false` fleet-wide for its TTL before the first finalized user
exists. So while the marker is set, the adapter routes the newborn's `user`
and `account` writes to the identity branch and treats the gate as open for
that user, seeding the per-user cache when the rows commit.

The ClickHouse append and the Postgres writes share no transaction, and
ADR-101's queue-only rule bars folding in-request. The entrance is therefore
an **idempotent sequence with retries**, not an atomic ceremony.

Ids are minted once per sign-up and reused by every retry: the `commandId`
is the event store's idempotency key (D01 — a retried command dedupes rather
than appending twice), the identifier id is deterministic (D01), and the
newborn's user id is pinned to the flow.

Before any leg runs, the entrance **claims** the newborn's tenant: its
migration-state row is written at `migrated`, carrying a born report. Only
`finalized` opens the write gate, so the claim grants nothing; what it
leaves behind is a handle, and the residual below is what needs one. The
legs, in order:

1. the **idempotent attach command, staged** onto the per-user queue. The
   queued run is the sole appender (ADR-110's shape: appending on the calling
   path as well and staging afterwards writes every fact twice, because the
   staged run re-executes the guard against heads the fold has not advanced
   yet). Staging is what fails loudly when the engine is unavailable, and it
   happens before any row exists on either branch;
2. **one Postgres transaction** over the row writes the entrance itself
   performs — the user row and the `finalized` migration-state row. These
   *can* share a transaction: they are one store;
3. the **bounded wait** on the fold. The fold skips harmlessly and retries
   while the user row is not yet visible.

Nothing after leg two may fail the sign-up. Once the transaction commits, the
user exists and is `finalized`; a throw from the observation that follows
would leave a user nothing owns, since the runner skips terminal tenants and
the sweep hunts claims with no user row behind them.

The pinned user id is a convergence key for a RETRY of one birth, never a
claim on a user who already exists. Normalization strips plus-tags, so
`sam+x@acme.com` derives the id `sam@acme.com` was born under; adopting
whatever row stands at that id would hand the second signer a session as the
first. An occupied pinned id is refused with `identity_email_in_use` before
any fact is stated.

The `AccountCredential` row sits outside that transaction, and better-auth
is what puts it there. `signUpEmail` runs `createUser` and then
`linkAccount`, with `databaseHooks.user.create.after` firing between them —
and this application's after-create hook writes rows that FK the user. The
user row therefore cannot be deferred past its own create to join a later
transaction, so the credential row is written by the account create that
follows, on the identity branch, routed there by the marker. Both rows
exist when sign-up returns, which is what the spec pins.

If any leg fails, the sign-up fails and the retry re-executes **every** leg.
Already-done legs are no-ops — the append dedupes on the command id, the row
writes are keyed by ids already pinned — so a leg written more than once is
absorbed by idempotency and the sequence converges instead of duplicating.

The residual, named plainly: a sign-up abandoned between the append and the
row commit leaves facts under a tenant that never gained a user row. Nothing
serves them — the fold declines to project a user that does not exist, and
resolution reads resolve nothing — and a **reconciliation sweep removes
orphaned newborn streams**. That sweep is a required companion to this
entrance, not optional hygiene, and the claim is what it hunts by: the event
store exposes no aggregate enumeration, and an entrance that dies before the
row commit staged no fold either — so without the claim the orphan would
leave nothing anything could find it by.

This deliberately re-couples flagged sign-up to engine availability — the
coupling the authz programme removed ("born-on-engine"). It is accepted
here because it is scoped: only flag-listed organizations can hit it, and a
flagged sign-up **fails loudly** (`identity_engine_unavailable`, a
`HandledError` with `fault: "platform"`) and is retried when the engine is
down, rather than silently falling back to the legacy branch — a test user
quietly born on the old path would poison the very rollout the flag exists
to test. Before general rollout, this entrance is the thing to harden.

### 4. Phases, and what retires when

**Phase 1 — the bridge.** Stock adapter semantics for everyone; latched
users' ceremonies state facts through `databaseHooks`; the fold projects
**both** `Identifier` and `Account`. This phase ships first and needs no
adapter at all: it puts latched users' linkage into the event log while
`Account` still answers every better-auth read.

**Phase 2 — the identity branch goes live.** The adapter replaces
`prismaAdapter` in `database:`. Latched users' `account`/`user` traffic
takes the identity branch: linkage facts to the log, secrets to
`AccountCredential`, reads from `Identifier ⋈ AccountCredential`. Latching
an existing user carries their secrets across once: each `Account` row's
secret columns are copied into an `AccountCredential` row, preserving the
`Account` row's own timestamps, and the copy is idempotent — running it
again inserts nothing.

Phase 2 supersedes two scenarios in `specs/identity/identifier-model.feature`
that pin the bridge shape — "better-auth reads an account through its own
storage" and "A password change states nothing, because a secret is not a
fact". The adapter change rewrites both; naming them here keeps the corpus
from quietly contradicting itself.

While the `Account` bridge table exists, secrets are mirrored **both ways**.

*Forward:* the identity branch mirrors its secret writes onto the `Account`
row. This is what keeps the gate's fail-closed direction safe — without it,
a finalized user's fresh password would live only in `AccountCredential`,
and a gate outage falling them back to the legacy branch would verify
against a stale `Account` row and wrongly reject their sign-in.

*Reverse:* a finalized user's secret write can land on the legacy branch
anyway — deterministically for up to `IDENTITY_WRITE_GATE_TTL_MS` per pod
immediately after their latch, and during any gate-cache failure. So a
**secrets leg** runs: where an `Account` row's secret columns are newer than
the matching `AccountCredential` row (`updatedAt` comparison), they are
copied back. Without the reverse leg, a password changed in that window is
rejected forever.

It runs as its own identity migration pass rather than as a step of the
backfill, and the runner is why. `finalized` is terminal and the runner
skips terminal tenants, so a step inside the backfill would visit held users
and never the latched population this leg exists for — which is precisely
the population whose secrets can still land on the legacy branch. The heal
therefore carries its own state row and never finalizes it: it reports
`migrated` on every pass, the runner's existing shape for work that is never
done.

With both legs, either branch authenticates a user correctly at any moment,
and "fail closed toward legacy" keeps meaning "sign-in never breaks". The
mirror is write-through only — nothing on the identity branch reads
`Account` — and both legs are deleted with the table in Phase 3.

**Phase 3 — retirement.** When the last tenant is `finalized`: the legacy
branch and the read fallbacks are deleted, the `databaseHooks` ceremonies
retire (the adapter states the facts now), the bidirectional parity check
retires with them, and `Account` is dropped.

Phase 3 has a precondition that does not exist yet. Cloud users who belong
to no organization are enrollable by nothing today, so "the last tenant
finalizes" is unreachable until a **terminal enrollment sweep** —
operator-run, enrolling every remaining user-tenant — exists. Its mechanism
ships with Phase 3.

The phase boundaries are deploys, not flags: each phase is a code change
that removes the previous phase's mechanism, in ADR-110's "the migration
finishing is the switch" discipline.

### 5. Convergence during the bridge is unchanged

Phase 1's ordering is fact → row → fold, all writers agreeing on the
values, neither window observable as a wrong answer. A `before` hook that
refuses still vetoes the row write. Phase 2 tightens this for latched
users: the adapter itself states the fact and awaits the fold, so
guard-refusal becomes a storage-level veto rather than a hook-level one,
and better-auth's own error paths surface it.

### 6. What this buys the multi-email programme

`Identifier` already models multiple addresses with a PRIMARY
(`markPrimary`, `primary_changed`, the guard and reducer all exist).
better-auth has no such concept — `user.email` is one column. The adapter
is what connects them:

- **Sign-in by any verified email**: `findUserByEmail` becomes "find the
  user holding this identifier" on the identity branch. This is the storage
  half of D03's identifier-first resolution; D03's router keeps the
  *decision* logic (domain routing, method picker) and stops needing its own
  read fork.
- **`User.email` gets one writer.** The polyfill from the PRIMARY identifier
  (ADR-101 §2) is written by the fold; better-auth's `changeEmail` /
  `update user` on the identity branch becomes a command the guard can
  refuse, closing the second-writer hole.
- The `User.email @unique` collision on a primary switch is a *guard*
  refusal (a named, handled error) instead of a write failure.

**Collisions are guarded across both populations, in both directions, at
verify time.** Verifying an identifier is refused with
`identity_email_in_use` when the normalized address equals any legacy
user's `User.email` or another user's *verified* identifier. In the other
direction, a legacy sign-up's duplicate check already sees latched users'
verified identifiers through the resolution read, so it cannot claim one.
Unverified (`ATTACHED`) identifiers block nobody — verify is the choke
point both ways, so there is no squatting.

**Those are reads, and a read cannot decide a race**, so a Postgres row-truth
**address lock** (`IdentifierReservation`, keyed by the normalized value)
decides it. The claim is taken atomically before the verification proof is
consumed and before any fact is appended: the loser is refused synchronously
with `identity_email_in_use`, and the event log never records a verification
that did not hold. The born-finalized entrance claims through the same lock,
so the two entrances contend on one constraint. It is a LOCK, not a truth
table — `Identifier` remains the record of who holds which sign-in method —
so the fold RELEASES a claim when its identifier stops carrying the value
(detached, dead-ended, erased), and the identity sweep reaps a claim whose
fact never landed.

The lock is the only place this can live. A unique constraint on
`Identifier.value` is unsound at any width: one user legitimately holds
several proven identifiers carrying one address — a credential sign-in and a
Google sign-in are two VERIFIED rows with the same email — so "one USER per
proven address" is not a row-level rule about that table.

**The account model's id is the identifier's pinned account id.** The
identity branch presents `Identifier.accountId` — the KSUID pinned at
attach, or carried across by adoption — as the `account` model's id,
forever. During the bridge it doubles as the `Account` row's id; after
retirement it is simply the account-model id. `AccountCredential` is keyed
by it, and `update` / `delete` by id resolve through it to both tables.

**Refusals reach the customer as copy, not as codes.** The adapter boundary
translates `HandledError`s into better-auth `APIError`s carrying the stable
`code`, and the auth error surface reads that code into the client
presentation registry; `identity_engine_unavailable`,
`identity_email_in_use` and `identity_unsupported_storage_query` ship in the
registry with the adapter. On the change-email path the guard refusal runs
**before** the verification proof is consumed, so a refusal never burns the
token.

### 6b. A provider subject is unique per connection

The IdP callback's lookup keys on better-auth's own `providerId`, verbatim,
paired with the provider's subject — never on `Identifier.provider`, which is
the FOLDED vocabulary that collapses auth0, okta and every custom OIDC
connection into `oidc`. An OIDC `sub` is unique only *within* an issuer, so
matching the fold let one enterprise IdP's subject resolve another IdP's
user: a cross-tenant sign-in, and a regression against legacy, where
`Account` has always been unique on the verbatim pair. A partial unique index
on `(providerId, providerAccountId)` over the live states now enforces the
same guarantee on `Identifier`.

It is unique where `value` is not, and the asymmetry is not an oversight. One
user legitimately holds several proven identifiers carrying the same
*address* — a password sign-in and a Google sign-in are two rows with one
email — which is why address uniqueness lives in `IdentifierReservation`
rather than in a column constraint. A provider *subject* names exactly one
account at exactly one IdP, so two live identifiers sharing one are always
either a duplicate or a takeover.

**The forward constraint, which is load-bearing.** The real invariant is that
a subject is unique **per connection**. `providerId` stands in for the
connection today only because there is exactly one connection per configured
provider — `auth0`, `okta`, `cognito`, `onelogin`, `oidc`. That is about to
stop being a safe assumption: Auth0 is a broker today, and it namespaces
every enterprise customer behind one `providerId: "auth0"`, which is why
collisions are currently rare. After the exit (D09/D10) each customer
connects to us directly, minting subjects however their own IdP does —
sequential integers and email addresses included — and the count of distinct
connections goes from a handful to one per enterprise customer.

So when connections become data (D04), **every connection MUST get its own
distinct provider id, or the index MUST be extended to include
`connectionId`.** A world in which many customer connections share one
provider id — `oidc`, built from the `OIDC_*` env vars, is the one to watch —
re-opens exactly the cross-tenant sign-in this closes. Until then the
invariant is pinned by a test asserting that no two configured providers
collapse onto the same provider id.

The fold stays total if the constraint is ever violated anyway: the incumbent
keeps the subject, the newcomer is parked with a WARN naming both identifier
ids and both users, and the parked user simply cannot pass the backfill's
parity proof — so they stay HELD with a report, which is the system's own way
of saying "not right yet", rather than the projection stopping for everybody.

### 7. Upgrade discipline — the honest cost

We own the mapping from better-auth's `account` and `user` models onto our
tables: the `Where[]` operators it uses, its update shapes, and any column a
future version adds needs a home in `AccountCredential` or `Identifier`.
This is real coupling to the library's query surface, accepted with three
bounds:

- The factory normalizes queries before they reach us, and its fallback-join
  traffic is ours by construction — the class of failure a wrapper suffers
  cannot recur at this level.
- An `account` query shape the identity branch does not recognise fails
  **loudly** (`identity_unsupported_storage_query`, `fault: "platform"`)
  rather than returning a silently wrong answer. An upgrade that introduces
  a new shape is a test failure and a named error, never a customer reading
  someone else's data or a ghost "account not found".
- The end-to-end suite drives the real `betterAuth()` through sign-up, the
  joined sign-in read, account listing, password change, link and delete on
  every run — a better-auth version bump that changes a query shape fails
  there before it ships. Version bumps to better-auth get a changelog read
  against the adapter as a review-checklist item.

### 8. Deletion and erasure on the identity branch

better-auth deletes a user in one call, not row by row: `deleteMany` on
`account` by `userId`, then the `user` delete. So the identity branch fans
the detach out itself — a detach fact per identifier — dispatches the erase
command, and deletes the user's `AccountCredential` rows. The erase command
is R11's owner once the `databaseHooks` ceremonies retire in Phase 3: the
ClickHouse mutation, the `userHashKey` shred, the value wipes.
`AccountCredential` is row-truth, so it is deleted outright, the way
`Session` is under R11.

## Consequences

- **Every table is single-truth.** ADR-101's rule is restored, not
  amended. The duplication, the parity proof and the mixed-truth guard all
  retire with `Account`.
- **Multi-email stops being bolted on.** The features that motivated the
  identifier model — several addresses, a primary, sign-in by any of them —
  are served from the table that models them.
- **One adapter, forever, that we maintain.** The upgrade coupling in §7 is
  the price, paid deliberately, with loud-failure and end-to-end nets.
- **Flagged sign-ups are an idempotent sequence, not an atomic one.** Scoped
  to the allowlist; a failed leg fails the sign-up and the retry converges
  on the pinned ids; engine-down fails loudly
  (`identity_engine_unavailable`) rather than falling back; hardened before
  general rollout (§3).
- **Replay restores linkage, not secrets.** Replay rebuilds `Identifier`
  whole; `AccountCredential` is row-truth like `Session` and was never in
  replay's contract.
- **Phase 1 ships value without the adapter.** The bridge ships first and
  requires no adapter, so the adapter can land behind the flag without a
  big-bang cutover.
- **Migration behaviour is unchanged for the unenrolled.** The gate ships
  closed; an unenrolled organization behaves byte-for-byte as before.

## Alternatives considered

**Keep `Account` shared forever, as a fold-written projection with no
adapter.** The stock `prismaAdapter` stays in `database:`, and `Account` is
demoted to a projection of the event log for latched users. It works, and
it is what Phase 1 does. Rejected *as an end state*: it concedes a
permanently **mixed-truth table** — linkage columns event-truth, secret
columns row-truth — a permanent restricted-column-set guard policing that
boundary for the life of the system, and a replay that restores half a row.
It also does not reach far enough: identifier-first reads (D03, sign-in by
any verified email) require standing in better-auth's read path, so an
adapter arrives anyway, and once it exists "never intercept anything" stops
being what the shape buys. Adopted as **Phase 1, the bridge**, where those
concessions are temporary and retire with `Account`.

**Wrap a finished `prismaAdapter`.** Split `Account` into `Identifier`
(linkage) plus `AccountCredential` (secrets) and serve the `account` model
from the join via an adapter that **wraps** a built `prismaAdapter`.
Rejected: mechanically impossible against the facts in Context — the
factory's fallback-join queries and its `transaction` traffic are issued
through the instance the factory was built around, which is below any
wrapper.

**Intercept at the Prisma client.** Hand the stock adapter a client whose
`account` delegate is rerouted. Rejected: the same interception one layer
down, against Prisma's much larger argument surface, and it breaks silently
the day anyone sets `advanced.database.joins`.

**A Postgres view for `account`.** Writes need `INSTEAD OF` triggers, which
puts domain rules in the database and out of the ceremonies' reach.
Rejected.

**Leave `Account` authoritative and reconcile.** The status quo and the
duplication itself: two writers of one fact with a proof obligation
attached forever. Rejected.

**A second better-auth instance for the new flow.** Two `betterAuth()`
configurations behind the sign-in flag. Rejected: sessions, cookies and
middleware would fork with it, and every user-facing surface would need to
know which instance a user belongs to — the per-user gate inside one
adapter answers the same question in one place.
