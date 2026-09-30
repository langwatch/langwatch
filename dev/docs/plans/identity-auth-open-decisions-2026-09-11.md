# Three decisions left open on `feat/identity-auth`

**Date:** 2026-09-11
**Branch:** `feat/identity-auth`, at `8b88052559`
**Why this file exists:** three things on this branch are built, tested, and
pointing at nothing, and each needs a decision rather than an implementation.
A session that picks one up should start here, not from the code, because in
all three cases the code reads as though it already works.

## Before you touch anything: four things already settled

Do not redo these. Each cost a verification pass to establish.

1. **The P1 is fixed** (`bb546d52fc`). better-auth keys Google/GitHub/GitLab/
   Azure accounts by the issuer the provider asserts, and looks an account up
   on the OAuth callback by `(issuer, accountId)` alone. That shape matched
   nothing and threw. Because the key names no user it took the FLEET gate, so
   one finalized user anywhere broke every social sign-in on the deployment,
   legacy users included. Served now by a `byIssuerSubject` shape through
   `resolveByIssuerSubject`. Regression test proven by sabotage.
2. **D04 / `connectionGrandfatherMigration` is left out of the migration
   registry ON PURPOSE.** A scenario pins it: *"PR1 does not run the unproved
   SSO grandfather migration"*. Registering it fails
   `runtime-enrollment.unit.test.ts`. It was recommended as a fix by a review
   agent and reverted. Do not "fix" it. The real residual risk is sequencing:
   nothing populates `SsoConnection`, so a later `SSOCONN_ROUTING=enforce` flip
   would route grandfathered organizations against an empty table.
3. **The passkey last-way-in guard is correct.** The storage adapter refuses
   any passkey delete that is not one exact id equality and routes it to a
   SERIALIZABLE `deleteIfAnotherWayInRemains`. The service-level read is a
   preflight for a nicer refusal, not a race.
4. **Gating is asymmetric.** On cloud the identifier backfill sets
   `enrolledAutomatically = false`, so this branch is inert until an operator
   enrolls an organization. On self-hosted `runsAutomaticallyOnSelfHosted =
   true`, so the next migration pass finalizes users with no operator action.
   "Ships gated off" is only half true, and self-hosted is the tier with the
   least soak.

---

## Decision 1 — born-finalized: retire it, or re-point it

**Recorded in:** ADR-116 §3, "Amendment, 2026-09-11". Both code sites carry a
pointer to it.

### What is true today

The entrance is armed in exactly one place — `routes/auth.ts:190`, for a `POST`
whose path ends `/sign-up/email`. The first statement of better-auth's `before`
hook is `refuseDirectEmailSignUp`, which throws `NOT_FOUND` for that exact path
with no exemption, and `ssoRouteTableCanary` asserts that 404.

So the marker is set, `runWithIdentityBirth(handle)` is entered, and the route
refuses before any birth branch runs. **No user is born on the identity
branch.** Everyone arrives by backfill adoption.
`release_identity_born_finalized_signup` changes nothing when flipped — an
operator targeting an organization gets no behaviour change and no error.
`signupConfirmationPending` in `config/database-hooks.ts` is unreachable for
the same reason, and the newborn reconciliation sweep runs every migration pass
hunting claims only this entrance produces.

Both halves are deliberate and both are tested. Nothing tests the composition,
which is how they came to contradict each other quietly.

### What the entrance is actually still worth

Less than its machinery suggests. `CredentialAccountService.openCredentialAccount`
— the single writer both local sign-up doors share — already states the
credential identifier fact, so the aggregate learns about every new user at
birth anyway. What born-finalized adds on top is only the finalized
migration-state row, so the user never needs adopting.

### Why it cannot simply be moved to the real door

Finalizing makes the identity branch the user's truth. Do it before the fold
lands and the projection is still empty, so the branch answers "no identifiers"
for an account that has them — the "not yet versus nothing" hazard ADR-135
names, and precisely why `birth.ts` sequences stage, then rows, then observe
rather than writing rows first. Moving the entrance means restructuring the
live sign-up path, not moving a call.

### The options

- **(a) Retire it.** Delete `BornFinalizedOptIn`, `IdentityBirthService`, the
  `birth` dep on the storage adapter, `runWithIdentityBirth`, the birth half of
  `birthAwareGate`, and the newborn sweep. Nothing that works today is lost;
  roughly a thousand lines of unreachable code that reads as active stop
  inviting the assumption that new users start on the identity branch.
- **(b) Re-point it** at `openCredentialAccount`, running the birth sequence
  there so a flagged sign-up is finalized at birth with the ordering guarantee
  intact. Real work on the highest-risk path in the product.

**Recommendation: (a).** The entrance's distinctive value was making a
newborn's FIRST write land on the identity branch, and the ordinary attach path
now states that fact anyway. ADR-135 already withdraws this entrance's
provisional identifier heads, so the design is in flux regardless.

**If (b) is chosen,** the ordering guarantee is the whole problem — solve it
before writing code, and note it overlaps Decision 2.

---

