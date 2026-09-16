# Handover — driving the three identity flows, and the eight defects that fell out

Written 2026-09-17. Branch `feat/identity-sso`, worktree
`.claude/worktrees/identity-sso`, PR #7633.

Three user flows (activate SSO, activate SCIM, migrate off Auth0) were driven
end to end against a live haven stack by sequential subagents, with
screenshots. The flows were the instrument; the defects are the output. **Five
of the eight fixed defects were things that made the feature not work at all**,
and three of those were introduced earlier in the same session.

Nothing is committed. Read §0 before acting on anything.

---

## 0. State — this section wins where it contradicts anything below

### Everything is uncommitted

173 changed paths in the working tree, 65 of them untracked (excluding
`.artifacts/`). That is **my work and the branch owner's WIP interleaved** — I
never staged, committed or stashed anything. `git stash` was never run. Before
any commit, separate the two: the owner's in-flight files include
`useSignInSecurity.ts`, `signInSecurity.ts`, `SignInSecurityCards.tsx`,
`sign-in-security-adapters.ts` and the deletion of
`platform/app/src/server/breakGlassExpiryWorker.ts`.

### Checks, as actually run

| Command | Result |
| --- | --- |
| `pnpm typecheck:all` | exit 0 |
| `pnpm exec tsx scripts/check-feature-parity.ts` | exit 0 — **13,568** bound, 0 unbound in enforced files |
| `pnpm test:component` (whole suite) | **6,546 passed**, 8 skipped, 817 files |
| `pnpm test:unit` (whole suite) | **38,295 passed**, 2 failed — neither mine, see below |
| `pnpm --filter @langwatch/identity test` | 250 passed |
| `pnpm --filter @langwatch/identity-server test` | 446 passed |

Three failures remain and **none are caused by this work**:

1. `src/test-utils/__tests__/typescriptCompilerApi.unit.test.ts` — ENOENT on
   `platform/app/src/server/breakGlassExpiryWorker.ts`. The branch owner
   deleted that file but has **not staged the deletion**, so `git ls-files`
   still lists it and the test reads a path that is not there. Staging the
   deletion fixes it; it is green in CI.
2. `src/components/projects/__tests__/CreateProjectDrawer.test.tsx` — passes in
   isolation, fails under full-suite parallelism. Flake.
3. `packages/server` `test/cli-doctor.test.ts` (2) — environmental, missing
   predeps on this machine. That package was never touched.

### The local stack

Driven with the haven built from the **other** checkout —
`/Users/lw/Source/github.com/langwatch/langwatch/.bin/haven/haven`
(branch `feat/strict-feature-layout-v0`). It is much richer than the installed
one: `restart`, `db reset|seed|url`, `mail`, `idp`, `errors`, `traces`.

- The database was wiped and reseeded (`haven db reset --yes` + `db seed`)
  partway through. **haven's own migration step reported a failure that is not
  real** — `prisma migrate deploy` run directly applied all 317 migrations
  cleanly. Worth chasing separately.
- `haven restart app` bounces only the UI on its port. **The API is not a
  restartable service**; loading server-side changes needs `haven up -d -f`.
- The `mail` lane **cannot run on this branch** — it crash-loops with
  `unknown service: mailsim`, because the newer haven expects a service
  `cmd/service/main.go` does not have. It is switched off for this stack. No
  email is deliverable here.
- `ADMIN_EMAILS` names `admin@mail.langwatch.localhost`, which **does not exist
  in the database**. The real local admin is `admin@haven.localhost` /
  `LocalHavenAdmin!2026`. **This stack therefore has no staff operator.**

### Artifacts

`.artifacts/pr7633/` — `01-activate-sso/` (44 screenshots), `02-activate-scim/`
(30), `03-migrate-sso/` (16), each with a `NOTES.md` carrying per-shot captions
and cleanup instructions. **`.artifacts/` is not gitignored and these must
never be committed** — `specs/ci/no-committed-screenshots.feature` fails the
build for exactly that. Either move them under `.pr-screenshots/` (which is
ignored) or delete them once published.

