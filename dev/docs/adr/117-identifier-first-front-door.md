# ADR-117: The identifier-first front door — sign-in router, first-party screens, SSO connections

**Date:** 2026-08-24

**Status:** Proposed (spike for review — Wave 2 of the identity platform)

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`,
plan `../identity-platform/delivery-plan.md`, deliverables
`D03-identifier-first-signin-router.md`, `D13-signin-signup-screens.md`,
`D04-sso-connection-aggregate.md`. This is the "ADR-3" those documents refer
to; it also settles the routing contract D05's self-service consumes.

**Builds on:** ADR-101 (the identity pipeline; §6's read fork), ADR-116 (the
identity storage adapter — resolution reads are the *adapter's* job, which is
what lets the router stay a decision engine), ADR-110 (finishing the
migration IS the switch), ADR-115 (where identity code lives).

**Amends:** [ADR-027](./027-license-gated-sso.md) — the license gate's
*mechanism* moves from path-blocking in the global `before` hook to
per-method policy on the router; every semantic ADR-027 locked is preserved
(§4).

## Context

Sign-in today is `NEXTAUTH_PROVIDER`: one method per deployment, chosen by
env at boot, with the front-door visuals owned by Auth0's hosted pages.
Enterprise SSO is two hand-set strings on `Organization`
(`ssoDomain`/`ssoProvider`), matched in better-auth hooks. The support pain
is structural: a user invited by email who holds a Google account cannot get
in, a wrong-method sign-in dead-ends, and every org's routing is invisible
data nobody can inspect.

D01 gave identity real data: the `Identifier` projection, per-user
`finalized` latches, and (ADR-116) a storage adapter that resolves sign-in
reads — any verified email, OAuth `(provider, subject)` — from the identity
tables for latched users. Wave 2 builds the front door on it:

- **D03** — the routing engine: email in, decision out.
- **D13** — the first-party screen set that renders those decisions; flips
  with D03 on one flag.
- **D04** — `SsoConnection` as a real aggregate; the router's domain lookup
  moves from strings to the projection behind its own shadow flag.

Three constraints shape everything here:

1. **The router must cover every gate site ADR-027 enumerated.** ADR-027:
   Rejected alternatives says path-prefix middleware "still misses the
   legacy `/callback/auth0|okta` rewrite; the `before` hook remains the only
   correct interception point." Moving the mechanism means proving the
   router sees everything the hook saw — including that rewrite.
2. **No user-level existence oracle.** Domain-level SSO routing is
   discoverable by design; whether an *account* exists must not be, on the
   sign-in surface (the sign-up surface is scoped out — §6).
3. **The front door is the highest-risk flip in the program.** Every human
   enters through it. Shadow comparison, a zero-mismatch bake, and a
   one-flag rollback are non-negotiable.

## Decision

### 1. The router is a pure decision engine over Postgres reads

`RoutingEngine.route(input) → RoutingDecision` is a pure function of its
inputs; the inputs are assembled from Postgres reads only (hot path, epic
R12/R13 — sign-in never touches ClickHouse or the queue).

```text
   input                          decision                     reason code
   ─────                          ────────                     ───────────
   (no email, self-hosted,   →    redirect: connection C       sole_active_connection
    exactly 1 ACTIVE conn)
   (?local=1 break-glass)    →    method picker (local set)    break_glass
   email → normalize         →    domain in ACTIVE conn?
     yes                     →    redirect: connection C       domain_routed
     no                      →    method picker (default set)  no_domain_match
   method not in policy      →    refuse                       method_not_licensed |
                                                               method_not_configured

   RoutingDecision = { outcome, connectionId?, methodSet, reasonCode }
