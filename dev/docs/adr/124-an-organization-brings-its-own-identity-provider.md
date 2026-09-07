# ADR-124: An organization brings its own identity provider

**Date:** 2026-08-25

**Status:** Accepted — Wave 3, D09. Closes ADR-117 §5's deferred SAML-engine debt.

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`,
plan `../identity-platform/delivery-plan.md`, deliverable D09.

**Builds on:** ADR-117 (the identifier-first auth screens, the connection
aggregate, and the engine question it deliberately left open), ADR-101 (what a
fact may carry — this is why credentials are references), ADR-110 (a
projection is rebuildable truth, and nothing else may write one), ADR-116 (the
identity storage adapter better-auth runs on), ADR-096 (the Auth0-brokered
provider every existing enterprise customer signs in through), ADR-027 (the
frozen licence gate that decides whether federation is offered at all).

**Number:** 123 is taken by the domain-proof-lifecycle ADR landing in parallel.

## Context

ADR-117 §5 built the whole of an SSO connection — DRAFT through ACTIVE,
domain claims, operator approval, DNS proof, teardown with a grace period —
and named one thing it did not decide: **which engine terminates the
protocol**. It said so explicitly, called it a debt, and deferred it to a
deliverable where a named customer's connection would define the requirement
instead of a guess. D05 then built the surfaces that drive the lifecycle, and
refused SAML by name on both of them for exactly that reason.

The result was a feature that could be configured and could not be used. A
deployment mounts exactly one identity provider, from environment variables
(`NEXTAUTH_PROVIDER`, through `buildGenericOAuthConfigs`), and a connection an
organization registered for itself named a provider the deployment had never
heard of. So `isMethodConfigured` — the router's question "would a sign-in
sent here arrive anywhere" — compared the connection's provider against the
one env-mounted method and answered no, forever. Every self-serve connection
routed to `method_not_configured`. The aggregate's `clientIdRef`, `secretRef`
and `certRefs` were written `null` at every call site, because there was
nothing behind a reference to point at.

Meanwhile the thing customers actually ask for is SAML, and the way we have
been giving it to them is a support engineer configuring an Auth0 application
by hand, per customer, and a deploy.

Three ways to close it were considered.

**BoxyHQ Jackson**, a dedicated SAML/OIDC federation service. It is good at
what it does and it is a second process, a second datastore, a second thing to
deploy, monitor, upgrade and reason about during an incident — and a second
place where "who is this person" is decided, next to the identity pipeline
ADR-101 built precisely so that question has one answer. Self-hosted customers
would inherit the sidecar too.

**Write it ourselves.** SAML assertion validation is a category of code where
being 95% right is a vulnerability rather than a bug. Signature wrapping,
canonicalization, clock skew, encrypted assertions, algorithm allow-lists: all
of it is well-trodden and none of it is our product.

**better-auth's single sign-on plugin.** We already run better-auth, on our own
storage adapter (ADR-116), with genericOAuth, two-factor and passkey plugins
mounted. At 1.7.1 — the release the app is already pinned to and tested
against — `@better-auth/sso` terminates OpenID Connect *and* SAML, the latter
through samlify, with per-provider ACS, SP metadata and single-logout
endpoints, a provider table keyed per registration, and algorithm allow-lists
and clock-skew validation already written. It is one dependency in a stack we
already operate, and it adds no process.

We chose the plugin. What follows is everything that decision does NOT get to
change.

## Decision

### 1. `@better-auth/sso` is the engine, mounted beside genericOAuth

The plugin registers unconditionally in the same better-auth instance as
`genericOAuth`, `twoFactor` and `passkey`. Registering it mounts routes that
answer for providers in a table; with no rows, `/sso/*` answers "no such
provider" and nothing about anybody's sign-in changes.

**Coexistence is a requirement, not a transition.** Existing enterprise
customers sign in through the env-mounted provider — Auth0, including
SAML-through-Auth0 with `samlp|`-prefixed subjects (ADR-096) — and that path
keeps its routes, its accounts, its hooks and its behavior indefinitely. The
two engines run side by side for as long as anybody uses either.

```
                          one better-auth instance
   ┌──────────────────────────────────────────────────────────────────┐
   │                                                                  │
   │   genericOAuth plugin                 @better-auth/sso plugin     │
   │   ────────────────────                ───────────────────────     │
   │   ONE provider, from env              MANY providers, one per     │
   │   NEXTAUTH_PROVIDER=auth0             registered connection       │
   │                                                                  │
   │   /callback/auth0                     /sso/callback/:connection   │
   │                                       /sso/saml2/sp/acs/:conn     │
   │                                       /sso/saml2/sp/slo/:conn     │
   │                                       /sso/saml2/sp/metadata      │
   └──────────────────────────────────────────────────────────────────┘
              ▲                                       ▲
              │                                       │
   ┌──────────┴───────────────────────────────────────┴──────────────┐
   │  isMethodConfigured({ methodId, connectionId, organizationId })  │
   │                                                                  │
   │    mountedMethodId() === methodId   ──── yes ──▶  CONFIGURED     │
   │              │                                    (engine never   │
   │              no                                    consulted)     │
   │              ▼                                                    │
   │    engineHoldsProvider({ connectionId })  ─ yes ─▶  CONFIGURED   │
   │              │                                                    │
   │              no ──▶ NOT CONFIGURED ──▶ method_not_configured      │
   └──────────────────────────────────────────────────────────────────┘
```

The order carries a promise. A connection naming the mounted provider is
configured **without the engine's table being read at all**, so a deployment
that has never registered anything per-organization answers exactly what it
answered before D09, and does it without a database round trip on the sign-in
path. `ssoMethodIsConfiguredWith` in
`platform/app/src/server/app-layer/identity/sso-method-configured.ts` is that
seam, and it is a module with a name rather than a closure in the composition
root because what it decides is the difference between an enterprise customer
signing in and being handed a password form.

The plugin's `providerId` column is the **connection id**, not the name the
customer typed. That column is globally unique, and two organizations both
calling their provider `okta` must both be able to.

### 2. The engine's provider table is a projection of the connection ledger

The `SsoConnection` aggregate's events remain the only source of truth. The
plugin's `SsoProvider` row is derived — folded from the same events, in the
same apply, by the same projection that writes the connection head. **No
mutation, route or service writes it.**

```
   command                       ledger                    projections
   ───────                       ──────                    ───────────

   registerConnection ──┐
   claimDomain          │
   verifyDomain         ├──▶  connection_registered  ──┐
   activateConnection   │     domain_verified          │
   suspendConnection    │     connection_activated     │
   requestTeardown    ──┘     connection_suspended  ───┤
                              …                        │
                                                       ▼
                                        ┌──────────────────────────┐
                                        │ SsoConnectionState fold  │
                                        │ (@langwatch/identity)    │
                                        └────────────┬─────────────┘
                                                     │
                             ┌───────────────────────┴──────────────┐
                             ▼                                      ▼
                   ┌──────────────────┐              ┌──────────────────────┐
                   │  SsoConnection   │              │     SsoProvider      │
                   │  (the head)      │              │  (what the engine    │
                   │                  │              │   dials from)        │
                   └──────────────────┘              └──────────┬───────────┘
                                                                │ reads by ref
                                                                ▼
                                                     ┌──────────────────────┐
                                                     │    SsoCredential     │
                                                     │  AES-256-GCM under   │
                                                     │  CREDENTIALS_SECRET  │
                                                     └──────────────────────┘
```

The derivation, `engineProviderFor`, is a pure function of the folded state
and the vault. It writes a row when the connection is dialable and **deletes**
it otherwise — SUSPENDED, DISCARDED and TORN_DOWN all remove it, because a
paused connection the engine can still find is a connection it will still
authenticate through. A registration carrying no credential references (a
grandfathered connection, or one an operator registered ahead of the
conversation) projects no row, and the router reads "not configured", which is
exactly true.

Replay rebuilds both tables together. Nothing has to be reconciled, because
there is nothing to reconcile: the engine's table has no state of its own.

Two things this deliberately keeps OUT of the fold, because a projection must
rebuild identically on every replay: reaching an issuer over the network, and
parsing what somebody pasted. Both happen at command time, where a refusal can
reach the person who typed it. The row stores a `discoveryEndpoint` and lets
the engine discover at sign-in.

### 3. Credential values live in an encrypted store; events carry only references

ADR-101 §4 has always forbidden a secret in a fact, which is why the aggregate
carries `clientIdRef` / `secretRef` / `certRefs`. D09 builds the other end:
`SsoCredential`, encrypted with `~/utils/encryption` — AES-256-GCM under the
deployment's `CREDENTIALS_SECRET`, the same key every other credential in the
product is kept under, not a scheme of its own.

Issuing a reference is part of the command flow, so the history says **when**
credentials changed and never **what** they were. A rotation mints a new
reference in a new fact rather than updating a row in place. A credential that
will not decrypt — written under a secret since rotated — reads back as absent,
so the connection stops being dialable rather than the projection stopping.

### 4. Rollout is a per-organization feature flag

D04 staged the routing flip on `SSOCONN_ROUTING`, an environment variable,
which is a fleet-wide answer to a per-customer question. Routing enforcement
now sits behind `sso_connection_routing`, a per-organization flag defaulting
to **off**.

With it off — every organization, on a fresh deploy — the legacy
`Organization.ssoDomain` / `ssoProvider` columns answer exactly as they did
before, and the projection read is a wasted query rather than a behavior
change. The first customer to route off its own connection does so without any
other organization moving, and rolling that customer back is turning one flag
off.

`SSOCONN_ROUTING` is **not** retired, because it never only meant routing:
`legacy-sso-string-writes.ts` reads it to decide when string writes stop, which
is a separate retirement on a separate clock. What it no longer does is decide
who reads what.

### 5. The customer is shown our side before being asked for theirs

An administrator cannot configure their identity provider from a form that only
asks them questions. `getSetup` answers LangWatch's service-provider details —
redirect address, assertion address, entity id, published metadata — derived
from the deployment's address and the plugin's mount points rather than
configured, and the setup page renders them **above** the fields to fill in.

`getSetup` stays readable on any plan so the screen can say what single sign-on
would take; the mutations take an Enterprise plan (`ENTERPRISE_FEATURE_ERRORS.SSO`),
mirroring `scimToken.ts`. Granting and renewing a break-glass binding is
deliberately **not** plan-gated: locking an administrator out of granting a way
back in because a subscription lapsed is the exact failure break-glass exists
to prevent.

### 6. A future Auth0 → direct cutover links by verified address

When an organization moves off the brokered provider onto a connection it
registered itself, the identity provider's subject changes — Auth0 brokered
`samlp|...`, the provider asserts its own native subject — so the new account
can only find the existing person by **address**.

The plugin is configured `trustEmailVerified: true`. better-auth links an
incoming account to an existing user when the provider reports the address
verified and the local account's own address is verified; without this the
plugin reports every address as unverified and every cutover would mint a
fresh duplicate for everybody. Trusting the assertion is warranted here in a
way it would not be for a public provider: the domain is DNS-proved before the
connection may route, and the assertion comes from the identity provider that
domain named. The local half of the check is untouched — better-auth still
refuses to link into a LangWatch account whose own address was never verified.

**Residual:** an identity provider that asserts no `email_verified` claim will
not link, and its users will be offered a fresh account. `trustedProviders` as
a function would close that, at the cost of a database read on every auth
request — which is the availability failure ADR-027's `isGateDependentPath`
exists to avoid. Deferred, and named here so the next person meets it as a
decision rather than a surprise.

### 7. One connection per organization

The self-serve surface registers one connection per organization and refuses a
second with `sso_connection_already_registered`. This has always been the
documented journey; D09 makes it load-bearing, because the domain-claim rate
limit counts a **connection's** own claims. Five domain claims an hour is a
rate limit only while an organization has one connection to spend them from;
an unbounded register would make it five an hour per registration and turn
registration into the enumeration rail. Read from the projection rather than a
counter, so a discarded or torn-down connection correctly stops being one.

## Consequences

**Good.**

- Enterprise SSO becomes self-serve for both protocols. The engine question
  ADR-117 §5 left open is closed, and closed inside the stack we already
  operate: no sidecar, no second datastore, no second answer to "who is this".
- Existing customers are untouched by construction, not by care. The env
  provider path is checked first and the flag defaults off, so a deploy
  changes nothing on its own — the same shape every other in-place migration
  in this program has.
- The engine's table is rebuildable. There is no drift to detect between what
  the ledger says a connection is and what the engine will dial, because the
  second is a function of the first.
- Credential references stop being decorative. The aggregate's payload rule
  now describes something that exists.

**Costs and risks.**

- The plugin's `oidcConfig` / `samlConfig` columns hold the dialing
  configuration in cleartext, including the client secret, because the plugin
  reads them synchronously at sign-in and offers no hook to decrypt at that
  seam. The vault is what the aggregate points at and what survives a replay;
  the projected copy is a second at-rest location for the same material, and
  it is Postgres-encryption's problem rather than the application's. Worth
  revisiting if the plugin grows a field-transform hook.
- We are pinned to `@better-auth/sso@1.7.1` inside the `minimumReleaseAge`
  gate, alongside the rest of the better-auth family. The exclusion is version
  pinned and should be dropped as each ages out.
- `trustEmailVerified` widens what we accept from an identity provider. The
  local verified-address requirement is what keeps it safe, and it is the
  plugin's own sanctioned switch, not a fork.
- An operator registering a connection through the back office still cannot
  supply credentials, so a tier-1 connection is not dialable until an
  administrator finishes it in Settings. That is honest rather than hidden —
  the router reads "not configured" — but it is a gap in the ops-assisted
  journey and the obvious next slice.

## Amendment (wave 3): going live without an operator

This ADR made a sign-in ARRIVE. What it did not do is let a customer finish:
the last three steps of a rollout — prove the connection carries a real
person, name somebody who can still get in without it, turn it on — existed
only in the back office, so every go-live was a LangWatch operator's
afternoon. See `specs/identity/sso-activation.feature`.

Three decisions, and the first is the load-bearing one.

**A test sign-in is evidence, not a record.** The guard has always demanded a
`testLoginAccountId`, and the obvious way to satisfy it self-serve would be a
`record_test_login` command. There is none, deliberately. A sign-in through
the connection leaves an account behind — the engine writes one, keyed by the
connection's own id — so the account IS the evidence. The setup screen reads
the account store to answer "has this been done", and `activate` carries the
id of an account that exists onto the fact. Two consequences follow: a
customer cannot tick the box by pressing a button, only by signing in; and
there is no second place for the truth about a test sign-in to live and drift.
What rides on the fact is the account ROW's id rather than the subject the
identity provider asserted — both name the same sign-in, only one is ours, and
copying a provider's subject onto an organization-level aggregate would put a
person's identifier in the one aggregate that carries none.

**The test names the connection; it does not wait for routing.** A test
sign-in goes to `/sign-in/sso` with the connection id, so it works while
`sso_connection_routing` is still off for the organization. That ordering is
the point: proving the connection must be possible before anything about
anybody's sign-in changes, or the only way to find out whether it works would
be to make everyone depend on it first.

**Activation refuses one precondition at a time.** The guard's
`sso_connection_activation_blocked` stays exactly as it is — it is right for
an operator who commanded an activation directly, and it holds for every
caller the aggregate will ever have. On top of it the self-serve service
checks the same three first and refuses by name:
`sso_activation_domain_unproved`, `sso_activation_test_sign_in_missing`,
`sso_activation_break_glass_missing`. Two refusals for one rule is unusual and
justified here: the surface's exists to be ACTED on, the guard's exists to be
true, and deleting either costs one of those. The screen shows all three at
once, because a person planning an afternoon needs to see what the afternoon
contains.

Two boundaries this amendment does not move. **Break glass is never
plan-gated** — registering a provider and going live take an Enterprise plan,
granting and renewing a way back in take neither, because a lapsed
subscription must never be the reason an organization cannot reach its own
recovery path. And **suspending stays ours**: the customer's surface has no
verb for it, since the lever for a failing identity provider must not sit
behind that identity provider.

## Deployment Impact

- **Migration:** `20260831120014_sso_idp_termination` adds two tables,
  `SsoCredential` and `SsoProvider`. Both are empty on deploy; nothing
  backfills them, and the connection projection populates `SsoProvider` as
  connections are registered or replayed. Additive only — no column is
  altered or dropped, so a rollback is a code rollback.
- **Plugin mount:** `@better-auth/sso` registers unconditionally. It mounts
  `/api/auth/sso/*` routes which answer "no such provider" until a row exists.
  No existing route changes.
- **Flag default:** `sso_connection_routing` defaults **off** for every
  organization. Turn it on for one customer with a targeting rule at
  `/ops/feature-flags`, or fleet-wide with `SSO_CONNECTION_ROUTING=1`. Off is
  identical to today's behavior.
- **Environment:** no new variables. The credential store uses the existing
  `CREDENTIALS_SECRET` (falling back to `NEXTAUTH_SECRET`), and the service
  provider's addresses derive from `NEXTAUTH_URL`. A deployment with neither
  secret set cannot store a credential, and registration fails loudly at the
  first attempt rather than silently storing cleartext.
- **`SSOCONN_ROUTING`** keeps its `off` default and its remaining meaning
  (when legacy string writes stop). `enforce` still forces the projection for
  a whole installation, which is the self-hosted lever.
- **Wave 3 adds no migration and no environment variable.** The activation
  journey reads tables that already exist (`Account`, `OrganizationUser`,
  `SsoBreakGlassBinding`) and writes only through the connection ledger. The
  new tRPC verbs are `ssoSetup.activate` and `ssoSetup.breakGlassCandidates`;
  `ssoSetup.breakGlassBindings` now answers holders by name rather than by id.