---

## 1. Defects fixed, with the evidence that they were real

| # | Defect | Fix |
| --- | --- | --- |
| 1 | **Routed SSO sign-in dialled the wrong plugin.** `signIn()` sent connection ids to `/sign-in/social`, which answers `404 PROVIDER_NOT_FOUND`; the screen swallowed it into a permanent spinner. The feature did not work at all. The setup page's test sign-in worked throughout because `useTestSignIn` calls `signIn.sso` directly, which is what made it look like a routing problem. | `platform/app/src/utils/auth-client.tsx` — ids matching `looksLikeSsoConnectionId` now dial `client.signIn.sso`. Verified live: a person who had never existed signed in and became a member. |
| 2 | **Any org with a session window 401'd every user on the installation.** `organizationUser.findMany({where:{userId}})` with no `organizationId` is refused by the ADR-021 guard with a *plain* `Error`, thrown under `getServerAuthSession`, whose catch returns a null session — while `/api/auth/get-session` still answers 200. Dormant until an org set a rule; the `@default(1440)` added earlier in this session armed it for every new org. | `sign-in-security-adapters.ts`, both `forUser` reads, now through `Organization` with `members: { some: { userId, disabledAt: null } }`. |
| 3 | **`identity.myTestArrival` 500'd on every authenticated page load**, same tenancy class. Not cosmetic: `resolveOrglessDestination` cannot tell an *errored* query from "no", so a successful SSO test sign-in landed on "create your organization" — the exact outcome `/auth/sso-test-complete` exists to prevent. That page had never rendered. | `sso-membership.prisma.repository.ts` `hasAnyMembership`. Verified live: `200 {"json":null}`. |
| 4 | **`SignInAttemptLock` was in no tenancy regime.** The partition guard caught it. | `dbMultiTenancyProtection.ts` — added to `GLOBAL_MODELS` with its reason (keyed on an HMAC of the address typed, before anyone is resolved). |
| 5 | **A SCIM token could deactivate the organization's only administrator.** Observed twice: a sync reported "1 created and 4 deactivated" and one was the sole admin; live session died, password refused, recovery only by hand-written SCIM call. Adoption itself is deliberate and was left alone. | `ee/scim/scim.service.ts` — `refuseIfItClosesTheOrganization` reuses the existing `CannotDisableLastAdminError`. "Active" excludes already-deactivated users, so one push cannot take two admins in turn. |
| 6 | **"Revoke it and issue another" — the product's own advice — bricked the connection.** `REVOKED` absorbed every fact *before* the switch, so a new token could not clear it; only a platform operator's redrive could. | `packages/identity/src/scim-sync.ts` — the gate now lets `scim_token_issued` through and absorbs everything else. |
| 7 | **The migration checklist query named a relation that does not exist.** `user: { identifiers: { some } }` — `User` has no `identifiers`; `Identifier` carries a bare `userId`. Threw on every call, and because `getSetup` embeds the migration view, **any org with a registered replacement lost its whole Identity provider page to a 500**, with the overview then reading "Single sign-on — Not set up". | `sso-migration-progress.prisma.repository.ts` — resolves linked user ids from `Identifier` first. |
| 8 | **Break-glass grants expired a day late east of UTC.** `endOfDay` built `T23:59:59.999Z` from an `<input type="date">` value, which is a *local* calendar date. | Extracted to `features/sso/logic/breakGlassDates.ts`, built field-by-field. Two existing assertions had hard-coded the buggy UTC literal and now construct local time. |

Plus copy that contradicted the code: the live connection promised a "turn the
connection off" control that does not exist (suspend is deliberately an
operator lever); the token disclosure claimed a token "only manages the people
that connection provisioned" in three rendered places when adoption is exactly
what bit flow 2; the Directory card asserted "The token is issued" with zero
tokens. And `/auth/error` now renders the five SSO assertion refusals' own
registry copy instead of "Something went wrong signing you in" — they were
admitted across the redirect boundary on a promise no screen kept.

