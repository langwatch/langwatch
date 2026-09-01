# UI page-family move manifests

Distilled from the 2026-09-01 closure survey (governance, gateway, me,
automations, ops), taken under the deletes-only ruling: platform/app may only
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

All five families have now moved. `@langwatch/ops-web` is the fifth and last
governed web package of the pilot, and the ops move closed every blocker the
ops relayout recorded as insurmountable: the browser transport, the session
gate, the feedback capability, the page guard and `PageLayout` all exist.

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

### automations — MOVED. 5 keys (all → ONE screen), 23 prod files + 20 tests

Moved fourth, and it is the first family whose move BREAKS `platform/app`
rather than only shrinking it. Everything else follows the gateway shape file
for file: one host port (`model/automation-host.ts`), one hand-written
procedure map (`behavior/automation-api.ts`), the router/session/feedback
re-bindings, the same `withUiPageGuard` in front of the same loader registry,
a `testing.tsx` harness and a package-owned `vitest.setup.ts`.

Destination `@langwatch/automation-web`, extended rather than relaid out:
`screens/automations` is the new public entry, the app adapters and the five
delivery providers join `features/authoring`, and `liquid-editor`,
`slack-templates` and `overview` gained the feature entries `authoring` now
imports them through (declared in `features/authoring/feature.json`).

What actually happened, against what was surveyed:

- The near-duplicate premise was FALSE, as the survey already corrected: every
  same-named platform file was a shim or an app adapter, so the move is
  adapters + page and no stale copy had to be reconciled.
- The four package modules whose only tests were in platform — report-schedule,
  daily-cap-advice, firing-rate, liquid-json-substitution — came home with them.
- The screen takes its TAB AS A PROP. `platform/app` matched the pathname to
  decide which of the four tabs to show; the route table gives each address its
  own page key, so `apps/ui` maps a key to a tab and the screen never reads the
  address to learn what the router already knew. That is why the host port has
  no `pathname` and why five keys point at one loader.
- `FilterDisplay` came over as a package copy (analytics still renders the
  platform one), and its triple-nested value flattening was lifted into a
  helper rather than added to the `max-depth` debt register, which may only
  shrink.

The prisma and `~/server` blockers resolved without a contract change:
`TriggerAction` came from `@langwatch/automation-contract` instead of the
generated client, and the only `~/server/filters/types` import was a test's
`FilterField` type, which left with the structured-filter editor below.

WHAT PLATFORM/APP LOSES, AND IT IS NOT ONLY DELETIONS. `AutomationDrawer` and
`ViewAutomationDrawer` are the family's own, so they moved, and the three
drawer-registry entries that named them (`automation`, `viewAutomation` and the
`editAutomationFilter` alias kept for links in inboxes) are deleted with them.
Unlike the gateway's routing-policy drawer, these had SIX non-family callers,
and deletes-only forbids repointing them: `traces-v2`'s Automate button, the
command bar's "new automation" action, `FieldsFilters`' Add Automation button,
`GraphCardHeader`'s bell (twice) and the custom-analytics page (twice). Those
seven call sites now fail to typecheck — `Argument of type '"automation"' is
not assignable` — and are LEFT BROKEN under the migration-is-not-gradual
ruling. They close when those four surfaces move, or when a cross-feature
overlay capability exists.

Hazards, as they actually resolved:

- **The trace-query autocomplete is a plain textarea.** `QueryFilterInput`
  reached four ways into `features/traces-v2`'s SearchBar;
  `@langwatch/trace-web` publishes the suggestion ENGINE
  (`getSuggestionState`) and no surface that renders it, and copying another
  feature's dropdown was ruled out. The query still edits, the example chips
  still seed it and the live matched-trace count still follows it — but there
  is no field/value completion and no syntax-help drawer. THE ONE FEATURE LOSS
  of this move, and the same shape as the me family's recent-traces
  placeholder. `ConditionBuilder` did NOT need the copy: it only ever called
  the ranking helpers with an empty query, so it reads `FIELD_NAMES`,
  `FIELD_VALUES` and `SEARCH_FIELDS` off `@langwatch/trace-contract` directly.
- **Creating a dataset from inside the drawer is gone**, and with it the whole
  sub-flow (`state/subFlow.ts`, its two tests and the drawer's keep-the-draft
  branch). `openDrawer("addOrEditDataset")` is another feature's overlay; a
  host-port action could write the address but nothing would open, because the
  chrome layout route that mounts `CurrentDrawer` does not exist yet — the same
  gap the me family recorded for `traceV2Details`. Picking an existing dataset
  is untouched.
