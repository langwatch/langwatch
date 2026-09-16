# Handover — driving the three identity flows, and the eight defects that fell out

Written 2026-09-17. Branch `feat/identity-sso`, worktree
`.claude/worktrees/identity-sso`, PR #7633.

Three user flows (activate SSO, activate SCIM, migrate off Auth0) were driven
end to end against a live haven stack by sequential subagents, with
screenshots. The flows were the instrument; the defects are the output. **Five
of the eight fixed defects were things that made the feature not work at all**,
and three of those were introduced earlier in the same session.

Read §0 before acting on anything.

---

## 0. State — this section wins where it contradicts anything below

### It is committed now, and rebased onto main (2026-09-17, coordinator session)

The working tree is clean but for the untracked `.artifacts/`. Three commits sit
on top of the old tip `99c40e9bb7`, and the branch was then rebased onto
`origin/main` — 36 commits replayed, **0 behind main**, `pnpm typecheck` exit 0
afterwards.

| Commit (post-rebase) | What is in it |
| --- | --- |
| `008daecd48` | `fix(identity)` — defects 1, 3, 4, 5, 6, 7, defect 8's pure date logic, and the two copy corrections. 15 files. Every file compiles against the old tip: nothing in it imports a file left outside it. |
| `9bc430f561` | `docs(identity)` — this handover. |
| `98ede9d535` | `wip(identity)` — **everything else, 160 files, deliberately labelled rather than folded into the fix commit.** Reshape or re-author it freely; nothing below it depends on its message. |

**A clean authorship split was not achievable, and that is the finding.** The
last commit on the branch is 13:17 and every dirty path was newer, so the clock
separates nothing; and the two bodies of work share files outright. Defect 2's
fix lives *inside* `sign-in-security-adapters.ts`, which is an untracked file
the branch owner created — so defect 2 is in the wip commit, not the fix commit.
`SingleSignOnSetup.tsx` and `BreakGlassSection.tsx` carry defect 8 *and* import
the untracked `ConnectionNameRow` / `SsoSettingsTable`; `error.tsx` imports the
untracked `signInErrorCodes.ts`. All of those went to the wip commit so the fix
commit stays self-contained. The split therefore **under-commits on purpose**:
some of the session's own work is in the wip commit, and none of the owner's
work is in the fix commit.

**Restore point: tag `backup/identity-sso-pre-rebase-20260917` (`aab6ab3`)** — the
entire pre-split, pre-rebase working tree as one commit, `.artifacts/` excluded.
One `git reset --hard` to that tag puts everything back.

The one rebase conflict was `useLandingRedirect.ts`: main's #8155 replaced the
inline orgless test with `belongsToNoOrganization`, this branch added
`testArrival` to the same call. Resolved by keeping both and unifying the local
`isOrgless` const on main's helper, which also stops the test-arrival query being
asked during an unanswered organization read — `undefined` now means "not known
yet" there too, not "none".

### Checks, as actually run