---

## 2. Decisions taken, so nobody re-asks them

1. **Adoption stays.** A SCIM token reaching a person no connection has claimed
   is deliberate (`ScimDirectoryIdentityService`) and is how a directory takes
   over members who predate it. Only the act that leaves nobody able to
   administer the organization is refused.
2. **`REVOKED` stays absorbing for the directory.** Only the administrator's own
   `scim_token_issued` lifts it; a straggling push on a dead token still does
   not. Both halves are tested.
3. **The error page reads the presentation registry, gated on the admitted
   set.** Consulting it for any code would let `?error=` pull arbitrary
   sentences under LangWatch branding.
4. **Screenshots are not committed.** The repo already says so twice
   (`.gitignore:74`, `:132`) and enforces it with a spec.

---

## 3. What to distrust

- **A static investigation of the migration path got one prediction wrong.** It
  claimed `selectMigrationRoute` has no ACTIVE precondition and would silently
  fall back to Auth0 while the card claimed the new provider. Driven live, it
  **returns 409** — the analysis read the function body and missed
  `ALLOWED_FROM[SELECT_MIGRATION_ROUTE] = ["ACTIVE"]`. The "lying status" risk
  is not real. Re-check the other four predictions the same way before acting.
- **I claimed mid-session that a fix was live because "the ui lane restarts on
  change".** True for browser code, false for the API — which is not a
  restartable haven service. Two reports were affected. Always check the
  `server.mts` process start time against the file mtime.
- **Scoped test runs hid failures for hours.** Running
  `src/server/app-layer/identity/__tests__` does not include
  `repositories/__tests__`. Twelve component failures accumulated unseen. Run
  the whole suite before claiming green.

---

## 4. Open work, lane-able

### 4a. Residue to resolve first

`platform/app/ee/scim/scim-name.ts` was **created and never wired in** — I was
interrupted mid-change. It holds `mergeNameParts` and `namePartsIn`, both pure
and both correct as far as they go, intended for 4b. Either finish 4b or delete
the file; it currently imports nothing and nothing imports it.

### 4b. SCIM PATCH does not interoperate with Okta or Entra — highest value

`ee/scim/scim.service.ts:1005` skips any operation whose `value` is not an
object, so `{"op":"replace","path":"name.familyName","value":"Smith"}` — the
exact shape both vendors send — returns **200 with the record unchanged**, and
the request log files it "Accepted". Separately, the dot-notation branch
rebuilds the whole name from the half it was given, so patching a surname
**destroys the forename**. `scim-name.ts` exists to fix both; it needs wiring,
tests, and a spec scenario in `specs/identity/scim-connection-sync.feature`.

### 4c. `active:false` does not deprovision on the shipped default

The entire access removal sits inside `if (scimGrantsWritePathEnabled())` and
`SCIM_V2_GRANTS` defaults `off` (`env-create.mjs:420`). Sign-in is refused and
the session dies, but the `OrganizationUser` row, the role grant and the seat
all survive, and **nothing records that the person left** — the change list
reads revoked grants, so with the flag off the audit surface is add-only.
`DELETE` does the full job. `active:false` is what real directories send for a
leaver. **This is a product decision, not a bug to flip quietly.**

### 4d. An Auth0 customer cannot begin the migration

`getSetup` reads the `SsoConnection` projection only, so the legacy
`ssoDomain`/`ssoProvider` columns are invisible and the customer is shown
"Connect your identity provider" — with an Auth0 tile among the vendors.
Following it registers a **competing** connection on the domain Auth0 already
routes: no `replacesConnectionId`, no inherited proof, no rollback, no quiet
period. Upstream of that, the grandfathered connection can only be minted by an
operator-enrolled system migration (`connection-grandfather.migration.ts:47`,
`enrolledAutomatically = false`), and on self-hosted there is **no operator path
either**. See `dev/docs/adr/` and flow 3's `NOTES.md`.

