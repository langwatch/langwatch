# ADR-118: Sessions are signed tokens, and revocation is the only lookup

**Date:** 2026-08-25

**Status:** Proposed

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`,
plan `../identity-platform/delivery-plan.md`. Touches every deliverable that
reads a session, and D06 most of all (it is what puts claims on one).

**Builds on:** ADR-093 (Redis is an owned client, resolved per call, and may be
absent), ADR-101 (the identity pipeline), ADR-117 (the front door that mints
these sessions).

## Context

Every authenticated request resolves a session, and today resolving one is a
database read. better-auth stores a `Session` row keyed by an opaque token, the
cookie carries that token, and the server looks it up. Redis sits in front as
`secondaryStorage` (ADR-093), so the common path is a cache hit — but the cache
is an accelerator, not the model: it is optional, it is allowed to be absent,
and every miss, every cold pod, and every deployment without Redis falls back to
Postgres.

That gives session resolution three properties worth naming:

- **It is a read on the hot path of everything.** Not one endpoint — all of
  them, including the ones that do no other database work.
- **Its cost is a network round trip we cannot see in the code.** A route that
  looks like pure computation still pays for a session read before it runs.
- **Its availability is Postgres's.** A database that is slow makes every
  authenticated request slow, including requests that would otherwise never
  have touched it.

The pressure that makes this worth changing now is D06 (`amr`, `identifierId`)
and ADR-117's router: sessions are about to start _carrying_ things — what a
sign-in proved, which identifier minted it, who is impersonating whom. Each of
those is a column on a row that is read on every request, and each makes the
read wider rather than rarer.

### What the row is actually for

Two jobs, and they are not the same job:

1. **Authentication** — "this cookie belongs to user X, and it has not
   expired". This is a _statement_, and a statement can be signed.
2. **Revocation** — "this session was ended before it expired". This is a
   _fact that changes_, and it cannot be signed into the token, because the
   whole point is that it happens afterwards.

Storing job 1 in a database is how we currently get job 2 for free: delete the
row and the session is gone. That is a real property and this ADR must not lose
it — password reset revokes other sessions, deactivation revokes all of them,
`setPassword` (ADR-119) revokes on the way through, and per-identifier
revocation is a D05 ops action.

## Decision

**A session becomes a signed token carrying its own claims. The only lookup on
the request path is a revocation check, and that check is Redis-only.**

- The cookie holds a JWT signed with the deployment's secret, carrying
  `sub` (user id), `sid` (session id), `iat`, `exp`, and the claims D06 adds
  (`identifierId`, `amr`, and the impersonation `{actor, subject}` pair).
  Verifying it is a signature check — no I/O.
- Revocation is a Redis set of revoked `sid`s, each entry living exactly as
  long as the token it kills would have. One `GET` per request, and nothing
  else.
- The `Session` row **stays**, and stays authoritative for the surfaces that
  enumerate sessions: the devices list, per-identifier revocation, ops. It
  leaves the hot path, not the model.

### Why the revocation check is not allowed to fall back to Postgres

This is the load-bearing consequence and the reason the decision is worth an
ADR rather than a refactor.

Today Redis is optional: a miss falls through to the database and correctness is
preserved. Under this decision a Redis miss is _not_ a cache miss — it is the
answer "not revoked", and answering it wrongly means honouring a session
somebody ended. So the revocation store has to be a store, not a cache:

- **A deployment without Redis does not get token sessions.** It keeps the
  database-backed session it has today. This is a per-deployment switch, not a
  degradation mode, because a mode that silently stops enforcing revocation is
  worse than a slower one that never does.
- **Redis being unreachable fails the request**, rather than failing open. A
  bounded fail-open window was proposed once for identity (D02) and withdrawn
  for buying resilience nobody asked for; the same answer applies here, more
  strongly, because what fails open is revocation.

### Why short expiry is not the answer instead

The obvious alternative is no revocation list at all: make tokens short-lived
and let expiry do the work. It is rejected because the window is the product
question, not the implementation detail. "Sign out everywhere" that takes
fifteen minutes to mean anything is not sign-out, and the operations that need
it — a leaked credential, a deactivated employee, an ops revoke — are exactly
the ones where minutes matter. A revocation set is one Redis read; buying
immediacy for that is cheap.

## Consequences

**What gets faster.** Every authenticated request loses a database round trip
and gains a signature verification plus one Redis `GET`. The saving is largest
where it is least visible today: endpoints that do no other database work.

**What gets more expensive.** The cookie grows — a signed token with claims is
larger than an opaque id, and it is sent on every request. Claims must be
chosen with that in mind: `amr` is a short array, not a transcript.

**Claims are a snapshot, not a subscription.** A token says what was true when
it was minted. A user renamed, or an `mfaRequired` turned on, does not reach an
existing token — which is correct for `amr` (it records what a sign-in proved,
and that does not change) and wrong for anything a policy reads live. So
authorization stays where it is: the engine reads current state, and the token
carries identity, not permission. **No permission, role, or membership ever
becomes a claim.**

**Rotation is now a real operation.** Signing key rotation invalidates every
live token unless the verifier accepts a previous key for an overlap window.
That mechanism has to exist before the first rotation, not during it.

**The session row stops being the source of truth for "is this live".** Two
places can now disagree — a row that exists for a revoked `sid`, or the
reverse. The revocation set is authoritative on the request path and the row is
authoritative for enumeration, and nothing may read them the other way round.

## Rollout

Flagged per deployment, and reversible by turning the flag off — a token
session and a row session are both just cookies, so the two can be honoured at
once during the switch and old cookies keep working until they expire.

The order is: verify-both / mint-old, then verify-both / mint-new, then stop
honouring the old. Nobody is signed out at any step, which is the property that
makes this safe to do to a live product.

## Open questions

- **Where the revocation set lives when Redis is clustered.** One key per
  revoked `sid` with a TTL is the simple shape and is cluster-safe; a single set
  is not. Confirm before building.
- **Whether impersonation should be a token at all.** An operator's session
  standing in for somebody else's is the one case where "the claims are a
  snapshot" is least comfortable, and D06 is rewriting that path anyway.
- **Interaction with better-auth's own session model.** better-auth owns
  minting and verification today; this either configures its JWT support or
  sits beside it. That is an implementation question, but a large one, and it
  decides how much of this we write versus configure.