Re-run 2026-09-17, after the rebase and the fixes below. The parity script is
at `platform/app/scripts/check-feature-parity.ts` on this branch, and `tsx` is
only in `platform/app/node_modules/.bin`, so the root `pnpm exec tsx` fails.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm --filter @langwatch/identity-server typecheck` | **4 errors**, all pre-existing in `sso-connection-rename.unit.test.ts` — see §4's note |
| parity check | OK — **13,610** bound across 1,316 files |
| `pnpm --filter @langwatch/web test:component` | **6,560 passed**, 8 skipped, 819 files, 0 failed |
| `pnpm --filter @langwatch/web test:unit` | **38,341 passed, 0 failed** on the run before the §4d work; a later run showed 1 failure whose name was lost to a truncated capture, being re-run |
| `pnpm --filter @langwatch/identity test` | 250 passed |
| `pnpm --filter @langwatch/identity-server test` | 449 passed |

The original figures, for comparison: typecheck:all exit 0, 13,568 bound,
6,546 component, 38,295 unit with 2 failures.

Three failures remain and **none are caused by this work**:

1. ~~`typescriptCompilerApi.unit.test.ts` — ENOENT on
   `breakGlassExpiryWorker.ts`~~ **FIXED 2026-09-17.** The prediction held
   exactly: committing the deletion fixed it, and the whole unit suite went to
   38,341 passed / 0 failed.
2. `src/components/projects/__tests__/CreateProjectDrawer.test.tsx` — passes in
   isolation, fails under full-suite parallelism. Flake. **Still the best
   candidate for the single failure in the later run** — it passes alone on
   2026-09-17 too — but that is not established: the run that failed was
   captured through a `tail`, so the test's name was never recorded. Do not
   write this one off until a full capture names it.
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

> **2026-09-17 — 4a, 4b and four of 4g are done.** Commits, newest first:
> `fix(migration)` the D04 spec, `fix(identity)` the dialog title and the claim
> guard, `fix(identity)` the staff-lookup tenancy read, `fix(scim)` the PATCH
> name merge. `pnpm typecheck` exit 0 after them.
>
> **One 4g item was checked and is NOT a bug.** `AuthenticationLayout.tsx:52`
> linking a bare `/settings/authentication` is the house convention, not a
> defect unique to that rail: `useSettingsMenu.ts:226` links `/settings/members`
> the same bare way and `routes.tsx:178` registers it bare. The whole settings
> section resolves its organization from context. Changing only this rail would
> make it inconsistent without changing where it lands, so it was left alone.
> Whether settings paths should carry an organization at all is a real question
> and a much larger one than §4g implies.
>
> **And one item turned out to be bigger than it was written.** The stale
> docblock in `identity/runtime.ts` was real, but the spec underneath it was
> worse: the scenario "PR1 does not run the unproved SSO grandfather migration"
> asserted D04 "is not declared or run" while `registeredMigrations()` declares
> it — and the bound test had already been updated to assert the registration,
> so the pair read green while the words said the reverse, under a test title
> that still said it left D04 out. A binding enforcing the OPPOSITE of its
> scenario is worse than an unbound one, and greps for stale prose will not
> find it. Worth a sweep of its own.
>
> **4d is now half done** — the customer-visible half. See its own section: the
> competing-connection path is closed, and the operator-driven half turns out to
> be the existing design rather than something to build.
>
> **Still open here:** 4c is untouched on purpose — a product decision by its
> own text. 4e, 4f and the remaining ten 4g items are untouched. The claim guard
> shipped without a test because nothing in the tree renders `DomainsSection`.
>
> **One pre-existing failure worth knowing about**, found while checking this
> work and not caused by it: `pnpm --filter @langwatch/identity-server typecheck`
> reports **4 errors**, all in `src/__tests__/sso-connection-rename.unit.test.ts`,
> all a missing `tenantId` on the rename command. It rides in the wip commit with
> the rest of the in-flight rename work. `pnpm typecheck` cannot see it — that
> command covers the three applications only, so this needs `typecheck:all` or
> the package's own script.

### 4a. Residue to resolve first

`platform/app/ee/scim/scim-name.ts` was **created and never wired in** — I was
interrupted mid-change. It holds `mergeNameParts` and `namePartsIn`, both pure
and both correct as far as they go, intended for 4b. Either finish 4b or delete
the file; it currently imports nothing and nothing imports it.

**RESOLVED 2026-09-17 by doing 4b.** `scim.service.ts` imports both functions
and the file is load-bearing; it is no longer residue. Both were correct as
written and neither needed changing — only the call site did.

### 4b. SCIM PATCH does not interoperate with Okta or Entra — highest value

`ee/scim/scim.service.ts:1005` skips any operation whose `value` is not an
object, so `{"op":"replace","path":"name.familyName","value":"Smith"}` — the
exact shape both vendors send — returns **200 with the record unchanged**, and
the request log files it "Accepted". Separately, the dot-notation branch
rebuilds the whole name from the half it was given, so patching a surname
**destroys the forename**. `scim-name.ts` exists to fix both; it needs wiring,
tests, and a spec scenario in `specs/identity/scim-connection-sync.feature`.

**DONE 2026-09-17.** The name branch now runs BEFORE the object guard, which is
what was eating the scalar form. Five tests in
`ee/scim/__tests__/scim-patch-name.unit.test.ts`, two scenarios bound in
`scim-connection-sync.feature`, all 16 SCIM test files green (156 tests).
**Verified as a regression, not just as a pass**: reverted against the old
handler, three fail — two with `expected undefined` (the silent accept) and one
with `expected 'Smith' to be 'Ada Smith'` (the lost forename) — and the two
describing already-correct behaviour pass on both sides.

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

**HALF DONE 2026-09-17, and the framing was wrong.** The customer-visible half
is fixed: `getSetup` reports a `legacyRoute`, and a legacy organization now gets
"single sign-on is already set up" instead of the vendor picker. The competing
connection is no longer reachable from the screen.

The wrong framing was treating this as a customer journey to build. **Doing the
move in backoffice, invisibly, is already the design** — the migration declares
`requiresOperatorConfirmation = false` under the comment "Dark preparation: the
connection projection decides nothing until the routing flag is flipped, so
finalizing changes nothing customer-visible", its bound scenario is literally
"A legacy SSO organization is grandfathered without noticing", and the operator
surface exists at `/ops/migrations` (enroll, enroll-cohort, run for one
organization, roll back). On Cloud that path works today.

**What is genuinely left is one boolean and one decision.**
`availableOnThisInstallation = isSaaS || migration.runsAutomaticallyOnSelfHosted`
(`system-migrations.service.ts:342`), and D04 sets `runsAutomaticallyOnSelfHosted
= false` — which hides the whole action row on self-hosted, `RunForOrganization`
included, even though that action is *not* `isSaaS`-gated. Its own comment says
it is waiting on the cloud soak. Note this leans on `isSaaS`, the unsigned flag.

And the flip itself is still customer-visible in effect: recording the old route
changes nothing, but moving sign-in onto the connection is a real cutover. That
part needs a decision about what, if anything, the customer is told — and it
makes §4e matter **more**, not less, because a customer who was never involved
in the migration was never walked through the way back in either.

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

- **Publishing the screenshots. Re-confirmed blocked 2026-09-17, and it is the
  auto-mode Bash classifier, not the network.** `curl -F … img402.dev/api/free`
  is refused, and so is `gh auth status` — while `gh repo view` answers fine, so
  reads are permitted and only the publishing verbs are not. Committing them
  fails `specs/ci/no-committed-screenshots.feature`. **Needs a Bash permission
  rule or a person to attach them.** Note img402's free tier has **7-day
  retention**; `langwatch/pr-screenshots` does not — but it is a **PUBLIC**
  repo, which matters for the next bullet.

- **Six of the 90 frames render credentials and must not be published as they
  are**: `02-activate-scim/07-token-issued-shown-once.png` (a SCIM bearer token
  in the clear, by design — it is the "shown once" screen),
  `02-activate-scim/15-idp-provision-panel-filled.png` (the same token pasted
  in), `01-activate-sso/10-idp-app-registered.png`,
  `01-activate-sso/11-` and `13-oidc-form-filled-*.png` (IdP client secret), and
  `03-migrate-sso/09-replacement-form-filled.png` (client id and secret). All
  are local simulator values on `*.langwatch.localhost` and the SCIM token was
  revoked in the very next frame, so the blast radius is nil — but they would
  trip secret scanning on a public repo. Redact or withhold those six.

- **A fresh post-rebase capture already exists** at
  `platform/app/.pr-screenshots/pr7633-after-rebase/` (7 frames, gitignored by
  `**/.pr-screenshots/`), taken by `…/capture-fixes.ts` in the same directory
  against the rebased stack. It carries one result worth keeping: **no 5xx
  response on any of the six pages**, which is the live verification that
  defects 3 and 7 — both of which used to 500 on exactly those routes — hold
  after the rebase. It also shows the Directory card reading "Your provider
  pushes on its own schedule" rather than the false "The token is issued", and
  still reading "Waiting for the first push / Needs attention" after four real
  members exist, which is §4g's first item, unfixed and now photographed.
- **Rewriting the PR body** waits on that, and on a decision about whether this
  session's work is committed — the current body is stale regardless (it says
  the PR is in draft when it is not, cites migration `20260907120001_identity_sso`
  when the branch carries `20260913120002_identity_sso`, and quotes 12,197 bound
  scenarios against today's 13,568).
- **`cannot_disable_last_admin` (defect 5) is not verified live.** Flow 3 never
  triggered the IdP simulator's sync. The simulator is still connected; one
  press of "Sync the difference" is the test, and flow 2's `NOTES.md` holds the
  recovery call if it goes wrong.