## Decision 2 — ADR-135: design the outcome channel, then sequence the rest

**Recorded in:** `specs/identity/one-decision-per-write.feature`, header comment
"WHAT BLOCKS THESE, AS OF 2026-09-11". ADR-135 is **Proposed**. All 11 scenarios
are `@unimplemented` and deliberately NOT bound.

### Why nothing was bound

Binding a scenario before its mechanism exists reports a binding that is not
there, which is the failure mode that feature file was written to end. Three
things block it, and the first two are the ADR's and the spec's own words:

1. **The per-command outcome channel is not designed.** §Decision 3 says a
   `dispatch(command)` that no longer decides has no events to hand the
   convergence wait, so "applied", "refused" and "not yet" collapse into one
   answer. The ADR marks this as blocking §Decision 4 (the collapse of the five
   ledgers), and it is also why *"A write refused by the rule records nothing
   and says so"* is called **unimplementable as written**.
2. **Deleting provisional heads is not safe on its own.** §Decision 2 removes
   the only rows a newborn has before their fold lands. The regression the spec
   shouts about in capitals — a brand-new person on a verified company domain
   told there is nothing for them to join, then sent off to start their own
   organization — is *caused by* that deletion. The "still being set up"
   surfaces prevent it, so the UI scenarios land first or in the same change.
3. **The calling-path guard is load-bearing for two callers.**
   `identity-backfill.service.ts` wraps two dispatches in `tolerateRefusal` and
   depends on the guard throwing SYNCHRONOUSLY, not on its return value.

### The decision

Not "should we do ADR-135" — the ADR is right about the defect (three truths,
one of them true; a decision run twice across a queue hop; an expiry email that
can contradict what was recorded). The decision is **what shape the outcome
channel takes**, because everything else is sequenced behind it.

The ADR names the obvious shape and leaves it undesigned: *the handler records
`{commandId, outcome}`; dispatch reads it.* Open questions a design has to
answer: where that record lives (event? projection? a dedicated table?), how
long it is kept, what a caller sees when the fold has not run yet, and whether
"refused" carries the refusal's code.

**Recommended order:** outcome channel (design first, then build) → the "not
yet" surfaces → provisional heads → the ledger collapse. **Not in a pull
request that is also doing something else** — this branch is already 671 files,
and it is where the P1 above went unnoticed.

---

## Decision 3 — OIDC discovery: keep the door check, or own the fetch

**Landed:** `1e32e2c9a5`. `public-egress.ts` now has a caller.

### What is true today

`public-egress.ts` was written for two ceremonies and had no importer anywhere
— the worst state for a security control, because it reads as active. It had
no caller because **neither ceremony dials from our code**: the domain proof
makes no HTTP request, and the OpenID discovery fetch happens inside
better-auth (`generic-oauth/index.mjs` calls `fetchDiscovery(c.discoveryUrl,
c.discoveryHeaders)`), which takes a URL from us and **no dispatcher**.

So the guard now runs at the boundary this application does own: an operator
typing an issuer into `SsoConnectionBackofficeService.registerConnection`. A
private-resolving issuer is refused before the command goes out, with copy that
names no address, interface or internal service.

### What that does not buy

It is a check at the door, **not** the pinned dial `fetchFollowingPublicHosts`
performs. A name that answers publicly at registration and privately when
better-auth later fetches discovery is not stopped by it. That is DNS
rebinding, and `public-egress.ts`'s own docblock explains why check-then-dial
is the defeatable shape.

### The options

- **(a) Leave it as a door check.** Cheap, already landed, costs an operator
  nothing. Accepts that the actual discovery request is unguarded.
- **(b) Own discovery.** Fetch the OpenID configuration ourselves through
  `fetchFollowingPublicHosts` and hand better-auth the resolved endpoints
  (`authorizationUrl`, `tokenUrl`, `jwksUrl`) instead of `discoveryUrl`. This
  makes the pinned dial real. It is a meaningful change to `ee/sso/providers.ts`
  (20KB, with a documented `accountIssuer` precedence that must not drift) and
  needs care that a provider whose endpoints rotate still works.

**Recommendation:** (b) eventually, not urgently, and not bundled. The door
check closes the careless case — an operator pasting a metadata address —
which is the realistic one. (b) closes a deliberate attack by someone who can
already register an SSO connection for their own organization, which is a much
narrower threat. Decide whether that threat is in scope before paying for (b).

---

## Verification state at `8b88052559`

- `pnpm typecheck` (app) clean; `@langwatch/identity` and
  `@langwatch/identity-server` typecheck clean, source and tests.
- `@langwatch/identity-server`: 283 tests passing.
- App: 1244 passing / 8 skipped across 88 files in the identity, api,
  better-auth and errors suites.
- `pnpm check:feature-parity` exits 0.
- Every new guard on this branch was sabotage-tested: the fix was reverted, the
  test was watched to fail, and the fix restored.

## What is NOT covered by any of this

CodeRabbit never reviewed this PR — 665 files exceeds its 300-file limit, so
its silence is not a clean bill of health. Its skipped-review comment is
housekeeping, not a finding.