- **The legacy structured-filter editor is read-only.**
  `components/filters/FieldsFilters` imports `~/server/api/root`,
  `~/server/filters/registry` and `~/server/analytics/utils`; a browser package
  may name none of them. A legacy automation shows its stored conditions
  through `FilterDisplay` and a Clear conditions button, which is the action the
  copy already told the reader to take.
- **The Langy context targets are gone from the rows.** `@langwatch/langy-web`
  is ungoverned and every consumer compiles its source, which needs an `es2023`
  library and a stylesheet declaration `apps/ui` would have had to adopt
  globally. Same loss the me family took on its Langy menu entry.
- `explainAnyError` did not travel: the attempt log takes the host's one-line
  description instead of asking whether a code carried registered copy, which
  is the property the log was after and needs no registry.
- **The annotation-queue spoof guard has no server-side test.** The web
  roundtrip case asserting the schema strips `createdByUserId` was deleted as
  false — the schema deliberately declares the field; the real guarantee is
  `automation.api.ts`'s unconditional session stamp, and the api-trpc transport
  has no test harness yet to pin it.
- The `@langwatch/automation-web` root `.` export was DELETED rather than kept:
  the move left it with no importer anywhere, so governing the package cost no
  `ui-web-public-entry` finding at all. (`@langwatch/gateway-web`'s is still
  owed.)

Known costs, all reported rather than suppressed:

- 7 platform typecheck errors in 5 files, listed above. The whole-tree
  `pnpm typecheck` is 12 errors against a 5-error baseline.
- 2 new architecture-lint findings, both `ui-screen-closure`: the procedure
  map's `@langwatch/platform-api-client` (the same one governance, gateway and
  user-web carry) and `template-authoring.tsx`'s `popup.location.replace`,
  which is a FALSE POSITIVE — it navigates the Block Kit Builder popup the
  component itself opened, not the application.
- 10 of 21 scenario bindings lost, all four scenarios from
  `specs/automations/authoring-drawer.feature` that describe machinery this
  move removes: "Creating a dataset from the automation is offered and works",
  "Leaving the dataset drawer without creating keeps the dataset already
  chosen", "An abandoned sub-flow does not seed the next automation" and "A
  link issued before the drawer changed still opens the automation". The tests
  that replaced them are DELIBERATELY UNTAGGED rather than bound to a scenario
  they no longer prove.
- ONE RED TEST INHERITED, not caused: `provider-roundtrip.unit.test.ts` asserts
  that `annotationQueueActionParamsSchema` strips a client-supplied
  `createdByUserId`. The schema declares the field
  (`packages/features/automation/contract/src/providers/annotation-queue.ts:8`),
  so it is kept, and the test failed in `platform/app`'s unit lane too. The
  guarantee it names is real and lives in the router, which force-stamps the
  field from the session
  (`packages/features/automation/server/src/transport/api-trpc/automation.api.ts:1008`).
  Left red rather than rewritten: which of the two should change is a security
  question, not a page move's.

### ops — MOVED. 19 keys (13 workspace + 6 backoffice), 95 prod files + 9 tests

Moved fifth, and the largest: 13,646 deletions out of `platform/app` against
automations' 12,348. It is also the family whose destination package had already
been relaid out for it (`0958e06039`), which changes the shape of the work
entirely — 41 of the 65 closure files were already in `@langwatch/ops-web`, and
almost every platform file was a thin app adapter over a package view. The move
is adapters plus pages, exactly as the automations survey predicted for a
package that already owns its presentation.

Every blocker the relayout commit named as insurmountable is gone, and none of
them needed anything invented for this family: the transport is
`behavior/ops-api.ts` over `createFeatureApi`, the admin gate is the session
capability, the toaster and the error registry are `BrowserUiFeedback`, and the
page chrome is the route tree's.

What actually happened, against what was surveyed:

- **The admin gate is two session grants, not a probe and a query.**
  `platform/app` asked a live `ops.getScope` for the workspace and a separate
  `user.isAdmin` for the Backoffice, decoupled on purpose so that widening
  operator access could never widen the Backoffice. Both facts are already
  platform-tier permissions in the authz registry (`ops.actions =
  ["view","manage"]`, `scopes: ["platform"]`), so the host answers
  `hasOpsAccess()` from `ops:view` and `isOpsAdmin()` from `ops:manage`, the two
  page guards ask for those, and the decoupling is now PROVED rather than
  documented — `tests/ops-page-policy.integration.test.tsx` mounts every
  Backoffice resource under `ops:view` alone and asserts the refusal.
