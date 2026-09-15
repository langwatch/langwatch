# Handover — the shell not-found race, and what the main merge did not re-home

Written 2026-09-16. Branch `feat/strict-feature-layout-v0` (working tree),
plus one PR cut from `origin/main`.

Two unrelated threads landed in one session. The first is fixed and shipped.
The second is an audit that corrects a claim I made mid-session; read §3 before
acting on anything I said in conversation.

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

**Applied.** The same org-less fix, ported to the new tree:
`modules/navigation/web/src/model/belongs-to-no-organization.ts` + 4 unit
tests, wired into `use-landing-redirect.ts`. Package test failures are
identical with and without it (4 files / 11 tests, all pre-existing);
`pnpm typecheck:one @langwatch/navigation-web` clean.

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

All four render the catch-all 404 today. All four are named by
`modules/navigation/web/src/model/section-nav-items.ts` and by the bouncer
exemption list in `modules/auth/web/src/behavior/use-required-session.ts`, so
the product links at them. **The screens were ported; the route-table entries
and page loaders were not.** Fix is four entries in
`apps/ui/src/model/ui-route-table.ts` plus four loaders — unless the answer is
that they were retired on purpose, in which case they want redirects, the way
`/ops/queues` got one. The 2026-09-12 doc asked this same question and nobody
has answered it; it is still the blocking unknown, not the work itself.

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
port. `identity-lookup` has no screen and is not in `BACKOFFICE_RESOURCES`.

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

## 6. Next actions, in the order I would take them

1. **Answer the governance question** (§3a): retired on purpose, or dropped? It
   has been open since 2026-09-12 and it gates four lines of work either way.
2. **Move the ops block inside `UiAppChrome`** (§4). Small, visible, low risk.
3. **Port `/settings/profile` and `/settings/security`** (§3b), reconciling
   with the `/settings/authentication` page the branch still carries.
4. **`/ops/backoffice/identity-lookup`** (§3b) — needs a screen and a
   `BACKOFFICE_RESOURCES` entry.
5. Round trips (§5), starting with the 401 retry policy so hop 1 can go.

## 7. Loose ends

- PR #8155 is open and unreviewed.
- `.claude/worktrees/shell-notfound-race` still exists, with node_modules and
  generated files. Remove it once the PR merges.
- An untracked `.env.example` sits in that worktree, copied in by the
  post-checkout hook. It is not staged and should not be committed.
- The `apps/ui` suite on this branch fails 46 files / 138 tests *before* any of
  my changes. That is the baseline to measure against, not zero.
