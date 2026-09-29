# ADR-143: A one-time Auth0 password export moves database-connection passwords home, decoupled from the SSO exit gate

**Date:** 2026-09-29

**Status:** Proposed

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`,
plan `../identity-platform/delivery-plan.md`. Amends the dependency this ADR's
decision cuts: `../identity-platform/D09-auth0-customer-migrations.md` and
`../identity-platform/D10-auth0-deletion.md`.

**Builds on:** [ADR-096](096-saml-logins-count-as-verified-emails.md) (the
Auth0-brokered provider every existing customer signs in through, today —
both cohorts this ADR distinguishes), [ADR-116](116-account-linkage-is-event-truth.md)
(the storage adapter's two branches — `Account` as the retiring bridge,
`AccountCredential` as row-truth for secrets), [ADR-117](117-identifier-first-front-door.md)
§4 (the method-set policy a deployment resolves per identifier), [ADR-124](124-an-organization-brings-its-own-identity-provider.md)
(D09's actual subject: the enterprise SSO broker, and why it moves customer by
customer), [ADR-129] (`CredentialAccountService`, referenced from
`credential-account.service.ts` — not yet filed in the ADR index at time of
writing; cited here as the existing service this decision extends, not
rewrites).

## Context

One Auth0 tenant currently serves two populations that have nothing to do with
each other except sharing a vendor bill.

**Enterprise SSO customers** arrive through the Auth0 broker as a federated
identity — `Account.providerId = "auth0"`, `providerAccountId` prefixed
`waad|`, `samlp|`, or another upstream connection name
(`platform/app/ee/sso/legacy-sso-dial.ts`). D09 moves these customers, one
tenant at a time, onto a direct OIDC or SAML `SsoConnection` they configure
themselves, with both-connections-active grace as the rollback. It is
deliberately slow — "customer-paced, no fleet deadline" — because ending an
enterprise's SSO route without their own new IdP configured and proven locks
every one of their users out at once. As of this ADR, zero customers have
migrated.

**Individual email+password users** arrive through Auth0's own database
connection — the *same* `providerId = "auth0"`, but `providerAccountId`
prefixed `auth0|` (`isAuth0DatabaseAccount` in
`federated-password.service.ts` / `CredentialAccountRecordsPort.findFederatedPasswordAccountId`
is the whole of that distinction today). Nothing about this cohort is
federated in the sense D09 cares about — there is no customer-owned upstream
IdP to wait for, no enterprise organization deciding when to cut over, no
`SsoConnection` at all. Auth0 is, for this cohort, purely a password store
LangWatch itself chose, and every read of it — verifying the current password
before a change (`verifyCurrentPassword`, a Resource Owner Password Grant
against the Management M2M client) and writing a new one
(`updateUserPassword`, a Management API `PATCH /users/:id`) — is a live HTTP
round trip from `src/server/auth0/passwordService.ts` on every settings
password change. (Primary sign-in for this cohort is a separate question,
addressed under Decision §3 below — today it redirects to Auth0's hosted
Universal Login and never reaches `passwordService.ts` at all.)

`D09-auth0-customer-migrations.md`'s dependency table nonetheless routes
`passwordService.ts`'s retirement through **D10**, and D10 depends on "D09
program exit: **zero ACTIVE legacy [SSO] connections**." That coupling made
sense when it was written: nobody held the raw material to treat the two
cohorts differently, so bundling "Auth0 dies" into one customer-paced program
was the only available shape, and riding the slowest constraint was safe by
construction — the password broker calls are cheap and unremarkable, so
leaving them running for however long the SSO migration takes cost nothing.

That premise no longer holds. Auth0 has supplied LangWatch's own export of the
database connection's password hashes — the actual material `passwordService.ts`
has been proxying requests to and from since this cohort existed. Holding the
one population hostage to the other's migration pace is no longer a fact about
the material; it is now only a fact about a delivery-plan table that was
written before the material existed.

## Decision

### 1. Import through the app's own credential writes, not the table

Passwords are no longer one table. ADR-116's split has landed behind a
per-user latch: once the identity backfill finalizes a user, better-auth and
account settings read that user's accounts from the `Identifier` projection
(folded from identity events) joined to `AccountCredential`, and treat an
empty answer as final; `Account` is only a bridge row kept in step. For a
user not yet finalized, `Account` is still the truth, and the backfill states
their identifiers as events and carries their secrets across when it
finalizes them. A raw `Account` write therefore reaches only the second group,
and for the first it writes a hash no sign-in ever reads.

So the import writes through `CredentialAccountService.importPasswordHash`,
which goes through the same gate-aware records
(`CredentialAccountStorageAdapter`) as `setFirstPassword`. For a latched user
that states the `credential` identifier as an event and stores the hash in
`AccountCredential` (mirrored onto the bridge); for anyone else it writes the
legacy row the backfill adopts. Hashes never enter an event, and the identity
fold writes only linkage columns and removes only detached rows, so replaying
the log can neither lose nor resurrect an imported password.

Each record is matched by its Auth0 `user_id` against the
`Account(provider: "auth0", providerAccountId: user_id)` row (which the fold
keeps as the bridge for latched users too), not by email. A passkey sign-up's
NULL-password placeholder is filled in place rather than duplicated; a user
whose credential already holds a password is skipped. The hash is stored
verbatim, never rehashed, and no session is ended, because it is the password
the person already uses.

**Per-row algorithm is not assumed uniform.** Auth0's bulk export carries
either a `password_hash` field (bcrypt, `$2a$`/`$2b$`, native database-connection
signups) or a `custom_password_hash` object naming one of eleven algorithms
(argon2, bcrypt, hmac, ldap, md4, md5, sha1, sha256, sha512, pbkdf2, scrypt) —
Auth0's own accommodation for tenants that migrated a population *into* Auth0
from somewhere else before LangWatch's tenant existed. `PasswordHasherPort.matches`
and better-auth's `password.verify` both assume bcrypt — that is what
`hash(password, PASSWORD_HASH_ROUNDS)` / `compare(password, storedHash)`
(`config/email-and-password.ts`) mean. **The import script must read each
record's algorithm and only write bcrypt rows (`password_hash`, or
`custom_password_hash.algorithm === "bcrypt"`) into the columns above.**
Every other algorithm is a residual: excluded from this cutover, logged with a
count (never the hash value), and left on the live Auth0 fallback in §2 —
sized before landing, because a crypto bug hidden behind a bcrypt assumption
would surface only as customers told their correct password is wrong. If that residual is
large enough to matter, it is a follow-up (rehash-on-next-successful-login
against Auth0 while it is still live, or a second export request with
`algorithm=bcrypt` forced at Auth0's end) rather than a blocker to this ADR —
the bcrypt-covered majority still moves.

**bcrypt compatibility needs no rehash.** `PASSWORD_HASH_ROUNDS = 10`
(`app-layer/identity/runtime.ts`) already matches Auth0's own default bcrypt
cost (10 salt rounds), but that agreement is incidental, not load-bearing:
`bcrypt.compare()` reads its cost from the hash string itself, so any bcrypt
hash Auth0 exports — cost 10 or otherwise — verifies correctly against a
freshly typed password with no transformation at import time. The import
copies the `$2a$`/`$2b$` string verbatim.

**The export never leaves the operator's machine.** The import is a script an
operator runs locally against the target
(`platform/app/scripts/ops/import-auth0-password-hashes.ts`), not a deployed
task. It is dry-run by default and reads Postgres only; an apply boots the
app's event stack in the one-shot `migration` role, which folds only the
identity events it staged, and needs the target's Postgres, Redis, ClickHouse
and `ENVIRONMENT` together. It is audited by counts and a residual list of
Auth0 user ids, never by anything that could reconstruct a hash.

### 2. `LOCAL_PASSWORDS_ENABLED` mounts the door D09 already designed for this

`deploymentIssuesOwnPasswords` / `LOCAL_PASSWORDS_ENABLED` already exists,
already described as "a deployment that opts into issuing its own passwords
*beside* its provider" (`email-and-password.ts`, citing D09). Turning it on
for the SaaS deployment is not new mechanism — it mounts
`/sign-in/email`/`/sign-up/email` and the credential form
(`localSignInMethods()` in `signin-method-policy.ts`) alongside the still-live
Auth0 broker, exactly the mixed mode `refusesCredentialRoute` and the
existing `change-password-auth0.feature` scenario ("A change targets the
password the person actually signs in with") already anticipate.

The reason this previously offered nothing for the `auth0|...` cohort is not
that the door was shut — it is that turning the door on finds no lock to open
for a user who holds no local credential row at all. §1's import is what
supplies the row; §2 is what makes it reachable.

### 3. Sign-in itself moves local for an imported account; the broker stays live for everyone else

Today, `auth0|...` accounts sign in by redirecting to Auth0's hosted
Universal Login (`genericOAuth`) — Auth0 checks the password on its own end,
and LangWatch's backend never sees it. That redirect is a *different*
consumer of "is this account's password at Auth0 or at LangWatch" than
`passwordService.ts` is, and this ADR moves it too: once an account holds an
imported (or newly-changed, post-import) local credential row, its resolved
sign-in method should offer and default to the password door (§2), not the
Auth0 redirect. This is the same "which password a change targets is decided
by where the password *lives*, not by what the deployment federates with"
principle the settings spec already states for password *change*
(`change-password-auth0.feature`, the `@unit` scenario at the bottom); this
ADR extends it to sign-in itself, which the existing `SignInMethodPolicy`
machinery (ADR-117 §4) resolves per identifier already — the technical plan
names the specific predicate to add rather than asserting one exists today.

An account the import did not cover (created after the export was taken, or
landed in §1's algorithm residual) keeps redirecting to Auth0 exactly as
today. Nothing about this ADR requires every account to move before any of
them can.

### 4. `passwordService.ts` stays mounted as the fallback, not deleted, by this ADR

It still answers for: any residual account from §1, any account created
between the export and go-live, and change-password for an account whose
local row does not yet exist. It is not called on the golden path for a
covered account. Its deletion is **D10's** job, gated the way §5 restates —
not this ADR's, which lands the reduction in live traffic that makes deleting
it later low-risk instead of writing the deletion itself.

### 5. Out of scope, explicitly: the SSO broker

`waad|...`, `samlp|...`, and every other non-`auth0|` upstream prefix are
untouched. Enterprise customers continue signing in through the Auth0 broker
exactly as today; D09's per-tenant migration wizard, grace period, and
callback shim (R9) proceed on their own pace, unaffected by this ADR in
either direction. This ADR does not accelerate D09 and does not require it to
finish.

## Amendment this ADR makes to D09/D10

The recorded dependency — "`passwordService.ts` retires at D10, which needs
D09 program exit" — bundled two unrelated cohorts under one Auth0-tenant
label. This ADR splits them:

- **`D09-auth0-customer-migrations.md`**, "What Auth0 is today" table: the
  `src/server/auth0/passwordService.ts` row's scope narrows to the SSO
  broker's own password-adjacent surface (there is none — SSO carries no
  password at all), and a note is added that the row, as originally written,
  conflated the two cohorts; this ADR is the correction.
- **`D10-auth0-deletion.md`**: `passwordService.ts` deletion no longer needs
  "D09 program exit." Its new exit gate is this ADR's own: §1's import
  coverage report (every non-residual `auth0|...` account holds a local row)
  plus a sustained observation window of zero live calls into
  `passwordService.ts` from a covered account — the same shape as R9's
  shim-hit metric, applied to the password broker instead of the SSO
  callback. Full file deletion still waits on the SSO broker's `waad|`/`samlp|`
  traffic separately, since the file's `AUTH0_DB_CONNECTION` constant and its
  Management API plumbing are also reachable in principle from a support
  action against a not-yet-migrated SSO tenant; whether that reachability is
  real or theoretical is this ADR's one open question, not a settled fact — see
  below.
- **`delivery-plan.md`**: the Wave 4 table's D10 "Needs" column and the
  deliverable-gates table's D10 row both currently read "D09 program exit:
  zero ACTIVE legacy connections" as a single undifferentiated gate. Split it:
  the password-service portion of D10 depends on this ADR's own metric; the
  provider-config/webhook/shim/secrets portion still depends on D09 program
  exit exactly as written.

These edits land in the same change as this ADR, not as a follow-up — the
record does not go stale between the decision and its consequence for the
Wave 4 plan.

## Consequences

**Positive.** The password broker's live traffic drops to the residual +
not-yet-imported edge on day one, ahead of any enterprise customer's SSO
decision. Settings password-change and (for a covered account) sign-in stop
depending on Auth0's availability and rate limits. Auth0 spend does not drop
(D10 still cancels it, still gated on the SSO program), but the blast radius
of an Auth0 incident does, immediately.

**Negative / accepted risk.** Two credential stores answer "is this the
current password" for the observation window between import and
`passwordService.ts`'s eventual deletion: a covered account's local row and
Auth0's own record can drift if something writes to Auth0 directly outside
this path (support tooling, a customer using an Auth0-side reset the export
predates). Nothing in this ADR's scope does that; it is named here so a
future incident review does not have to rediscover the possibility. The
algorithm residual (§1) is a real, sized-but-not-yet-known population that
keeps depending on live Auth0 calls indefinitely unless a follow-up shrinks
it — acceptable because it is strictly a subset of today's behavior, not a
new failure mode.

**Neutral.** `AUTH0_*` secrets, the Auth0 provider mount, and the SSO broker
itself are unaffected — this ADR spends nothing from that budget and removes
nothing D09/D10 still needs.

## Open Question

Does any support/ops action reach `passwordService.ts`'s Management API
functions (`updateUserPassword`, `getManagementApiToken`) on behalf of an
`auth0|...` OR a `waad|`/`samlp|` identity through a shared code path, such
that "zero calls from a covered account" (this ADR's gate) and "zero calls
full stop" (D10's eventual gate) could diverge in a way that matters
operationally? A grep of current callers suggests no — `changeFederatedPassword`
is reached only through `CredentialAccountService`, itself reached only from
the `user.changePassword` router, itself reached only by an authenticated
user acting on their own account — but this ADR does not assert that as
settled without whoever owns the D10 exit-gate review confirming it.

## References

- `platform/app/scripts/ops/import-auth0-password-hashes.ts` — §1's import,
  run locally by an operator against prod, never as a deployed task.
  Dry-run by default; filters to bcrypt rows per §1's algorithm residual;
  writes through `CredentialAccountService.importPasswordHash`.
- `specs/identity/auth0-password-import.feature` — the import's behaviour.
- `dev/docs/identity-platform/D09-auth0-customer-migrations.md`,
  `D10-auth0-deletion.md`, `delivery-plan.md` — amended alongside this ADR.
- `specs/settings/change-password-auth0.feature` — the existing behavioral
  contract this ADR extends to sign-in; a sign-in-routing scenario belongs
  beside it once §3 lands in code.
- `platform/app/src/server/auth0/passwordService.ts`,
  `app-layer/identity/credential-account.service.ts`,
  `better-auth/config/email-and-password.ts`,
  `app-layer/identity/signin-method-policy.ts` — the code this decision
  extends.
- Auth0 bulk user import/export schema (`password_hash` / `custom_password_hash`,
  eleven supported algorithms, PHC-format requirement for argon2/pbkdf2) —
  external reference for §1's algorithm-residual handling, current as of this
  ADR's date.
