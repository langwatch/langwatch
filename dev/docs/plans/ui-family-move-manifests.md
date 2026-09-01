# UI page-family move manifests

Distilled from the 2026-09-01 closure survey (governance, gateway, me,
automations), taken under the deletes-only ruling: platform/app may only
shrink, so "repoint the platform consumer" is never an option — a shared
component is either promoted to a package first or the moving family takes
its own copy and the platform copy dies later with its remaining consumers.

## The gate every family shares

`apps/ui` is a library, not an application: no index.html, no vite config,
no entry. Its router/shell (`ui-router.ts`, `ui-route-objects.tsx`,
`createUiApplication`) is real but instantiated only by platform's
`LegacyUiShellAdapter`, which supplies the single loader registry and all
provider slots. Before ANY family moves:

1. **Loader merge point** in apps/ui (own registry consulted before the
   host's; deleting a family's platform keys otherwise throws at boot in
   `resolveUiPageLoader`). One-time change; single-owner file.
2. **Browser transport in apps/ui** — `src/behavior/` (exempt from the
   browser-capability import ban; `src/features/*` may import neither
   `@trpc/*`, `@tanstack/react-query`, `react-router`, `better-auth` nor
   `@langwatch/platform-api-client`). A second client sharing the host
   QueryClient keeps one cache (tRPC keys on procedure path alone; only
   HTTP batching splits).
3. **Session/org/permission + feedback + navigation + document-title
   capabilities** — none exist in apps/ui; every family consumes
   `withPermissionGuard`/`withFeatureFlagGuard`, `useOrganizationTeamProject`,
   toaster + `~/features/errors`, and the next-router compat shim.
4. **Catalogue + governed exports** — each family needs an entry in
   `apps/ui/src/features/catalogue.json` and `screens/*`/`surfaces/*`
   subpath exports on its web package; all four destination packages are
   ADR-004-non-compliant today (root-export-only, flat or `src/components`).

Status 2026-09-01: items 1–3 landed as `b3ae7e8489` (loader merge
own-wins, behavior/ transport with verified module identity, capability
ports; session/activeScope harvest in flight as its own slice).
Design-system promotions landed as `4ffabc1735` (nine groups;
HoverableBigText refused — needs a render-prop seam). Destination
relayouts landed: ops-web `0958e06039`, gateway-web + governance-web
`0559f563df`, automation-web `648ed49987`.

Governance moved first, and it is the reference every later family
copies. What it added on top of the four gates, all of it reusable:

- `apps/ui` self-installs. `src/features/installed-ui-features.ts` is the
  standing declaration (loaders, feature-api Providers, the feedback
  capability, `useBrowserUiSession`); the package entry's
  `createUiApplication` merges a host's install over it, and
  `platform/app`'s shell adapter passes nothing and was not edited.
- Two capability ports were added to `ui-capabilities`: `UiRoutePort`
  (path parameters, the query string, and a whole-query write) and the
  tri-state `featureFlag` plus `isSettled` on `UiSessionPort`, which a
  page guard needs and a screen deliberately does not get.
- `ui/sections/ui-page-guard` carries the policy the two platform
  higher-order components carried: flags before permissions, and nothing
  refused while an answer is still arriving.
- `BrowserUiFeedback` is a real feedback capability over the Design
  System toaster with a four-code copy table. The full presentation
  registry harvest is still owed.
- A feature-web package answers the application through ONE port it
  declares itself (`model/governance-host.ts`), adapted in the frontend
  feature. That is what lets eight thousand lines of screen move with
  their `api.x.y.useQuery` call sites unchanged.

Gateway moved second and changed none of it, which is the point: the second
family cost a host port, a procedure map, a routes section and a `testing.tsx`,
and nothing in `apps/ui`'s global layer. Two shapes it added that a third family
should copy rather than reinvent:

- The package owns its own `vitest.setup.ts` — jest-dom plus the two browser
  APIs jsdom lacks — so a suite of thirty-five files that mounts Chakra overlays
  states them once. Governance patched them inside its render helper, which
  only reaches the tests that use it.
- A screen that used to open an application drawer keeps its OWN query key and
  renders the editor inline (`?policy=<id>`), rather than carrying a copy of the
  drawer registry. The registry is composition; a screen only ever needed the
  address.

