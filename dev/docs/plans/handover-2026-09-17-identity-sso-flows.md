# Identity SSO review notes

PR [#7633](https://github.com/langwatch/langwatch/pull/7633), branch
`feat/identity-sso`. Updated 2026-09-17. This replaces the chronological
handover; commit history retains the original investigations.

## Scope and invariants

- Keep one PR. Simplify existing identity packages without migrating their layout.
- Add no Prisma relations. Resolve IDs explicitly and retain organization
  scoping. The browser-discovered SCIM ownership bug requires one additive table
  keyed by connection and user, independent of optional external identifiers.
- Keep callback provenance, SCIM token isolation, egress pinning, replay checks,
  transaction locks and irreversible retirement boundaries intact.
- A recovery grant belongs to an organization. It permits its authenticated
  holder to use a password for an address that organization's connection governs.
  Recheck the grant after MFA; the submitted address must survive the challenge.
- Domain proof still requires published evidence on every deployment. Operator
  attestation is separate. A lookup failure must not consume the pending proof.
- Finalization requires fresh evidence at each phase. Progress counts live
  identifiers; finalization requires verified links and retires legacy accounts
  even for disabled memberships. It must refuse ambiguous shared accounts.
- SCIM may adopt existing unclaimed members, but cannot remove the last active
  administrator. A revoked directory resumes only after a new token is issued.
- Test sign-in replaces the session deliberately; the completion screen explains
  how to return. Activation records the test account. Recovery bindings remain
  organization-scoped and must not be copied into connection events.

## Cleanup

- One migration evidence repository implements progress and finalization reads;
  pure view/blocker rules are shared. Callback and retirement adapters stay separate.
- Self-serve dependencies are required where production always supplies them.
  Shared proof handling preserves channel-specific errors and command guards.
- Migration route controls require an active replacement and stop during
  finalization. Remaining members can be paged and failed reads retried.
- Shared fixtures exercise real services, guards and ledgers. Interrupted
  registration retries retain their IDs and competing reservations are refused.
- The initial arrival policy has an explicit confirmation action, including
  the unchanged default. Activation waits for the recorded decision.
- Reuse settings disclosure, role conversion and Enterprise eligibility helpers.
  A lapsed plan must still allow an administrator to disable an existing rule.

## Rollout and acceptance

- Deployment includes PostgreSQL migrations `20260918171001_identity_sso` and
  `20260918171002_org_sign_in_security`, plus
  `20260918171003_scim_directory_user_ownership`, after PR1's migrations.
  The ownership migration backfills existing external-ID mappings; users without
  one are adopted on their next successful SCIM write. No ClickHouse schema change.
- Password-MFA attempts begun before this cleanup deploys lack the server-side
  address companion and must restart sign-in. Existing sessions remain valid.
  Already-issued password-reset token redemption keeps its existing policy.
- Grandfathering is dark preparation, operated through `/ops/migrations` on
  Cloud. Self-hosted automatic rollout remains disabled pending the Cloud soak.
  Enabling it and communicating the eventual routing cutover remain rollout
  decisions; this cleanup does not silently change them.
- Acceptance covers a fresh OIDC organization with 500 IdP
  users, then a reset and fresh SAML/invitation flow. The verified evidence belongs
  in the PR description; do not treat an unfinished browser step as a pass.

## Local verification and artifacts

Run package tests/typechecks and the affected application tests. The parity
script on this branch is `platform/app/scripts/check-feature-parity.ts`.
The newer architecture-enforcer package belongs to another checkout and is not
an available check at this PR's head.

The existing test database configuration may point at a missing database. Use
an isolated temporary database for PostgreSQL verification; never reset an
existing development database to make a test pass.

Use the globally installed `haven`; its bundled IdP and mail simulators work
with this older branch. Haven bundles the IdP binary; restarting it does not
load Go source changes. The acceptance runtime includes the reviewed simulator
fixes while preserving the bundled runtime's persistent directory state.
`haven db reset --yes` resets the databases, but its
preparation command assumes the newer root script. On this branch, finish with
`pnpm --filter @langwatch/web start:prepare:db` under the resolved Haven environment,
then `haven db seed`. The user explicitly authorized resetting the dedicated
acceptance stack between flows. IdP/mail state survives restarts and needs its
own reset; flush Redis only after confirming no other live stack shares its DB.

This branch's dotenv loader overrides process environment. Put local SMTP
settings in the generated `platform/app/.env.portless`, using the mail service's
current SMTP port. Reload the complete supervised application process: the
monolith's `haven restart app` may restart only Vite, leaving the separate API
process with its old mailer. Verify a real signup message in the local inbox.
A standalone mailer probe does not establish that the API reloaded.

The bundled local license caps full members at 100. The 500-user acceptance run
uses a short-lived 600-seat license signed by the repository test keypair, with
the matching test public verifier and signed instance license configured locally.
The organization still activates its own license through the normal UI. Preserve
signature verification and domain proof; do not use a licensing bypass.

Current screenshots and sanitized flow records are in ignored
`.pr-screenshots/pr7633-cleanup/flow1/` and `flow2/`. Their `audit.json` records
approved image hashes. Publish only reviewed pairs through native GitHub PR
attachments. Passwords, confirmation/invite links, client secrets, license keys,
and SCIM tokens must be masked. Historical failed or stale frames stay outside
the success gallery. The external IdP account chooser currently stays light even
when the browser requests dark mode; its caption must state that limitation.

Older screenshots remain in `.artifacts/pr7633/` and
`platform/app/.pr-screenshots/pr7633-after-rebase/`. Some expose credentials;
do not publish them without a separate audit. Never commit screenshot artifacts.
