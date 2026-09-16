# Handover — the shell not-found race, and what the main merge did not re-home

Written 2026-09-16. Branch `feat/strict-feature-layout-v0` (working tree),
plus one PR cut from `origin/main`.

Two unrelated threads landed in one session. The first is fixed and shipped.
The second is an audit that corrects a claim I made mid-session; read §3 before
acting on anything I said in conversation.

---

## 0. State, rewritten 2026-09-16 ~02:2x

This section is the snapshot. Where it contradicts a section below, it wins.

### Committed this session, in order

| Commit | What |
| --- | --- |
| `52814ec2d8` | the `belongsToNoOrganization` port section 2 left uncommitted |
| `e37f782919` | every `/ops/*` address draws inside `UiAppChrome` again; the four orphaned governance screens registered in `governanceScreens` |
| `ca969cd14d` | the four governance routes + loaders; `navigation-destinations-are-routed` widened to the governance and gateway nav families |
| `31c529165c` | `/settings/profile` answers; `specs/settings/profile.feature` 0/29 -> 16/29 |
| `26c5c7cad2` | the operator identity lookup's server read half; `platform-ops-identity-lookup.feature` 0/32 -> 13/32 |
| `05bce7849f` | `/settings/security` with the `/settings/authentication` redirect; `authentication-settings.feature` 3/27 -> 10/27; the user-web suite's flake fixed |

Every commit was made by explicit pathspec, boot-checked after, and its package
checks re-run by the coordinator rather than taken on the lane's word. **Three
lane claims did not survive that** - see "what to distrust" below.

### Decisions taken, so nobody re-asks them

1. **The governance four were dropped by the merge, not retired** (section 3a).
   Evidence: main serves all four, `governanceNavItems` links at all four, and
   `governance-platform-placeholders.feature` describes them as deliberate Preview
   screens with `@integration` scenarios already bound. They got routes.
2. **`/settings/security` follows main's arrangement, redirect shim included**
   (user's decision). The branch is no longer a generation behind on account
   settings.
3. **The identity lookup's `history` panel and `waiting.proposals` both read
   through `@langwatch/eventing`'s existing `EventRepository`**, per person by
   aggregate stream. No new ClickHouse dependency (eventing is already a
   dependency and its ClickHouse adapter already exists), and no new Postgres
   projection (`identifier-aggregate.ts`: a proposal changes no head *on
   purpose*). One mechanism answers both, because `LINK_PROPOSED` is a
   person-stream fact. Recorded in section 0 of that lane's handoff.
4. **Self-service identity procedures stay in `modules/user/server`** and the
   `identity.*` namespace is not split. `user.trpc.ts:141` says why in its own
   comment.

### What to distrust, and why

A lane's own report was wrong three times tonight. Re-run the checks yourself at
collection; it is one command and it caught all three.

- `settings-profile-port` said oxlint "failed to load, another session broke the
  plugin" and hand-checked instead. The plugin was fine and
  `packages/oxlint-rules/` was not even dirty; the real run found **five errors in
  that lane's own new files** (`temporal-only` on two `Date` fields and a
  `new Date(...)`, `array-type` on two `ReadonlyArray<T>`). Fixed at collection.
  **A hand-check is not a lint run.**
- `settings-security-port` estimated its flake at "1 in 3-5 runs". Measured: **2
  failures in 5**, and 6 consecutive clean runs after `isolate: true`. The
  test-harness config documents that escape hatch in as many words at
  `packages/test-harness/src/vitest-config.ts:23`.
- `identity-lookup-server-reads` reported `partial` honestly but gave **no parity
  number**, which was its completion criterion. Measured: 13/32 against a target
  of 17 - the shortfall being exactly the two panels it blocked on.

And once in the other direction: `identity-trpc-transport` stopped `blocked`
without writing code and **corrected the coordinator twice** (see section 8).
That is the protocol working, not a lane failing.

### The tree