Known costs, all reported rather than suppressed: the governed screen
closure rejects `@langwatch/platform-api-client` (one import, in
`behavior/governance-api.ts`, which is what buys the content-faithful
move), a web-to-web surface import (authz-web, coding-agent-web — the
same finding prompt-web already carries for workflow-web), the package's
root `.` export, which ~6 non-governance `platform/app` files still
import and deletes-only forbids repointing, and `enterprise-direction`:
`apps/ui` is a core package and cannot depend on an enterprise one. The
last is structural and blocks the gateway family too — it wants an
enterprise UI composition the way `packages/enterprise/composition/api`
serves the server side.

## Family facts (keys = legacy-page-loaders.ts entries to DELETE)

### governance — MOVED. 11 keys, ~20 prod files + 15 tests, ~8.3k page LOC (largest)

- Pages under `pages/governance/`; `inventory.enterprise.tsx` is 3,431 lines
  and exports `SourceEditDrawer` used by `ingestion-source-detail` — move together.
- Exclusive: `components/governance/*` EXCEPT `AdminViewingAsBanner.tsx`
  (chrome: `DashboardPageBody` imports it — DO NOT move); plus
  `components/settings/governance/{AiToolEntryDrawer,ToolCatalogEditor,IngestionTemplatesEditor}`,
  `components/settings/DepartmentEditDrawer`, `components/enterprise/EnterpriseLockedSurface`.
- Hard problem: `pages/governance/index.tsx` imports `~/server/api/rbac`
  (baseline-suppressed); apps/ui bans `~/server` — permission-key type must
  come from a contract package.
- Destination `@langwatch/enterprise-governance-web` exists, needs full
  ADR-004 restructure. Route rows: `/governance/*` + 8 redirect rows already
  in the apps/ui table.

### gateway — MOVED. 11 keys (10 screens + one redirect row), 38 prod files + 27 tests

Moved second, copying the governance shape file for file: one host port
(`model/gateway-host.ts`), one hand-written procedure map
(`behavior/gateway-api.ts`), the same `withUiPageGuard` in front of the same
loader registry, and the same `testing.tsx` harness underneath the suites.

What actually happened, against what was surveyed:

- The exclusive closure held. `components/gateway/*` except ConfirmDialog (8
  non-gateway platform files import it, so it stays and the family takes the
  Design System's), all of `components/webhooks/`,
  `components/settings/governance/routingPolicies/` and `hooks/useRollingWindow`
  all moved. The 14 baseline lines they held — nine filed under `governance`,
  five under `webhook` — are gone; `legacy-feature-fragment` drops 429 → 387.
- `/gateway` is a redirect row in the route table, not a screen. The loader
  registry serves ten keys; the eleventh was a component whose whole body was a
  `router.replace`.
- The prisma blocker resolved in the contract:
  `@langwatch/gateway-contract` now exports `GatewayGuardrailDirection` and
  `GatewayGuardrailFailureMode` off the schemas it already had, and the
  guardrails screen names those instead of the generated client.
- The drawer-registry blocker resolved by NOT carrying a package copy of the
  registry. `RoutingPolicyDrawer` takes an `onClose` prop, the screen keeps the
  policy in its own query string (`?policy=<id>`) and renders the editor inline;
  platform's registered copy is deleted, its registry entry with it. The spec
  asks that the address carry the policy, which it still does.
- `VirtualKeyUsageSnippet` drags shiki. It does NOT drag openai: the survey's
  `openai` import was the word inside the Python and TypeScript snippets the
  component prints.
- `RoutingPolicyRowActions` moved OUT of `@langwatch/enterprise-governance-web`
  and into gateway-web with the rest of routing policies — its only consumer.

Known costs, all reported rather than suppressed:

- Three manifest-level findings from one import. `gateway-webhooks.screen`
  renders `ContactSalesBlock` from `@langwatch/enterprise-billing-web`, so a
  core package now names an enterprise one: `enterprise-direction` +
  `cross-feature` + `ui-screen-closure`. The alternative was copying
  `ENTERPRISE_PLAN_FEATURES` — the commercial plan catalogue — into a core
  package, where it would drift. This is the enterprise UI composition the gate
  section already names as missing.
- 16 `ui-screen-closure` findings: 14 for `@langwatch/authz-web/surfaces/scope-picker`
  (the same finding governance carries), one for `@langwatch/platform-api-client`
  in the procedure map, one for billing-web above.
- One `ui-web-public-entry` for the package's root `.` export, which six
  `platform/app` files under `components/me` and `pages/me` still import for
  `formatBudgetUsd`; deletes-only forbids repointing them.
- ONE TEST DELETED RATHER THAN MOVED, and it is the only coverage this move
  loses: `server/gateway/__tests__/eligibleModelProviders.parity.integration.test.ts`
  drove the browser's `resolveEligible` and the server's
  `scopeReachableModelProvidersForVk` off the same Postgres rows. The browser
  half is now in a package that may not import Prisma, and the server half is
  still `platform/app`, which may not gain a file. Four of its six scenarios are
  bound elsewhere; two are now unbound — "The drawer and the gateway agree on
  which providers are routable" and "A scope-reachable provider can be allowed
  on a key even when the routing policy omits it". The parity test returns when
  `scopeResolver` moves into `@langwatch/gateway-server`, which may import
  `@langwatch/gateway-web`.
- `runtime/ui/__tests__/legacy-page-loaders.unit.test.ts` was already red from
  the governance move (11 keys the platform registry no longer serves); this
  move takes it to 21. Teaching it that `apps/ui` serves some keys itself is an
  insertion in a `platform/app` file.

### me — MOVED. 7 keys (5 personal + 2 project-scoped), 37 prod files + 14 tests

Moved third, and the widening the survey recommended was taken:
`/:project/sessions` and `/:project/pull-requests` came with the family, because
their whole page bodies were its tables and leaving them behind would have meant
two platform pages importing a package this move had just created. They are
children of `features/langy/ProjectLangyLayout`, a layout route `platform/app`
still serves, and nothing had to change for that — `createUiRouteObjects`
resolves a child's page key through the same merged registry as a top-level one.

Three destinations rather than one, which is what makes this family different
from the first two:

- **`@langwatch/user-web`** gains `screens/personal-workspace` and becomes the
  third governed web package. It was three flat files; it is now the ADR-004
  layout with all seven screens, the host port, the procedure map, and the
  package-owned `vitest.setup.ts` the gateway family introduced.
- **`@langwatch/coding-agent-web`** takes the coding-agent presentation the
  survey named — both tables, the pull-request detail drawer, the session row
  and toolbar, the replay hook — plus a NARROW port of its own
  (`CodingAgentActivityHostPort`: one permission, the address, two notices) and
  its own procedure map. It stays UNGOVERNED and flat, which is deliberate: its
  root entry is imported by six `platform/app` trace-explorer files and by a
  server-side test, so governing it would cost a full relayout plus a permanent
  `ui-web-public-entry`, and `apps/ui` may not import an ungoverned package. Its
  new surface is a second entry, `./activity`, so the root entry keeps its
  transport-free import graph.
- **`@langwatch/gateway-web`** gains `surfaces/budget-overview` — the budget
  list, the exceeded banner, `spentSubline` and `formatBudgetUsd`. A surface
  rather than a screen because the screens that render them belong to another
  feature. The banner's two contact links became plain anchors: a surface
  renders inside another feature's page and cannot ask a host of its own.

What that costs at the composition seam, and it is the one shape a fourth family
should expect to copy: `apps/ui`'s `personal-workspace` feature registers TWO
api bindings, not one. `codingAgentApi` reaches it through
`@langwatch/user-web`'s screen entry, which names it on the shell's behalf,
because the shell may not import the package that owns it.

Hazards, as they actually resolved:

- `PersonalRecentTracesTable` is now a PLACEHOLDER that renders the integrate
  pitch and never the ten rows. `@langwatch/trace-web` publishes the explorer's
  stores and formatters, not its table, and the six deep imports into
  `features/traces-v2` had no other home. THE ONE FEATURE LOSS OF THIS MOVE.
- `AvatarUploadControl`'s `useSession()` became `host.currentUser()` plus one
  new port action, `refreshSession()`, answered in `apps/ui` by invalidating the
  session query. It is the only action on the port that is neither a navigation
  nor a notice, and it exists because writing a photo has to stop the header
  showing the old one.
- The terminal replay keeps writing `drawer.open=traceV2Details` and the
  pull-request detail moved to its OWN query key (`?pullRequest=<host>|<repo>|<n>`,
  rendered inline), the gateway routing-policy answer. `setQueryParams` merges
  rather than replacing, which is what leaves a pull request standing under a
  replay opened from it. KNOWN GAP: `traceV2Details` is registered in
  `platform/app` and mounted by `DashboardPageBody`, so on a screen served from
  `apps/ui` the address changes and nothing opens until a chrome layout route
  exists — the same chrome gap `GatewayLayout` and `GovernanceLayout` state.
- `usePersonalContext` lost its `switcher` field with `useWorkspaceData` and
  `WorkspaceSwitcher`: nothing read it. Its session and scope reads are the
  host's.
- `MyLayout`'s `lastVisitedHomeKind` write is landing policy and a browser-storage
  write, so it did not travel: `apps/ui/src/behavior/ui-home-kind.ts` writes it
  for the five `/me` keys and neither project one.
- The tiles name `@langwatch/enterprise-governance-contract` rather than the
  enterprise WEB package — the contract carries `AiToolEntry`, `AiToolType` and
  the config envelope, so only six lucide tool glyphs needed a local copy. That
  is five fewer findings than the direct web import, and it removed the portal's
  `as unknown as` cast.
- `InstallCliCard`, `NoDataInfoBlock`, `PeriodSelector` (controlled half only),
  `CostBreakdownTooltipContent`, `UserAvatar`, `useReducedMotion`,
  `formatTimeAgoCompact`, `docsUrl` and the API-keys path all came over as
  family-local copies. `ListTable`, `Pagination`, `PageLayout`, `Drawer`,
  `Dialog`, `Checkbox`, `GitHubIcon` and `formatCost`/`formatTokens` came from
  the Design System instead — the last two through
  `@langwatch/design-system/display-formatters`, which is what
  `@langwatch/trace-web` was re-exporting anyway.
- `Markdown` did not travel. `ToolMarkdown` is `react-markdown` plus GFM, which
  is what a tool description ever needed; the application's version carries an
  image proxy, a code renderer and a router.

Known costs, all reported rather than suppressed:

- THREE SCENARIOS LOST, all from
  `specs/ai-governance/personal-portal/connect-your-agent-button.feature`, and
  they are lost because the FEATURE is: the "Explore via Langy" entry is gone
  from the Connect-your-agent menu. `askLangy` and `useCanAskLangy` are
  application state a feature-web package may not reach, `@langwatch/langy-web`
  is an ungoverned web package `apps/ui` may not import either, and there is no
  assistant capability to answer with. The menu offers the prompt and the guide,
  and the test that used to bind the three-route scenario is deliberately
  untagged rather than tagged to a scenario it no longer proves.
- 20 new architecture-lint findings, every one an import: 15
  `ui-screen-closure` (8 for `@langwatch/coding-agent-web`, 5 for the gateway
  budget surface, one each for `@langwatch/platform-api-client` and
  `@langwatch/handled-error`), 3 `cross-feature` package edges, one
  `enterprise-direction` for the governance CONTRACT, and one
  `ui-web-public-entry` for `@langwatch/user-web`'s root `.` export.
- That root export exists for ONE caller and is the reason it was kept: the
  avatar test in `platform/app` drives `processAvatarImage` against the
  application's code-keyed presentation registry, and the registry has not
  moved. Moving the test would have cost a fifth scenario; keeping it cost a
  finding and zero platform edits.
- `@langwatch/gateway-web`'s root `.` export now has NO importer anywhere — the
  six `platform/app` files that forced the gateway family to keep it were this
  family's, and they are gone. Deleting it is a one-line follow-up that belongs
  to whoever owns gateway-web.
- Two test fixtures were repaired rather than moved verbatim, and both were
  already wrong: `meConnectYourAgent` handed `team.createdAt` where the hook has
  read `createdAtMs` since the personal context grew its DTO, so every render in
  that file threw, and the same file rendered five pages without ever calling
  `cleanup`.

### automations — 5 keys (all → ONE module), 25 prod files + ~16 tests

- Page `pages/[project]/automations.tsx` (965 L) + entire
  `features/automations/` subtree (exclusive) + `components/automations/FilterDisplay`
  (leaks to analytics `GraphFilterIndicator` — cheap copy).
- STRUCTURAL GATE: its five routes are children of the platform-served
  `features/langy/ProjectLangyLayout` layout key — either that layout also
  serves from apps/ui or the loader-merge design must let an apps/ui page
  be a child of a host-served layout route. Resolve before dispatch.
- Hard blockers: `~/server/filters/types` + generated prisma client in the
  closure (both banned — contract types first); `AutomationDrawer`/`ViewAutomationDrawer`
  are registered in platform's drawerRegistry (copies, not deletions);
  13 openDrawer call sites; `QueryFilterInput` reaches traces-v2 SearchBar.
- Destination `@langwatch/automation-web` relaid out in `648ed49987`; the
  near-duplicate premise was FALSE — platform's `features/automations/`
  subtree holds no stale copies; every same-named platform file is a shim
  or app adapter importing the package (draftReducer binds the package's
  draft model to app provider clients; the slack registry is a documented
  re-export). The family move is therefore adapters+page, cheaper than
  surveyed. Four package modules have their only tests in platform
  (report-schedule, daily-cap-advice, firing-rate,
  liquid-json-substitution) — those tests move into the package with the
  family.
- The loader-parity unit test pins all five keys to one module via a
  `sharing` table — those rows delete with the keys.

## Cross-family collisions (settle before dispatching pairs)

| Component                                       | Families           | Resolution                                                                                                                                                     |
| ----------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway/ConfirmDialog`                         | gateway+governance | design-system `./confirm-dialog` (LANDED; the platform copy stays for its eight non-gateway consumers)                                                         |
| `me/InstallCliCard`                             | me+governance      | each took its own copy (governance's is `ui/elements/install-cli-card`; me's is `ui/blocks/install-cli-card`)                                                  |
| `modelProviders/iconsMap`                       | me+gateway         | gateway drew ten locally; me took only the Design System's five marks and falls back to the generic model mark for the rest, on the legacy `iconKey` path only |
| `ui/{ListTable,Pagination}`                     | me+governance      | design-system (`./list-table`, `./pagination`) — LANDED for both                                                                                               |
| `settings/{ScopeChipPicker,ProviderScopeChips}` | gateway+governance | `@langwatch/authz-web/surfaces/scope-picker` (landed with governance; gateway consumed it unchanged, 14 findings)                                              |
| traces-v2 deep imports                          | me+automations     | me shipped a PLACEHOLDER and recorded the gap; `@langwatch/trace-web` has no table surface to consume. automations undecided                                   |

## Single-owner files (serialize)

- `apps/ui/src/ui/sections/ui-application.tsx` + the loader-merge module —
  host-capability agent only, then frozen as reference.
- `packages/architecture-lint/src/frontend-ui-boundaries.ts` — only if a
  new source root is ever added; prefer not.
- `apps/ui/src/features/catalogue.json`, `legacy-page-loaders.ts` (+ its
  unit test), `legacy-feature-fragment-baseline.json` (gateway owned the lines
  filed under governance for routingPolicies and took them; me deleted the two
  `[project]` page-shell rows its keys took), `apps/ui/src/features/installed-ui-features.ts`
  (+ `tests/installed-ui-features.unit.test.ts`), `pnpm-lock.yaml` —
  coordinator split-stages; one family commit at a time.
- `apps/ui/src/behavior/ui-scope-resolution.ts` — me widened one union member
  (`lastVisitedHomeKind` now takes `"personal"` as well as `"project"`) so a
  `/me` page can leave the marker `MyLayout` used to write.

## The third family's own additions, for whoever moves the fourth

- A THIRD host port of the same shape (`PersonalWorkspaceHostPort`). The comment
  on `GatewayHostPort` said a third repeat is the signal to promote them, and it
  is: `scope/organization/project/currentUser/hasPermission/isFeatureEnabled/route/
setQuery/navigate/succeeded/failed` is now written out three times. Promotion
  is a change to three packages and was deliberately not smuggled into a page
  move.
- The first use of the `documentTitle` capability. `platform/app` set titles with
  a `<Head><title>` inside each page body; the gateway and governance families
  dropped theirs silently. The personal family carries the title as data on the
  route map and sets it INSIDE the guard, so a page that turns out not to exist
  never renames the tab. It is a local HOC in the feature until a second family
  wants it.
- A screen family that answers a SECOND package's port. `@langwatch/user-web`
  adapts its own host into `@langwatch/coding-agent-web`'s narrower one and
  mounts it around the four screens that render a table. That is what an
  ungoverned package's presentation costs, and it is cheaper than governing it.