- **Six Backoffice addresses collapse to one screen**, the automations
  tab-as-prop shape taken a second time: `BackofficeShell` plus six three-line
  page files becomes `ops-backoffice.screen.tsx` with a `resource` prop. 19 keys,
  14 loaders.
- **All six drawer-registry entries are deleted**, and unlike automations this
  one costs almost nothing: five of the six had only family callers, so each
  overlay keeps its own query key on the page that opens it
  (`?payloadStore=`, `?replay=`, `?group=<queue>|<id>`, `?processes=`,
  `?processInstance=<process>|<tenant>|<key>`), addressed through a shared
  `behavior/ops-overlays.ts`. The retired `/ops/projections` redirect pins
  `replay=open` instead of `drawer.open=opsReplay`, so a saved link still lands
  with the wizard open.
- The event-sourcing rail moved as the family's own `ui/sections/event-sourcing-layout.tsx`,
  harvested from `SectionNavigationFrame` — the gateway precedent, third use.
- `useOpsPermission` STAYS in `platform/app`: the navigation menu and the
  command bar read it, and deletes-only forbids repointing them. The package has
  its own reading of the same fact off the host, under the same name and the same
  `{ hasAccess, scope, isLoading }` shape, so no call site changed.

Hazards, as they actually resolved:

- **THE DASHBOARD NO LONGER STREAMS.** `ops.dashboardStream` is a tRPC
  SUBSCRIPTION and `apps/ui`'s transport declares none — the host routes those
  over a WebSocket it configures from its own environment. The page always takes
  the fallback it already had, `ops.getDashboardSnapshot` on a five-second poll,
  and the connection indicator reports the poll rather than claiming a socket.
  THE ONE FEATURE LOSS OF THIS MOVE, and the only one: every other surface came
  over whole. It closes when `apps/ui` gains a subscription lane.
- **The Foundry drawer is gone with its registry entry.** Its only opener was
  the command bar's "open the Foundry" action, which is not this family's, so
  `features/ops/foundry-drawer.transport.tsx` was deleted rather than moved. The
  `/ops/foundry` PAGE is untouched; `selectHandlers.ts:105` fails to typecheck
  and is left broken under the not-gradual ruling.
- The house dialog is not the Design System dialog. `platform/app`'s
  `DialogRoot` sets `trapFocus={false}`, and the impersonation dialog's
  `initialFocusEl` only lands on the reason input with the trap off — importing
  the Design System's root directly moved focus to the dialog container, which
  the focus-on-open scenario caught. `ui/elements/ops-dialog.tsx` takes the two
  props and nothing else.
- `PinnedAwareJsonView` came over as a family-local copy: `@langwatch/trace-web`
  publishes the explorer's stores and formatters, not its viewer, and two
  platform files still render the original. `useShikiAdapter` did NOT need a
  copy — it is `@langwatch/design-system/shiki`, which is what `trace-web` was
  re-exporting.
- The four Prisma enums the Backoffice forms offer (`PlanTypes`,
  `SubscriptionStatus`, `Currency`, `PricingModel`) are restated in
  `features/backoffice/model/backoffice-enums.ts` rather than taken from
  `@langwatch/enterprise-billing-contract`. Three of them ARE in that contract,
  and taking them would have put the commercial plan catalogue on the import
  graph of every open-source build of the Ops workspace — `enterprise-direction`
  is structural. The contract makes the same promise about its own copy ("Values
  must stay aligned with Prisma enums").
- `mutationOutcome` became a HOOK (`behavior/ops-mutation-outcome.ts`): the
  toaster and the error toast are the host's now, and a host is read through
  context. Every caller was already a hook, so the call sites moved one line up
  and no handler body changed.
- `keepPreviousData` is a local identity function, the gateway's answer to the
  same import.

Known costs, all reported rather than suppressed:

- 8 new architecture-lint findings, every one attributed: `platform-api-client`
  in the procedure map (the exception all four earlier families carry), the
  Backoffice's `@tanstack/react-query` and `@langwatch/feature-flag-web` (which
  is also the one new oxlint line, and the same web-to-web class governance
  carries for authz-web), the Foundry's `localStorage` preset store — browser
  state with no capability to answer it — the package's root `.` export, and the
  two impersonation-banner surface lines. The last two are the relayout's
  prediction, unchanged: 22 `platform/app` files still import `Kbd` and
  `ImpersonationBanner` off the root entry, and the banner's own `fetch` plus
  `window.location.href` cannot move behind a prop while its only consumers are
  platform chrome that may not gain one.
