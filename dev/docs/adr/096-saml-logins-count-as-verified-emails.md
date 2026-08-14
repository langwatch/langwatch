# ADR-096: SAML logins through Auth0 count as verified emails

**Date:** 2026-08-14

**Status:** Accepted

**Tracking:** internal issue (langwatch-saas#1053)

> One-line: when an Auth0 profile's `sub` starts with **`samlp|`**, `mapProfileToUser` returns **`emailVerified: true`**, because the email was **asserted by the organization's own identity provider** — restoring account linking for existing users, and nothing else changes.

## Context

Enterprise SAML sign-in runs customer IdP → Auth0 (SAML connection) → LangWatch
(OIDC via BetterAuth's genericOAuth plugin, ADR-027 gate in front). Auth0
sets `email_verified: false` for every SAML connection user and offers no
per-connection switch to change it — SAML is the only enterprise connection
type without one.

BetterAuth 1.6.23 refuses to link an OAuth sign-in to an existing user when
the incoming profile's email is unverified
(`dist/oauth2/link-account.mjs`: `!isTrustedProvider && !userInfo.emailVerified`),
and our config declares no `trustedProviders`
(`platform/app/src/server/better-auth/index.ts:270`). Net effect: any
existing user whose organization switches to SAML SSO is locked out on
their first SAML login. New users are unaffected (fresh `User` row, no
linking step).

The escape hatch is also in BetterAuth: the genericOAuth plugin builds the
final profile as `{...userInfo, ...mapProfileToUser(profile)}`
(`dist/plugins/generic-oauth/routes.mjs:~209`), so a `mapProfileToUser`
return value can override the claim-derived `emailVerified`.

Forces and constraints (locked 2026-08-14):

- **Forcing function:** an enterprise customer's SSO go-live; their
  existing users are locked out until this ships.
- **Blast radius: high — security boundary.** Mis-scoped trust in
  `emailVerified` is an account-takeover vector via linking.
- **Hard constraints:** override scoped strictly to the `samlp|` sub
  prefix; no schema or config changes; one PR; no customer names anywhere
  in this public repo.

## Decision

1. **Trust the IdP's email assertion for SAML connections only, keyed on
   the `sub` prefix.** Auth0 encodes the connection strategy in `sub` as
   `{strategy}|{connection}|{id}`; SAML users arrive as `samlp|…`. A SAML
   connection exists only because a LangWatch operator created it in the
   Auth0 tenant and pointed it at one organization's IdP — there is no
   self-signup path into a `samlp|` identity. The email in that profile was
   asserted by the customer's own IdP, which is exactly the authority an
   email verification loop would consult anyway. Rejects: trusting all of
   Auth0 (see Rejected alternatives).

2. **Implement as an exported named helper plus a spread in
   `mapProfileToUser`** (`platform/app/ee/sso/providers.ts`, auth0 branch):
   `isSamlSub(sub)` → `typeof sub === "string" && sub.startsWith("samlp|")`,
   and `...(isSamlSub(profile.sub) ? { emailVerified: true } : {})`.
   Exported for direct unit testing, matching the file's convention
   (`fallbackName`, `parseIssuerUrl`). Non-SAML profiles get no
   `emailVerified` key at all, so the claim-derived value flows through
   untouched.

3. **One-off, not a shared capability.** n=1. If Okta or plain-OIDC ever
   need equivalent trust, that second occurrence is when a shared shape is
   considered.

## Constants

| Name | Value | Purpose |
|---|---|---|
| SAML sub prefix | `"samlp\|"` (6 chars, trailing pipe included) | The only strategy prefix granted the override; trailing pipe prevents matching a hypothetical `samlpx` strategy |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| Only `samlp\|` subs are upgraded | `auth0\|…`, `google-oauth2\|…`, `waad\|…`, absent/non-string subs never gain `emailVerified: true` | `isSamlSub` unit cases + mapped-profile assertion in `ee/sso/__tests__` |
| Non-SAML profiles are untouched | The mapped object contains no `emailVerified` key for non-SAML subs (claim value flows through) | assertion `"emailVerified" not in mapped` |
| SAML profiles map to `emailVerified: true` | Linking gate passes for SAML sign-ins | assertion on mapped object |
| Rest of the mapping unchanged | name/email/image behavior identical to before | existing `fallbackName` tests keep passing |

## Assumptions

| Assumption | What breaks if false |
|---|---|
| Auth0 SAML subs always start `samlp\|` | Fix silently doesn't fire; user stays locked out — incomplete, not wrong. Verified against Auth0 docs; first real sign-in (debug logs are on) confirms on our tenant |
| No tenant-side self-signup path yields a `samlp\|` sub | Account takeover via linking. Holds tenant-side: Auth0 database signups mint `auth0\|` subs, and only operator-created SAML connections mint `samlp\|`. IdP-side self-registration (an open-registration IdP behind a SAML connection) is NOT excluded by construction — that risk is the load-bearing assumption below |
| Every SAML connection in the tenant maps `email` from an IdP-controlled attribute | **This is the load-bearing assumption (red-team, v2).** `samlp\|` proves *authenticated via SAML*, not *owns this email*. If any SAML connection in the configured Auth0 tenant sources email from a user-editable attribute or an open-registration IdP, an attacker can assert a victim's email and link into their existing account — the exact link today's code refuses. The domain guard does not stop it: existing users are soft-flagged, only first-time signups hard-block (`hooks.ts`). Holds when the operator creates connections deliberately against trusted corporate IdPs — the same trust class as the tenant's client secret |
| `mapProfileToUser` return overrides the claim | Fix is a no-op. Verified by reading BetterAuth 1.6.23 source (`routes.mjs:~209`) — pinned-version fact, re-check on BetterAuth upgrades |

## Gates

| Path | Reversible? | Blast radius | Gate |
|---|---|---|---|
| SAML sign-in links to existing user | Code-revert yes; a wrong link made in the window is not | High (auth boundary) | Human review of the PR + invariant unit tests + first real sign-in verified against Auth0 debug logs before announcing |
| Fresh SAML user created with `emailVerified: true` | Yes (flag flip in DB) | Small — skips a verification email for users their own IdP already vouched for | none |

## Schema

None. No migrations, no env vars, no config keys.

## Rejected alternatives

- **`trustedProviders: ["auth0"]`** — trusts every Auth0 connection,
  including database signups where anyone can register any email
  unverified: an account-takeover vector, the opposite of what the linking
  gate exists to prevent.
- **Ask the customer's IT to add an `email_verified` SAML claim** — an
  extra round-trip with every future SSO customer's IT department; doesn't
  scale and puts our correctness in their hands.
- **Flip `emailVerified` in our DB per affected user** — already true for
  the current users and still insufficient: the gate also checks the
  *incoming* profile's flag (`!isTrustedProvider && !userInfo.emailVerified`).
- **Per-connection allowlist (e.g. `SAML_TRUSTED_CONNECTIONS` env var)** —
  raised by red-team (v2), re-asked, rejected: it violates the no-config
  constraint, adds an env change + restart to every future SSO onboarding,
  and the same operator who creates the connection would set the list — the
  trust decision doesn't actually move.
- **Any other BetterAuth 1.6.23 mechanism** — red-team (v2) verified none
  is both reachable and narrower: `trustedProviders` matches by provider id
  (would trust Auth0 database signups too); its function form only sees the
  callback request, not the sub; per-config trust flags exist internally
  but are not wired to genericOAuth; hooks fire only after the linking gate
  already refused.

## Consequences

- **Positive:** existing users can sign in the first time their org moves
  to SAML SSO; no per-customer manual work.
- **Positive (side effect):** brand-new SAML users are created already
  verified — no pointless verification email for an IdP-vouched address.
- **Negative:** trust now rests on the `samlp|` prefix convention, an
  Auth0 implementation detail. If Auth0 ever changed the format the fix
  degrades to a no-op (locked-out users again), never to over-trust.
- **Negative (red-team, v2):** the safety boundary moves from code to
  tenant configuration. Self-hosted operators inherit the assumption that
  their SAML connections assert operator-trusted emails; a code comment at
  the helper states this. Auth0's other enterprise strategies (`adfs|`,
  `ping|`) share the `email_verified: false` quirk and stay locked out —
  deliberate (n=1); widening the predicate is a future decision, not a
  default.
- **Neutral:** Okta and plain-OIDC branches unchanged; their IdPs already
  report verified emails.

## Open questions

- **Bind the trust to the org's pinned connection?** A stricter rule —
  only upgrade `samlp|{conn}|…` when the asserted email's domain belongs
  to the org whose `ssoProvider` is pinned to that exact connection —
  would close the spoofed-out-of-domain-email and stray-connection cases.
  It is infeasible today: one org can legitimately span several email
  domains while `ssoDomain` holds exactly one (langwatch-saas#1050), so
  strict binding would lock out a customer's secondary-domain users — the
  very lockout this ADR fixes. Revisit once multi-domain lands; applies
  equally to the OIDC enterprise strategies that already link.
- Multi-domain SSO for the same customer is tracked separately (internal
  issue langwatch-saas#1050).

## Revisions

- **v1 (2026-08-14, captain: Sergio Esteban):** framing locked (SAML-only
  trust, high blast radius, samlp-prefix + no-schema + one-PR constraints);
  forks locked: exported named helper over inline one-liner, one-off over
  shared capability.
- **v2 (2026-08-14, red-team, 4-lens panel):** claim survives narrowed.
  Held: `samlp|` cannot be forged from non-SAML connections (a database
  user id of `samlp|x` yields sub `auth0|samlp|x`), the `typeof`+prefix
  check has no type or unicode holes, and no better mechanism exists in
  BetterAuth 1.6.23 (`trustedProviders` is provider-wide and matched
  pre-token-exchange; per-config trust flags exist in
  `handleOAuthUserInfo` but are never passed by any route; hooks fire
  after the link gate and can only block, never permit). Narrowed: the
  **universal** safety claim was refuted — SAML authentication proves
  identity at the IdP, not ownership of the asserted email. Safety is
  conditional on every SAML connection in the tenant mapping email from
  an IdP-controlled attribute, promoted to the load-bearing assumption
  above; same risk class as the tenant's OIDC enterprise connections
  (`waad|`, `okta|`), as their linked account pairs in production show.
  Per-connection allowlist re-asked and rejected (see Rejected
  alternatives). Boundary decision: document + code-comment, keep
  prefix-only. Scope unchanged from v1.