### 4e. The break-glass way back in cannot be spent

Step 4 asks an administrator to name someone who can still sign in if single
sign-on fails. Once the connection is live, `/auth/signin` bounces everyone to
the provider, and the password form is reachable **only at
`/auth/signin?local=1`** — a parameter that appears in no rendered copy
anywhere, only in code comments and two `.feature` files. A grant nobody can
spend is not a way back in.

### 4f. Step 3's refusal notice sends people the wrong way

`TestSignInSection.tsx:130-140` offers three ways forward when the reader's
address is off-domain. All three are wrong at the moment it renders, and it
never names the one that works: `setupIsComplete`
(`sso-assertion.service.ts:469-485`) needs a proved domain **plus** a decided
arrival policy **plus** a live break-glass grant. Its own comment calls this
"THE DEADLOCK THIS BREAKS". A flow agent lost a round trip and an orphaned
account to it.

### 4g. Smaller, each contained

- The `VERIFIED` chip reads "Ready to turn on" while step 6 reads "Waiting" —
  the chip is keyed on lifecycle state and cannot see the three outstanding
  preconditions. A bound test asserts the current label.
- A successful test sign-in silently replaces the administrator's session and
  can leave a permanently orphaned account belonging to no organization.
- The connection's event log records no row for the break-glass grant or for
  the test sign-in that activation rests on.
- Every word on the migration screens hardcodes "Auth0"
  (`SingleSignOnSetup.tsx:263,267,272,276,337,342,365,415`).
- Registering a replacement succeeds **silently** — the screen does not move.
- The replacement form shows the **predecessor's** callback URL.
- Nested `<Heading>` inside `<Dialog.Title>` (both h2) raises a React hydration
  error on every dialog open — `ConnectorsSection.tsx:448,474`.
- "SCIM" leaks into customer copy as a group badge.
- The lock-out message is "Failed to create session." — no cause, no remedy.
- Deactivated people still count toward seats.
- Claiming a domain with an empty field round-trips to the server for a generic
  refusal; the Claim button has no `disabled` guard
  (`DomainsSection.tsx:136-152`).
- `identity-lookup.prisma.repository.ts:199` is the last surviving unbounded
  `organizationUser` read — same class as defects 2 and 3, on the staff ops
  surface.
- `AuthenticationLayout.tsx:52` links a bare `/settings/authentication`, so
  the rail's Overview can land on another organization's settings (org comes
  from `localStorage`).
- Stale docblock: `identity/runtime.ts:1302-1309` says the grandfather migration is
  "composed but deliberately NOT registered" and
  "runs for nobody"; `system-migrations/runtime.ts:139` registers it.

---

## 5. Blocked, needs a person

- **Publishing the 90 screenshots.** Both house routes are refused by the
  permission classifier: uploading to `img402.dev` (the `browser-test` skill's
  documented flow) and pushing to `langwatch/pr-screenshots`. Committing them
  fails `specs/ci/no-committed-screenshots.feature`. Needs either a Bash
  permission rule or a person to attach them. Note img402's free tier has
  **7-day retention**; the `pr-screenshots` repo does not.
- **Rewriting the PR body** waits on that, and on a decision about whether this
  session's work is committed — the current body is stale regardless (it says
  the PR is in draft when it is not, cites migration `20260907120001_identity_sso`
  when the branch carries `20260913120002_identity_sso`, and quotes 12,197 bound
  scenarios against today's 13,568).
- **`cannot_disable_last_admin` (defect 5) is not verified live.** Flow 3 never
  triggered the IdP simulator's sync. The simulator is still connected; one
  press of "Sync the difference" is the test, and flow 2's `NOTES.md` holds the
  recovery call if it goes wrong.