**The dirty count is not this drive's.** The lint-to-zero session has five
comment-sweep lanes live (`sdks/typescript`, `modules/{analytics,trace,scenario,gateway}`),
and a haven TUI and simulators drive holds `tools/thuishaven`,
`services/{mailsim,idpsim}` and `specs/setup/haven-*.feature`. Commit by explicit
pathspec only. **Never `git stash`** - the stack is global and `stash@{0}` holds
another session's mail-sink work.

**`pnpm-lock.yaml` is dirty and was deliberately NOT committed.** It already
carries `26c5c7cad2`'s `@langwatch/audit-log-contract` entry for
`modules/identity/server`, but it is tangled with a `packages/ui-host` change
belonging to somebody else. Whoever owns those lines should commit it; until then
a `--frozen-lockfile` install would fail on that dependency.

**The gap to origin/main: 4 commits behind, 2920 ahead**, merge-base
`c5999477f1`. Three of the four are identity PRs (#8143, #8148, #8149) landing in
exactly the area section 3b covers. Deliberately not merged while six lanes and
four sessions were live. **Merge it before the identity work goes further**, or
those lanes port against a tree the merge is about to move.

**`apps/ui/src/model/ui-route-table.ts` is now coordinator-shared**
(`COORDINATOR.md` section 6): three lanes wanted an entry within one hour.

### Two holes in the guards, one closed

`navigation-destinations-are-routed.unit.test.ts` read `projectNavItems` **and
nothing else**, which is why four dead governance links passed 107 green tests. It
now reads the governance and gateway families too, proven to bite by removing a
route and watching it fail in both readings (107 tests -> 145).

Still open: **`/annotations` is in `feature-map.json` and routed nowhere**, and
`feature-map-links-are-routed.unit.test.ts` is red about it - confirmed
pre-existing by restoring HEAD's route table. And the destinations test still does
not read the **settings** family; adding it is correct only once
`/settings/profile` and `/settings/security` are both complete, or it goes red for
gaps nobody is fixing.

---

## 1. Shipped: PR #8155, the full-page 404 on refresh

**Branch** `fix/shell-project-not-found-race`, cut from `origin/main` at
`51577b8e19` (ancestry verified before push). Worktree at
`.claude/worktrees/shell-notfound-race`.

### The report

Refreshing `app.langwatch.ai/canary-H9pyui/traces` — any `/:project/...`
address — draws the full-page 404 scene for a beat. Separately, signing in
flickers over an `/onboarding/...` URL and then lands home. One cause.

### The cause

The server is fine: that URL returns `HTTP 200 text/html`. Client-side chain:

1. `hooks/useOrganizationTeamProject.ts:296` — the organization graph is read
   only once the session resolves (`enabled: session.status !== "loading" && …`).
   That guard is correct and was added to fix a 401 that never retries.
2. `@tanstack/query-core@5.101.4/queryObserver.js:310` —
   `const isLoading = isPending && isFetching`. **A disabled query is pending
   but not fetching, so it reports `isLoading: false` with no data** — byte for
   byte the shape of a read that answered empty.
3. `useOrganizationTeamProject.ts:653` — the early return asked
   `organizations.isLoading && !organizations.isFetched`, so it did not fire,
   and the hook returned `isLoading: false` with `project: undefined`.
4. `features/navigation/shell/useNavigationV2ShellState.ts:100` —
   `if (router.query.project && !isLoading && !project) return { status: "not-found" }`.
5. `features/navigation/shell/NavigationV2Shell.tsx:56` — `<NotFoundScene />`.

So the 404 renders for exactly as long as `/api/auth/session` takes. The
onboarding flicker is the same window read by a different caller:
`features/navigation/useLandingRedirect.ts:178` computed
`isOrgless: !isLoading && !organization && (organizations?.length ?? 0) === 0`,
which is true while the graph is unanswered, and answers `/onboarding/welcome`.

### The fix

One rule: *a read that has not answered is not a read that answered with nothing.*

- The hook now reports on whether the read has **answered**, counting the wait
  for the session as part of it. An address that asks for no graph at all
  (public, signed out) still resolves immediately — that is what keeps the
  share page from waiting forever on a read it never makes.
- `belongsToNoOrganization` makes the org-less test affirmative: belonging to
  no organization is something the graph *said*, never something inferred from
  its silence. This also covers what the loading fix cannot — a graph that
  answered with a refusal rather than a list, which is the original 401 mode.

### Verified

- `specs/navigation/workspace-resolution.feature`, 6 scenarios, all bound
  (`pnpm --filter @langwatch/web check:feature-parity` → 6/6).
- The regression test fails on main (`expected false to be true`), passes with
  the fix.
- `pnpm --filter @langwatch/web test:component run` — 784 files, 6291 tests,
  all pass.
- `pnpm typecheck` — clean.
- `biome check` clean on touched files; `useOrganizationTeamProject.ts` reports
  the same 6 pre-existing warnings before and after.

A fresh worktree needs three generated things before the suites run, or you
will chase phantom failures: `pnpm --filter @langwatch/web prisma:generate:typescript`,
`… build:typescript-sdk`, `… generate:task-registry`.

---

## 2. What is in the `feat/strict-feature-layout-v0` working tree

Uncommitted, alongside the ~47 files that were already dirty.

**Committed as `52814ec2d8`** - see section 0. Package test failures are
identical with and without it (4 files / 11 tests, all pre-existing).

**Attempted and reverted — do not redo it blindly.** Gating
`useUiOrganizations` on the session having answered (`apps/ui/src/behavior/ui-session.ts`)
took `apps/ui` from **46 failed files / 138 tests to 73 / 295**. Reverted;
`ui-session.ts` is untouched. The change is right in principle — it removes a
whole redundant round trip (§5) — but it needs its own pass with the fallout
understood, not a drive-by.

Note the 404 symptom does **not** reproduce on this branch anyway:
`apps/ui/src/features/navigation/ui/sections/navigation-host.tsx` wires
`notFound: () => <UiPageLoading />`, a spinner rather than the scene. The
underlying race is still there; only its rendering is benign.

---

## 3. The route surface — correcting what I said in conversation

I told Alex the missing Settings pages were "porting work". That is right for
two of them and **wrong for the four governance ones**, whose screens already
exist on this branch and only lack routes. The split matters because one is an
afternoon and the other is four lines.

`dev/docs/plans/route-surface-parity-2026-09-12.md` already ran this audit four
days ago and its §A still stands. What follows is the delta.

### 3a. Four governance addresses: screens exist, routes do not

    /governance/agents      enterprise/modules/governance/web/src/ui/sections/governance/agents.tsx
    /governance/analytics   …/governance/analytics.tsx
    /governance/insights    …/governance/insights.tsx
    /governance/signals     …/governance/signals.tsx

All four render the catch-all 404 today. **The screens were ported; the
route-table entries and page loaders were not.**

**ANSWERED 2026-09-16: dropped by the merge, not retired.** They want route
entries, not redirects. Do not reopen this. The evidence:

- `origin/main:platform/app/src/routes.tsx` serves all four - `agents` at line
  258, `insights` 275, `analytics` 279, `signals` 283.
- `modules/navigation/web/src/model/section-nav-items.ts:105` links at all four
  from `governanceNavItems`, and the bouncer exemption list in
  `modules/auth/web/src/behavior/use-required-session.ts` names them.
- `specs/governance/governance-platform-placeholders.feature` describes
  insights, analytics and signals as deliberate Preview placeholders behind
  `release_ui_governance_billed_cost_enabled`, and its `@integration` scenarios
  are already bound in
  `enterprise/modules/governance/web/src/ui/sections/governance/__tests__/platformPlaceholders.integration.test.tsx`.
  A retired page does not keep a bound spec and three nav entries.

`agents` is not flag-gated; the other three are, on the same flag `costs` and
`billed` use, and the spec insists the guard is on the page and not only on the
nav item. In `.claude/manifests/ui-route-surface-repair.md`, lane running.

### 3b. Three addresses the merge never re-homed

    /settings/profile
    /settings/security
    /ops/backoffice/identity-lookup

These are **not** an old drop, which is why the 2026-09-12 audit does not list
them. All three were added by `c5999477f1` — `feat(identity): add the
authentication core and front door (#7631)`, 2026-09-14 — which is this
branch's merge-base with main, so the commit *is* in the branch's history. The
merge took the commit and did not re-home its three new pages into `apps/ui`
and the modules. In the new tree every main change has to be re-addressed into
a module, and these three were not.

This one is genuinely porting work. Of the sections the two Settings pages are
built from, only `passkeys-section`, `sign-in-methods-section` and
`enterprise-capabilities-section` exist on the branch. Absent entirely:
`ProfileDetailsSection`, `PersonalApiKeysSummary`, `PasswordSection`,
`TwoFactorSection`, `EmailAndLinkedAccountsSection`, `BrowserSessionsSection`.
`modules/user/web/src/ui/sections/devices-panel.tsx` looks adjacent but is the
personal-workspace devices panel on a different API, not the browser-sessions
port. **`identity-lookup` is far bigger than "needs a screen", and that was my
mistake.** Checked 2026-09-16: the string `identity-lookup` / `identityLookup` /
`IdentityLookup` appears **nowhere** in `modules`, `enterprise`, `apps` or
`packages` on this branch, outside stale `dist/`. The merge did not drop a page;
it dropped the whole vertical slice. On main:

    platform/app/src/server/app-layer/identity/identity-lookup.service.ts                485 lines
    platform/app/src/server/app-layer/identity/repositories/identity-lookup.prisma.repository.ts   346
    platform/app/src/server/api/routers/identityLookup.ts                                305   (rate-limited)
    platform/app/src/server/app-layer/identity/identity-lookup-adapters.ts               164
    platform/app/src/pages/ops/backoffice/identity-lookup.tsx                             10   (the page is thin; the screen is a component)

It is also **not** a `BACKOFFICE_RESOURCES` entry on main - it is its own
top-level route at `/ops/backoffice/identity-lookup`, listed by
`useSettingsMenu.ts:368`. So adding it to `BACKOFFICE_RESOURCES` here would be a
wire difference, not a port.

Its spec is already on this branch and reports **0 of 32 scenarios bound**
(`specs/identity/platform-ops-identity-lookup.feature`). Beside it,
`specs/identity/org-admin-identity-surface.feature` is 0 of 20 *enforced* -
every scenario is `@unimplemented`, so it is exempt and not a gap.

That makes the section 3b family 85 unbound scenarios, not two pages and a
screen: 29 profile, 24 authentication-settings, 32 identity-lookup. It wants its
own module lane with a server half, and it is the largest single thing this
handover names.

There is a second-order effect worth knowing: main's #7631 **renamed**
`/settings/authentication` into `/settings/security` and left the old address
as a `<Navigate>`. This branch still serves the pre-rename page at
`/settings/authentication` (`modules/user/web/src/ui/sections/personal-workspace/authentication.screen.tsx`).
So the branch is not merely missing two pages — it is one generation behind on
how account settings are arranged, and a naive port would collide with that
file.

### 3c. How to re-run this, without me

    git show origin/main:platform/app/src/routes.tsx \
      | grep -oE 'path: "[^"]*"' | sed 's/path: //' | tr -d '"' | sort -u > /tmp/main-paths.txt

    grep -rhoE '"/[a-zA-Z0-9:@*_.\[\]/-]*"' \
      apps/ui/src/model/ui-route-table.ts \
      apps/ui/src/features/*/ui/sections/*-routes.tsx \
      apps/ui/src/features/*/ui/sections/routes.tsx \
      | tr -d '"' | grep -E '^/' | sort -u > /tmp/new-paths.txt

    comm -23 /tmp/main-paths.txt /tmp/new-paths.txt

**The second command is the one that matters.** Scanning only
`ui-route-table.ts` reports five `/:project/annotations*` routes as missing;
they are contributed at install time from
`apps/ui/src/features/annotation/ui/sections/annotation-routes.tsx` and are
fine. I hit that false positive before catching it, and the 2026-09-12 doc
warns about the same trap. Re-check for new `.routes(` contributors before
trusting the result.

To tell a merge drop from main moving ahead, compare against the merge base
rather than main's head:

    git show $(git merge-base HEAD origin/main):platform/app/src/routes.tsx | …

---

## 4. Ops renders with no application chrome

`apps/ui/src/model/ui-route-table.ts:206` opens the chrome layout route
(`page: "features/chrome/UiAppChrome"`); its children are Settings and the
project routes, and it closes at line 750. `// Ops` begins at line 752 — **every
`/ops/*` route sits outside it**, so ops pages draw with no header, sidebar or
settings shell.

On main each ops page framed itself (`pages/ops/index.tsx` renders
`<OpsPageShell><DashboardLayout>`). In the new tree framing is the route
table's job and the ops block was left outside the layout that does it. The fix
is to move the ops block inside `UiAppChrome`'s `children` — but check first
whether the ops screens still self-frame, or they will be framed twice.

---

## 5. Page-load round trips — measured, not addressed

Measured live against the local stack, signing in and loading a project page.

The shell is a strict three-deep serial waterfall, and the session gate is what
makes the first hop serial:

    /api/auth/session  →  organization.getAll  →  effectivePermissions ×2,
                                                  resolveHome, feature flags

On top of that, **feature flags are one HTTP request per flag** — main's
`hooks/useFeatureFlag.ts:126` sets `skipBatch: true`, and each fires as its
component mounts. I counted 7 flag requests arriving in 5 waves on a single
page load.

And on this branch specifically, `organization.getAll` is fetched **three times
per page load**, observed in the browser timeline:

    1155  REQ  organization.getAll            session capability's copy, key ends "anonymous"
    1155  REQ  /api/auth/session
    1156  REQ  organization.getAll?batch=1    navigation chrome's own separate copy
    1179  RES  /api/auth/session              user id arrives
    1182  REQ  organization.getAll            key flips, first abandoned, re-issued

`apps/ui/src/behavior/ui-session-queries.ts:60` puts `userId ?? "anonymous"` in
the query key, so the id landing mid-flight abandons the request and issues an
identical one; `navigation-host.tsx:186` keeps a second, independently-keyed
copy. Main does this once (one call site, shared key) — the 3× is a regression
in the new tree.

Ranked, if someone takes this on:

1. Un-gate `organization.getAll` from the session on main. The cookie is
   already in the document on a refresh; the real problem is that a 401 sits
   forever because `shouldRetryQuery` never replays it. Fix *that* — retry this
   one query once on 401, or key it on the session so it refetches when the
   session lands. Removes a full serial hop.
2. One `shell.bootstrap` procedure returning `{ user, organizations,
   permissions, flags }`. Collapses hops 1–3 into a single round trip. Biggest
   win, biggest change.
3. Batch the flags: `isEnabledForEach(flags[])`, with the shell asking for the
   known set up front. 7 requests in 5 waves → 1.
4. On this branch, the 3× dedup — which is §2's reverted change plus removing
   the chrome's second copy.

---

## 6. Next actions

Sections 3a and 4 are **done and committed**. Section 3b is half done. What is
left, in the order I would take it:

1. **Merge the 4 commits from origin/main.** Three are identity and land in the
   3b area. Everything below ports against a tree this merge moves, so it goes
   first now that the lanes are collected.
2. **Commit `pnpm-lock.yaml`** once whoever owns the `packages/ui-host` lines in
   it is done. Until then `26c5c7cad2`'s dependency is declared but unlocked.
3. **The MFA commit surface** (`modules/identity/{contract,server}`). The long
   pole for `/settings/security`: seven verbs with a guard API and no way to
   commit their facts. Carries its own architecture question - whether MFA facts
   share the identifier ledger or get a stream of their own - which wants deciding
   before the lane starts. Re-scope detail in
   `.claude/manifests/identity-trpc-transport.md`, the STOP banner at the top.
4. **The identifier read model** - one `IdentityApi` member answering every
   identifier on a user with its confirmed state. Smaller than 3, independent of
   it, and it unblocks the Security page's first section.
5. **Then the identity transport**, with `modules/user/contract` in its owned
   paths this time. Not before 4.
6. **`/settings/profile`'s remaining 13 scenarios**: a self-service
   `user.updateName` mutation (4 scenarios; `UserService.updateProfile` already
   exists at `services/user.service.ts:138`), a browser-sessions backend (7; a
   whole feature with nothing behind it - main used
   `personalSessions.listWebSessions`, and the branch's `personalSessions.list` is
   **CLI tokens, a different concept** that must not be reused for it), and a
   confirmed-address read (2). Detail in
   `.claude/handoffs/settings-profile-port.md` sections 11-12.
7. **The identity lookup's remaining 19 scenarios**: the `history` and
   `waiting.proposals` panels per decision 3 above, then its six guarded commands,
   then the operator screen and its `/ops/backoffice/identity-lookup` route. Its
   wiring is also still undone - `identityLookup` is optional on
   `IdentityRepositories` and no backend is constructed yet; detail in that
   lane's handoff section 9.
8. **`/annotations`** - routed nowhere, with a red test about it. Cheapest item
   here.
9. **Widen the destinations test to the settings family**, once 5 and 6 land.
10. **Round trips** (section 5). Untouched and still the biggest user-visible
    win: the three-deep serial waterfall, one HTTP request per feature flag, and
    `organization.getAll` fetched three times per page load on this branch.

## 8. Where the coordinator was wrong, recorded so it is not repeated

Two corrections from this session worth carrying forward.

**I asserted a contract was complete when only half of it was.** Setting up the
identity transport lane I checked that `identity.api.ts` declares the identifier
verbs *and* the MFA verbs, and concluded "the contract is complete; only the
transport declarations are missing". A declared guard API is not a committable
operation: `IdentityCommand` (`facts.ts:370-376`) carries six members, all
identifier verbs, and `mfaGuards()` only computes facts that nothing can stage.
The lane found this by tracing how a procedure would actually wire, which is a
step I skipped. **Reading an interface is not the same as following the call to
where it commits.**

**I scoped a manifest to a transport file and not to the contract that types it.**
`identityTrpc` is defined once, in `modules/user/contract/src/user.trpc.ts:144`,
which I put in neither the owned nor the shared list - so the lane could not
declare a single procedure. When a manifest names a transport, it names the wire
contract too.

Both cost one lane's reading and no wasted code, because the manifest fenced the
completeness claim as a stop condition and the lane honoured it. That is the fence
earning its keep.

## 7. Loose ends

- **PR #8155 is open, unreviewed, and its e2e lane is red on one test** -
  `tests/agentic-e2e/tests/front-door/passkeys.test.ts:46`, "adding a passkey in
  settings, the post-password offer, and the relying party", failed all three
  attempts (57.1s, 1.0m, 58.2s) while 25 others passed. This is **not** a
  timeout: the CI whole-test budget is 120s
  (`tests/agentic-e2e/playwright.config.ts:131`, `IS_CI ? 120000 : 60000`), so
  the test failed an assertion and took 57s doing it. The assertions in the
  failure context are lines 71-74, starting with
  `expect(page.getByTestId("passkeys-settings-section")).toBeVisible()`.
  `e2e-ci` was green on main at 2026-09-15T16:02, which is the PR's own base
  (`51577b8e19`), so this is not inherited.
  Worth taking seriously rather than retrying: #8155 changes exactly when the
  organization graph counts as answered, and a settings page that now waits for
  it would show a loading state where that test expects the section. The PR's
  verification was 6291 component tests and a typecheck - none of which drives a
  real browser to `/settings`. Read the job's trace before re-running it.
  The check named "breaking change stays in one component" shows FAILURE in the
  PR's rollup but PASSES on the newest run; `gh pr checks` deduplicates by name,
  which is why it looks red.
- `.claude/worktrees/shell-notfound-race` still exists, with node_modules and
  generated files. Remove it once the PR merges.
- An untracked `.env.example` sits in that worktree, copied in by the
  post-checkout hook. It is not staged and should not be committed.
- The `apps/ui` suite on this branch fails 46 files / 138 tests *before* any of
  my changes. That is the baseline to measure against, not zero.
