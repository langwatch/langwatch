# Handover — the shell not-found race, and what the main merge did not re-home

Written 2026-09-16. Branch `feat/strict-feature-layout-v0` (working tree),
plus one PR cut from `origin/main`.

Two unrelated threads landed in one session. The first is fixed and shipped.
The second is an audit that corrects a claim I made mid-session; read §3 before
acting on anything I said in conversation.

---

## 0. State, rewritten 2026-09-16 01:0x

This section is the snapshot. Where it contradicts a section below it, it wins.

**Committed since this document was written.** `52814ec2d8` - the
`belongsToNoOrganization` port that section 2 described as applied-but-uncommitted,
plus this document. Its doc comment was cut first: `comment-block-size` now errors
at 6 lines **including** the `/**` and `*/` delimiters, so the budget is 5 and
nothing suppresses it. Verified before committing: the new unit test 4/4,
`typecheck:one @langwatch/navigation-web` clean, oxlint clean on both new files,
no merge or rebase marker, zero unmerged entries. The two remaining
`comment-block-size` errors in `use-landing-redirect.ts` are pre-existing in HEAD
and were left alone.

**The dirty count is not this drive's.** 128 files, belonging to at least three
other live sessions in this shared checkout: a lint-to-zero coordinator with five
comment-sweep lanes (`sdks/typescript`, `modules/{analytics,trace,scenario,gateway}`),
a haven TUI and simulators drive (`tools/thuishaven`, `services/{mailsim,idpsim}`,
`specs/setup/haven-*.feature`), and the request-bounds config work. Commit by
explicit pathspec only, and never `git stash` - the stash stack is global and
`stash@{0}` currently holds another session's mail-sink work.

**The gap to origin/main: 4 commits behind, 2920 ahead**, merge-base
`c5999477f1`. The four are `c2f6eebe1d` (voice) and three identity PRs -
`c87c46d17f` #8143, `118929d09c` #8148, `51577b8e19` #8149 - which land in exactly
the area section 3b says the merge never re-homed. Deliberately not merged while
six lanes and three sessions are live in this checkout; it waits until they are
collected.

**Lanes.** Roster is `.claude/coordinator/LANES.md`; read it, do not trust this
line. At the time of writing: `ui-route-surface-repair` (sonnet) and
`settings-profile-port` (sonnet) active. `.claude/manifests/settings-security-port.md`
is written and waiting - spawn it once the profile lane is collected, not
alongside it: the two share the api seam, the host port and the export surface,
and sequencing them is cheaper than four shared files.

**`apps/ui/src/model/ui-route-table.ts` is now a coordinator-shared file**
(`COORDINATOR.md` section 6). Three lanes wanted an entry in it within one hour.
A lane may hold it exclusively for one slice, and the roster row says so when it
does; otherwise the lines come through handoff section 10.

**A hole nothing else in this document names.**
`apps/ui/src/model/__tests__/navigation-destinations-are-routed.unit.test.ts:66`
reads `Object.values(projectNavItems)` and nothing else. That is why four dead
governance links passed 107 green tests. `governanceNavItems` and
`gatewayNavItems` are both already exported from `@langwatch/navigation-web/chrome`
beside it. The route-surface lane is widening it to those two families and proving
the widening bites; **settings is the next family to add**, and it is deliberately
not in that change because `/settings/profile` and `/settings/security` are
genuinely absent and would turn the suite red for a gap that lane is not fixing.

**Parity numbers for the section 3b work, measured rather than estimated:**

    specs/settings/profile.feature                  0/29 scenarios bound
    specs/identity/authentication-settings.feature  3/27
    specs/settings/change-password-auth0.feature    19/19  (done - leave it)

53 unbound scenarios, which is why section 3b is two lanes and not an afternoon.
Whole-repository parity is FAIL at 1723 unbound; that is not this drive's number.
Filter the tool to one file and read its `N/M` line.

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

Items 1 to 3 of the original list are in flight or decided; what is left:

1. **Collect `ui-route-surface-repair`** - the four governance routes, the ops
   block moved inside `UiAppChrome`, and the destinations test widened. Its
   completion criterion includes proving the widened test fails when a route
   entry is removed, so check that claim rather than the green tick.
2. **Collect `settings-profile-port`**, apply its section-10 route-table line,
   then spawn `.claude/manifests/settings-security-port.md` from its handoff.
   Not alongside it: they share the api seam, the host port and the export
   surface.
3. **`/ops/backoffice/identity-lookup`** (§3b) - the whole feature is absent,
   server and all, with 32 unbound scenarios. Re-read §3b: this is the largest
   item here, not the smallest, and it needs its own lane with a server half.
   Do not fold it into anything.
4. **Widen the destinations test to the settings nav family**, once
   `/settings/profile` and `/settings/security` answer. Until then it would be
   red for a gap nobody is fixing, which is worse than narrow.
5. **Merge the 4 commits from origin/main**, once this checkout is quiet. Three
   of them are identity and land in the section 3b area, so the settings lanes
   are worth finishing first - otherwise they port against a tree the merge is
   about to move.
6. **Round trips** (§5), starting with the 401 retry policy so hop 1 can go.
   Unchanged and still unaddressed.

**The decision taken on 2026-09-16, so no later session re-asks it:** the
`/settings/security` port follows main's arrangement including the
`/settings/authentication` redirect shim, rather than keeping the branch's
pre-rename page. Reason: the branch's standing invariant is wire-compatibility
with main, and every future main merge would otherwise reopen the same
collision. Recorded in `.claude/manifests/settings-security-port.md`.

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
