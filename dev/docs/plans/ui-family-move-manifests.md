# UI page-family move manifests

**Landed.** Every page family is out of `platform/app`, and `platform/` itself
is deleted (`faaa9ec333`). This file was the per-family dispatch record — 82
route keys across seventeen moves, each with its closure survey, its host-port
seam and its recorded judgment calls. That record is git history now; what
follows is what a reader still needs.

## What the programme produced

- **`apps/ui` is the browser composition root.** It owns the route table as
  data, the page-loader registry, the provider nestings and
  `createUiApplication`. The loader-merge point, the browser transport in
  `src/behavior/`, the session/scope/permission/feedback/navigation
  capabilities and the `catalogue.json` + governed-export gates all landed as
  `b3ae7e8489`, `80f1d1cc3f` and `1a759888de`; the design-system promotions as
  `4ffabc1735`; the destination relayouts as `0958e06039`, `0559f563df` and
  `648ed49987`.
- **Governance was the reference family** (`1a759888de`) and every later move
  copied its shape: screens into the feature's web package, served by apps/ui's
  own feature declaration in `installed-ui-features.ts`, guarded by
  `ui-page-guard` (flags before permissions, nothing refused in flight), fed
  through the package's one host port.
- **The host adapters that shape produced are themselves gone** —
  `268eb2ed83` folded all 36 into their providers as typed object literals and
  replaced the 38 route files' skeleton with one `uiPage()` helper. See
  `install-composition-review-2026-09-03.md`.

## The drawer registry mechanism (current shape, keep)

Every moved family recorded the same open line: a screen asks its host to open
a drawer, the host writes `?drawer.open=<name>`, and nothing opened, because
the mount lived in `platform/app`'s `DashboardLayout` and read a registry of
that application's own modules. Closed on 2026-09-03, and it cost neither of
the two prices earlier entries floated (one `platform/app` insertion, or moving
forty-five drawer components) — what had to move was the registry MECHANISM,
not the drawers nailed to it:

- `@langwatch/ui-drawer` owns the address vocabulary, the navigation stack, the
  complex-prop/flow-callback stores, the lazy registry and `CurrentDrawer` —
  moved whole out of `hooks/useDrawer.ts`, `components/drawerRegistry.ts` and
  `components/CurrentDrawer.tsx`.
- The registry is installed the way page loaders are: a feature publishes
  `{ key: lazyDrawer(...) }` and `installed-ui-drawers.ts` spreads them in.
- `apps/ui/src/features/chrome/ui/sections/ui-app-chrome.tsx` mounts
  `CurrentDrawer` once, above the outlet and outside the shell branch — a
  drawer is addressed by the query string and renders through a portal.

Every name any screen, command-bar entry, host adapter or outbound email
addresses resolves in `installed-ui-drawers.ts`, with four decisions rather
than gaps: `traceV2Details` / `traceDetails` are mounted directly
(`UiTraceDrawerMount`, below `CurrentDrawer`) because their URL-to-store sync
must outlive the `?drawer.open=` parameter; `dashboardName`, `seriesFilters`
and `opsGroupDetail` stay local overlays on their own screens' query keys,
kept because nothing outside those screens links to them.

## The feature `index.ts` composition shape (2026-09-03)

Every `apps/ui/src/features/<name>/index.ts` composes one family the same
way: the screen(s) and host-port types live in the family's own `-web`
package; the application owns the page key(s), the permission/release
policy, the transport (`uiFeatureApi`), and — where the family serves
overlays — the drawer registry (`lazyDrawer`, keyed by the address name).
Each file's docblock now states only what is not this shared shape: which
package, and any genuinely unusual fact (an enterprise-package edge, a
guard placed somewhere non-default). `billing`, `licensing` and `scim` all carry the same "enterprise edge"
finding — `apps/ui` is core, its screen package is enterprise, and the
`enterprise-direction` architecture-lint policy clears once
`packages/enterprise/composition/ui` exists; recorded once here rather
than at every family that carries it.

## Scope resolution: organization / team / project (2026-09-03)

`ui-scope-resolution.ts`'s `resolveUiScope` is a pure-function harvest of
the application's `useOrganizationTeamProject` (770 lines) — same
precedence, same reserved slugs, same stickiness rules, same demo
handling, moved rather than rewritten, since a second answer to "what
project is this page about" is a tenancy bug.

Order of preference, top to bottom:

1. the demo project, when the address names the deployment's demo slug
2. a `?team=` slug that matches a team the caller can see
3. a `:project` slug in the address bar, reserved slugs excluded
4. the same slug carried over from storage, unless it is stale
5. the caller's own personal workspace, on the personal-workspace pages
6. the remembered team, when the caller can still be shown it
7. the ambient team — a shared team the caller is on, project first

Rules worth keeping in mind while touching this file:

- **Stale is dropped, not preferred.** A slug resolved off the persisted
  selection (not the URL) is stickiness, not intent — it must not survive
  onto a personal workspace, a team the chrome now refuses, or any
  project on the personal-workspace pages; the ambient pick below
  re-resolves and re-persists, so the stale selection heals itself. An
  organization admin passes the team-visibility test on their role alone,
  so a project they picked in a team with no membership row stays picked.
  A slug typed into the URL keeps resolving even into a team the caller
  cannot open — the refusal that follows is the honest answer to that.
- **Personal workspace wins before the remembered team, not after** —
  checked first so a stale shared-team id persisted from an earlier
  organization-scoped page never wins on a personal-workspace page.
- **Ambient team ordering**: within the caller's own teams, prefer a
  shared team that already holds a project, then any shared team, then
  whatever is left; personal workspaces sort last, since a solo user's
  only team is personal and would otherwise always win.
- **Writes are guarded**: `uiScopeSelectionWrites` only emits a write when
  the value differs from storage — unguarded, each write's storage event
  re-renders every reader and can wedge a route transition's effect
  cascade against React's nested-update limit.

## Residuals the moves left behind

Small, named, and none of them blocking:

- **`accountMenu()` and `plan().pricingModel`** are still `null` / absent on
  the navigation shell's host port.
- **The home draws no Crisp bubble entry**, for the reason `supportChat()`
  gives at its own declaration.
- **`@langwatch/project-web` publishes two screens with two host ports** —
  `/[project]` and `/settings` — mounted by two frontend features (`home` and
  `project`), which is why its name appears twice in the transport list.
  Intentional, recorded so nobody reads it as duplication.
- **The `./install` export per web package** (loaders + drawers as one object,
  folding `installed-ui-drawers.ts` into the list) is option J in
  `composition-simplification-options.md`. It needs the governed-package fork
  decision and is much smaller after the api-map lane.