- ONE PLATFORM TYPECHECK ERROR ADDED, the Foundry drawer key above. The
  whole-tree count is 14: 7 automations-drawer, 6 pre-existing (the stated
  baseline of 5 undercounts by one — `vitest.browser.config.ts`), 1 this move's.
- ONE PLATFORM ASSERTION DELETED, and it is a line rather than a case:
  `legacy-page-loaders.unit.test.ts` asserted the registry holds more than 100
  loaders, and it holds 83. The route-table half of the same non-vacuity guard
  stays, as does the test that every registered key is reachable. The retired
  `/ops/projections` redirect case was deleted whole — it asserted the old
  `drawer.open=opsReplay` pin and carried no `@scenario`.
- THREE RED TESTS INHERITED, not caused, and proved so:
  `FeatureFlagsContent.scopeCopy` was already 3/3 red at HEAD in `platform/app`
  (verified by running it there before deletion). Its fixture omitted
  `families`, so every render threw on `catalogue.families.length`; the fixture
  is repaired here, which turns the crash into what it was hiding — three copy
  assertions the shared `@langwatch/feature-flag-web` catalogue view no longer
  satisfies. The copy the test pins ("customers get the value set here") exists
  nowhere in the repo since `3727210dc9` moved the view into that package. Which
  of the two should change is a product-copy question in another feature's
  package, not a page move's.
- Scenario bindings 22 → 24, none lost: every moved test kept its annotations,
  and the two new ones bind the replay overlay's address to two scenarios added
  to `specs/ops/ops-dashboard-density.feature`. Three more were added to
  `packages/features/ops/specs/admin.feature` for the two-tier gate and bound in
  `apps/ui`.

## The fifth family's own additions, for whoever governs the next package

- The first family whose destination package was RELAID OUT FIRST, as its own
  commit, months before the move. It is the cheapest shape by a distance: the
  reconciliation step that dominated automations did not exist, because every
  same-named file was provably an adapter. Whoever moves a family into a package
  that already owns presentation should relayout first and move second.
- The first host port with TWO access answers rather than one permission, and
  the reason is worth keeping: a page family whose surfaces are gated at two
  different tiers must model both, or the narrower one silently widens.
- The first family to address FIVE overlays by query key in one move, through a
  shared `useOpsOverlay(key)` rather than five hand-written pairs. The helper is
  fifty lines and it is what made deleting six registry entries cheap.
- A package-local dialog wrapper is sometimes load-bearing. `platform/app`'s
  `components/ui/*` are not always re-exports of the Design System, and the
  difference can be a behaviour a scenario pins. Diff them before substituting.

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
  `[project]` page-shell rows its keys took; automations deleted 27, the whole
  `features/automations/` inventory plus the page), `components/drawerRegistry.ts`
  (automations deleted three entries; gateway and me one each),
  `apps/ui/src/features/installed-ui-features.ts`
  (+ `tests/installed-ui-features.unit.test.ts`), `pnpm-lock.yaml` —
  coordinator split-stages; one family commit at a time.
- `apps/ui/src/behavior/ui-scope-resolution.ts` — me widened one union member
  (`lastVisitedHomeKind` now takes `"personal"` as well as `"project"`) so a
  `/me` page can leave the marker `MyLayout` used to write.

## The fourth family's own additions, for whoever moves the fifth

- A FOURTH host port of the same shape (`AutomationHostPort`). The promotion
  signal has now fired twice and been deferred twice, for the same reason both
  times: it is a change to four packages a page move does not own.
- The first family to be told which VIEW it is showing rather than reading the
  address for it. Five page keys, one screen, one prop. Any family whose tabs
  are separate URLs should copy this instead of matching a pathname, and it is
  why this port has no `pathname` at all.
- The first family to add PRIVATE FEATURE ENTRIES to its destination package.
  `authoring` composes three sibling features, so each gained an `index.ts` and
  `authoring/feature.json` names them. `ui-web-feature-deep-import` is what
  catches the alternative, and it fired fourteen times before the entries
  existed.
- The first family whose move leaves `platform/app` RED. Six non-family
  surfaces opened its drawers; the gateway's and the me family's had none.
  Whoever moves a family whose overlays are shared should count the callers
  BEFORE assuming the registry entry is a pure deletion.
- A destination package needs a triple-slash reference for any ambient module
  declaration its own source relies on (`?raw`, `*.css`). Workspace packages
  resolve to each other's SOURCE, so a consumer compiles those imports with no
  way to reach a `.d.ts` that only the owner's `include` covers.

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