```

- **Normalization is D01's, byte-identical** (lowercase, plus-strip, fold) —
  one function, imported from `@langwatch/identity`, never re-implemented.
- **The decision is logged with its reason code.** The same codes drive
  D13's deny/guidance states and the D05 ops surface's "why did this user
  route there?" view. Codes are vocabulary, not copy: the customer-facing
  words live in the client presentation registry, keyed as ever.
- **Domain lookup source**: `Organization.ssoDomain` strings until D04
  lands; the `SsoConnection` projection behind `SSOCONN_ROUTING` after
  (§5). The router takes the lookup as an injected port so the flip is a
  composition change, not a router change.
- **User-level resolution is not the router's job.** Sign-in by any
  verified email and the OAuth callback's subject lookup are storage reads
  the ADR-116 adapter serves, forked per user inside the adapter. The
  router never queries `Identifier` directly and carries no per-user read
  fork of its own — D03 as originally drafted had one; ADR-116 §6 absorbed
  it. What remains per-user in the router is nothing: domain routing is
  org-level data, method policy is instance-level data.

### 2. The uniform method picker — no account-existence oracle

When no domain routes, the answer is the method picker: the instance's
default method set (self-hosted: what env configures; cloud: password +
social + passkey placeholder until D07), rendered identically whether or
not an account exists for the entered email — same page, same timing.

- The router's decision for an unknown email and a known email without a
  domain match is the *same decision object*. Timing normalization is
  pinned by a contract test at the page level (D13), not by sleeps in the
  router.
- Domain-level discoverability is accepted and deliberate: "acme.com
  routes to an IdP" is knowable; "sam@acme.com has an account" is not.
- The break-glass variant `/auth/signin?local=1` (self-hosted) bypasses
  auto-redirect and renders the local method set. It is rate-limited,
  audited, and — once D05's break-glass bindings exist — bound to them;
  until then it is the same local sign-in the instance already has, minus
  the auto-redirect.

### 3. Callback linking — auto-link when unambiguous, admin-confirmed otherwise

On an SSO callback (epic Q5, R8; generalizes
`specs/auth/sso-orphan-user-linking.feature`):

1. `(connectionId, subject)` resolves an identifier → sign in.
2. No subject match, IdP-verified email matches exactly one user, and the
   link is **unambiguous** → auto-link: attach ceremony + audit events
   (before/after). Unambiguous means the email evidence is two-sided — the
   IdP asserts the address verified, and the matched user holds it as a
   VERIFIED identifier (or legacy `emailVerified` pre-latch). An
   **unverified** orphan row is never auto-linked; that is the existing
   "unverified orphan cannot be hijacked" invariant, kept.
3. Ambiguous (multiple candidates, unverified target, or the target holds
   non-corporate identifiers the org cannot vouch for) → `LinkProposed`:
   the sign-in is refused with guidance, and the proposal lands on the
   org-admin surface (D05; until D05 ships, the platform-ops lookup).
   R8's "login is never gated on verification" governs *the user's own
   identifiers*; it does not entitle a callback to claim someone else's
   row.
4. No user match at all → JIT-provision if the connection allows it, else
   deny with guidance (reason code `jit_disabled`).

Every link and every proposal is an identity event — attach ceremonies
through the pipeline, never a hand-written `Account` insert.

### 4. ADR-027 amended: per-method policy replaces path-blocking — semantics intact

ADR-027 gates SSO by blocking route paths in the global `before` hook,
because under `NEXTAUTH_PROVIDER` the provider set is fixed at boot and the
hook was the only point that saw the legacy callback rewrite. Under the
router, *which methods exist at all* is the router's method-set policy —
the natural home for the same rule. What changes is mechanism; every
decided semantic carries over:

| ADR-027 decision | Where it lives now |
|---|---|
| Binary gate: `IS_SAAS \|\| signed instance license \|\| any signed org license`, expiry ignored | Unchanged — `platformSSOAllowed()` stays the one gate module, memoized once per process |
| **Startup semantics** (epic Open Q11 — answered: **keep**) | The router evaluates *policy* per request but reads the *gate* from the same per-process memo; a license change still takes effect on restart, never mid-flight. Per-request policy evaluation with a frozen input is startup semantics — nothing re-decides the license |
| Denied = email mode, exactly | On DENY the method set contains only local methods; SSO methods are absent from every picker and every routing decision — and the **callback paths still refuse** (below), because absence from a picker is not enforcement |
| Gated-path enforcement incl. legacy `/callback/auth0\|okta` | The `before` hook survives as the **enforcement backstop**: the path classification (`ssoPathGate.ts`) and `ssoRouteTableCanary.test.ts` stay, consulting the router's policy instead of raw env. The hook is no longer where the *decision* lives, but it remains where non-UI traffic (direct POSTs, pinned IdP callbacks) is refused. ADR-027's "the hook remains the only correct interception point" holds for enforcement; the router owns decision |
| Email-route block on ALLOW (no-password-account guarantee) | Method-set policy: an SSO-routed org's picker never offers password sign-up; the hook backstop keeps refusing the raw endpoints |
| Credential-mutation block, reset-pair exception on DENY | Unchanged, keyed off the resolved method policy instead of `NEXTAUTH_PROVIDER` |
| Auto-join rides the platform gate | Unchanged; D12's `domainJoin` inherits it (licensed-SSO semantics, `sso-license-gating.feature:182`) |
| Constants table + route-table canary | Carried over. Any route better-auth adds fails the canary by name until classified — same discipline, same test |

`NEXTAUTH_PROVIDER` itself becomes the **self-hosted default method set**
(D03 requirement): existing single-provider deployments keep their exact
behavior — one method, auto-offered — expressed as a one-element method
set rather than a global invariant. Cognito/OneLogin discovery-document
configuration survives as method-set entries
(`sso-oidc-providers.feature` port).

### 5. `SsoConnection` — the aggregate, grandfathering, and the second shadow

D04 as specced (`D04-sso-connection-aggregate.md`), decided here:

- Aggregate `sso_connection` in the identity pipeline, `tenantId =
  organizationId`. Lifecycle DRAFT → CLAIMED → APPROVED →
  VERIFICATION_PENDING → VERIFIED → ACTIVE ⇄ SUSPENDED →
  TEARDOWN_PENDING → TORN_DOWN, guards evaluated against folded state
  (activation needs a verified domain + a live break-glass binding;
  `verifyDomain` refuses a domain another ACTIVE connection owns —
  global on SaaS, per-instance self-hosted; teardown refuses while any
  user holds only that connection's identifiers).
- **Secrets never in events**: `idpMetadata.secretRef` in the projection,
  events carry the reference; the DNS ceremony stores the token's hash.
  Same payload rule as ADR-101 §4.
- **Grandfathering rides `@langwatch/system-migrations`**
  (`identity-d04-connection-grandfather`, org-tenanted): existing
  `ssoDomain`/`ssoProvider` orgs get backfill events producing
  VERIFIED/ACTIVE connections (payloads note `source:
  "legacy-grandfathered"`), idempotency keys `grandfather:<orgId>`. The
  `finalized` proof is a routing comparison: the connection-based decision
  equals the string-based one for every domain the org carries — the same
  comparison `SSOCONN_ROUTING` shadow mode runs fleet-wide, evaluated per
  tenant.
- The router's domain-lookup port flips to the projection behind
  `SSOCONN_ROUTING` (shadow → enforce), after which `ssoDomain` writes
  stop and the columns become derived/legacy. Grandfathered connections
  get their state from history but every *state change* passes the live
  guards — grandfathering never weakens a guard.
- **SAML protocol engine** (epic Open Q1/Q5): deliberately **not decided
  in this spike**. The aggregate is protocol-agnostic (`type: oidc |
  saml`; `idpMetadata` carries either). The engine choice
  (`@better-auth/sso` with its `ssoProvider` table as protocol state only,
  vs genericOAuth-with-SAML) is due at D04 implementation, recorded as a
  revision here — it does not block the aggregate, the grandfathering, or
  the OIDC routing flip, because grandfathered and self-serve OIDC
  connections are the entire Wave 2/3 surface; SAML arrives with D05's
  onboarding.

### 6. D13 — the screens render decisions; three open questions answered

The screen set and routes are D13's spec
(`D13-signin-signup-screens.md`); the contract decided here:

- **Screens contain no routing logic.** Every screen renders a
  `RoutingDecision` (outcome + reason code); deny/guidance copy is keyed
  by reason code in the presentation registry. A screen that needs a new
  behavior needs a new reason code first.
- **Sign-up is verification-first** and the join-before-create
  interstitial is a **hook**: D12 fills matching + content; until then the
  hook renders nothing and sign-up proceeds to workspace creation. The
  hook's contract (verified email in, interstitial decision out) ships
  with D13 so D12 is additive.
- **Epic Open Q9 — answered: password reset follows the identifier, not
  the deployment.** Reset is available to any user holding a password
  identifier, on any deployment mode; the request response is uniform
  whether or not the email exists or holds one. The cloud-mode rejection
  (`password-reset.feature:144-148`) is retired at the D03/D13 flip —
  ADR-027's reset semantics (open on license-DENY, blocked on ALLOW for
  SSO-capable installs) continue to govern *self-hosted SSO* installs
  through the method-set policy.
- **Epic Open Q12 — answered: the no-oracle invariant is scoped to
  sign-in.** Sign-up keeps answering `email_already_registered`
  (`signup-does-not-strand-an-account.feature` anchors stand — that
  refusal is the door back into a half-created account, and losing it
  costs stranded users more than enumeration costs). Sign-in and password
  reset stay oracle-free.
- The failure-message anchors survive: `sign-in-failure-messages.feature`
  (wrong password, rate-limit wait, origin mismatch, honest unknown) binds
  to the new screens unchanged.

### Revision (2026-08-24) — D04 landed; the SAML engine choice moves to D05

The aggregate, its guards, the projection, the grandfather migration and
`SSOCONN_ROUTING` are implemented. Four things §5 said differently:

- **The aggregate rides its own pipeline**, not the identity one. A pipeline
  declares ONE aggregate type and the event store refuses at append any
  event whose type differs from it (#7406); identity's is `user_identity`,
  tenanted by the user, and a connection is neither. The vocabulary stays
  identity's — the events are `lw.identity.connection_*`, the facts live in
  `@langwatch/identity`, the guards in `@langwatch/identity-server`. Only
  the storage partition is separate.
- **Grandfathering states history rather than commanding a change.** One
  command emits the whole lifecycle a legacy organization would have had,
  and it can only CREATE — a connection that already exists gets nothing. So
  "grandfathering never weakens a guard" is structural: no guard has a
  grandfathered branch, and every later state change is the ordinary guarded
  verb. Such a domain's verification method is `legacy-configuration`, which
  no ceremony can request.
- **The break-glass binding is a port, answered weakly until D05.** Bindings
  do not exist yet; activation asks the port anyway, and the interim
  implementation answers whether the deployment still holds a local door at
  all — which refuses exactly the lockout case the requirement exists for.
  D05 makes bindings the port's answer with no guard, command or test
  changing.
- **`ssoDomain` writes stop AT `enforce`, and that refusal ships now.**
  Inert at `off`/`shadow`, so nothing changes on deploy; shipped with the
  flag rather than at the flip so the cutover stays one value in one place.

**The SAML engine choice is NOT made here.** The aggregate is
protocol-agnostic (`type: oidc | saml`, `idpMetadata` carries either) and
nothing in Wave 2 or Wave 3 needs SAML terminated — grandfathered and
self-serve OIDC connections are the whole surface. The choice
(`@better-auth/sso` with its `ssoProvider` table as protocol state, vs
genericOAuth-with-SAML) moves to D05's onboarding, where the first customer
who needs it arrives. It remains this ADR's named debt.

### Revision (2026-08-24) — the screen-level no-oracle is retired

D13's implementation converts both dead ends into the other journey, at the
owner's direction: signing up with an address that already has an account
quietly becomes logging in (no banner), and a password typed for an address
nobody holds becomes a verification-first sign-up. Sign-up already
acknowledged existence under Q12, so the sign-in-side contortion bought
nothing an attacker could not get through the sign-up door. **What still
holds:** the router's decision object stays existence-independent (§1, §2,
bound by `signin-router.feature`), the picker renders identical methods for
any address, and password reset keeps its uniform response.

### 7. One flag, shadow-first, and the cutover

- **`IDENTITY_ROUTER_V2`** covers D03 + D13 together: the router is the
  logic, the screens are the experience; shipping either alone means
  throwaway UI or an invisible engine.
- **Shadow mode** runs the router on every live login and compares its
  decision against the legacy path's actual outcome; mismatches are
  logged with both decisions and the reason code. Screens never render in
  shadow. The exit gate is ADR-110-flavored: **zero unexplained
  mismatches** over the bake window, sign-in success ≥ baseline, funnel
  dashboards live before the flip.
- The flip is the flag; rollback is the flag off — legacy path and legacy
  screens stay intact until bake end, then are deleted.
- `pendingSsoSetup` is reconciled once against identifier data and the
  column dropped at bake end (D03 plan item 5).

## Rationale / Trade-offs

**Decision engine + enforcement backstop over hook-only or router-only.**
Hook-only (ADR-027's shape) cannot express per-org multi-method routing.
Router-only would re-open the exact hole ADR-027 closed: a pinned legacy
callback URL never renders a picker, so UI-level method absence enforces
nothing for direct traffic. Keeping the hook as a thin backstop that reads
the router's policy preserves the one-interception-point property for
enforcement while moving decision where the data is.

**Per-request policy over startup-frozen provider set, without touching
license semantics.** The one-method invariant was load-bearing for ADR-027
("the provider set is fixed at boot"). Multi-method routing makes the
method set per-request data — but the license gate stays a per-process
memo, so the property customers rely on (a license change never flips
behavior mid-flight) is untouched. This is the narrow reading of Open Q11
the epic leaned toward.

**Auto-link two-sided verification over IdP-trust.** Trusting the IdP's
`email_verified` alone would let any connection claim any orphan row on
its domain — the hijack `sso-orphan-user-linking.feature` guards against.
Requiring the target's own verification evidence keeps auto-link safe at
the cost of routing genuinely-orphaned unverified rows through the admin
confirmation queue, which is where a human belongs anyway.

**Reason codes as the spine.** One vocabulary drives routing logs, screen
states, and the ops surface. The alternative — screens branching on ad-hoc
error strings — is exactly what the error-handling doctrine (ADR-045)
exists to prevent, and it would make the shadow comparison unable to say
*why* two paths disagreed.

## Consequences

- One front door for every method ends the one-method-per-deployment
  limit; account-linking dead ends become data (events + proposals)
  instead of support tickets.
- The `before` hook shrinks to enforcement; `ssoPathGate.ts` and the
  canary test survive; ADR-027's constants table gains method-set entries
  but loses no rows.
- D13 ships the complete unauthenticated surface first-party; zero
  Auth0-hosted pages or assets remain reachable at the flip.
- D05's self-service and ops surfaces consume this ADR's contracts
  (reason codes, `LinkProposed`, connection lifecycle) without new
  routing decisions.
- Spec corpus impact is the delivery plan's amendment table; the Wave 2
  spec files land `@unimplemented` with this spike and bind as each PR
  implements them.
- The SAML engine decision is a named debt of this ADR, due at D04
  implementation as a revision.

## References

- Epic: `dev/docs/identity-platform-redesign.md` (R3, R5, R8, Q5;
  Open Q9/Q11/Q12 answered in §6/§4) · Plan:
  `dev/docs/identity-platform/delivery-plan.md` (Wave 2 PR breakdown) ·
  Deliverables: D03, D13, D04
- Specs: `specs/identity/signin-router.feature`,
  `specs/identity/signin-signup-screens.feature`,
  `specs/identity/sso-connection-lifecycle.feature`
  (+ `specs/identity/resilient-invitations.feature` for the Wave 2 D11
  track, which needs no ADR of its own)
- Anchors kept: `specs/auth/sign-in-failure-messages.feature`,
  `specs/auth/signup-does-not-strand-an-account.feature`,
  `specs/licensing/sso-license-gating.feature` (mechanism amended, §4)
