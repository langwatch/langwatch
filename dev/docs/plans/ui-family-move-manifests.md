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

| Component                                       | Families                    | Resolution                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway/ConfirmDialog`                         | gateway+governance          | design-system `./confirm-dialog` (LANDED; the platform copy stays for its eight non-gateway consumers)                                                                                                                                                                                                                                                                       |
| `me/InstallCliCard`                             | me+governance               | each took its own copy (governance's is `ui/elements/install-cli-card`; me's is `ui/blocks/install-cli-card`)                                                                                                                                                                                                                                                                |
| `modelProviders/iconsMap`                       | me+gateway                  | gateway drew ten locally; me took only the Design System's five marks and falls back to the generic model mark for the rest, on the legacy `iconKey` path only                                                                                                                                                                                                               |
| `ui/{ListTable,Pagination}`                     | me+governance               | design-system (`./list-table`, `./pagination`) — LANDED for both                                                                                                                                                                                                                                                                                                             |
| `settings/{ScopeChipPicker,ProviderScopeChips}` | gateway+governance          | `@langwatch/authz-web/surfaces/scope-picker` (landed with governance; gateway consumed it unchanged, 14 findings)                                                                                                                                                                                                                                                            |
| `settings/ScopeFilter` + `useUrlScopeFilter`    | data-retention+data-privacy | the SAME surface (`@langwatch/authz-web/surfaces/scope-picker`), component and pure address half both. Free, because every consumer of one already imports the other and `ui-screen-closure` counts import LINES. The platform copies stay for model-providers, api-keys and default-models                                                                                  |
| traces-v2 deep imports                          | me+automations+annotations  | me shipped a PLACEHOLDER and recorded the gap; `@langwatch/trace-web` has no table surface to consume. automations undecided. ANNOTATIONS DREW THE LINE: a placeholder is right for a widget and wrong for a page whose whole subject is the thing being placeheld — the queue walker stayed in `platform/app` rather than lose its conversation view, and moves with traces |

## Single-owner files (serialize)

- `apps/ui/src/ui/sections/ui-application.tsx` + the loader-merge module —
  host-capability agent only, then frozen as reference.
- `packages/architecture-lint/src/frontend-ui-boundaries.ts` — only if a
  new source root is ever added; prefer not.
- `apps/ui/src/ui/sections/ui-settings-layout.tsx` + `model/ui-settings-menu.ts`
  - `behavior/ui-organization-facts.ts` — the settings-chrome harvest, landed
    with S5. Additive only from here: a settings family imports
    `withUiSettingsLayout` and changes neither.
- `apps/ui/src/behavior/ui-feedback.ts` + `ui-capabilities.ts`'s
  `UiFailureNotice` — the credentials family added an optional `description` so a
  refusal the SCREEN decided, or one whose code the registry does not list yet,
  reads as itself rather than as the generic line. The registry still wins over
  it. Additive only; the harvest that removes the need for it is still owed.
- `apps/ui/src/features/catalogue.json`, `legacy-page-loaders.ts` (+ its
  unit test), `legacy-feature-fragment-baseline.json` (gateway owned the lines
  filed under governance for routingPolicies and took them; me deleted the two
  `[project]` page-shell rows its keys took; automations deleted 27, the whole
  `features/automations/` inventory plus the page; datasets deleted six — its two
  pages under both the `dataset` and the `project` feature, plus the bulk upload
  drawer and the replicate dialog; prompts deleted 39 and LEFT 41, because the
  prompt form and its fields are what every other prompt surface in the product
  imports), `components/drawerRegistry.ts`
  (automations deleted three entries; gateway and me one each; datasets and
  prompts touched none — their overlays were never registry entries),
  `apps/ui/src/features/installed-ui-features.ts`
  (+ `tests/installed-ui-features.unit.test.ts`), `pnpm-lock.yaml` —
  coordinator split-stages; one family commit at a time.
- `pnpm-lock.yaml` again, from the other direction: datasets HAND-EDITED it to
  add three dependencies rather than running `pnpm install`, because the file
  already carried another lane's uncommitted additions and a real install would
  have rewritten all of them. `pnpm install --frozen-lockfile --filter "<pkg>..."`
  validates the edit without writing, and creates the links.
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

### agents — MOVED. 1 key, 2 prod files + 1 test (the whole family)

Moved sixth, and the cheapest by a wide margin: `platform/app` loses 4 files and
712 lines against ops' 13,646, and the whole platform side was ONE adapter and
its test. `@langwatch/agent-web` already owned the list page, the card, the
history drawer and the type selector, was already governed and already declared
in `apps/ui`'s catalogue, and `apps/ui` already carried the browser port adapter.

What the estimate missed: the adapter was 100% adapter, but it rendered THREE
generic application dialogs — `CascadeArchiveDialog`, `ReplicateToProjectDialog`
and `PushToCopiesDialog` — each with non-Agents callers (the evaluator and
prompt push wrappers, the monitor copy dialog, the Agent list drawer). Deletes-only
forbids repointing those, so the family took narrowed copies:
`agent-archive-dialog`, `agent-replicate-dialog` and `agent-push-dialog` under
`features/management/ui/blocks`. Each lost the toaster and the logger it reached
for directly — a feature-web package may reach neither — so the outcome is handed
back to the screen and the screen tells the host.

Two shapes a seventh family should copy rather than reinvent:

- **The by-path dispatcher is a GLOBAL, not a package's.**
  `AgentBrowserPort` names eleven procedures as strings, which is what let the
  whole family move without eleven hand-written map entries. Building the client
  that dispatches them means holding the tRPC client and the QueryClient, and
  ADR-004 seals both off from `apps/ui/src/features/*` — so the first attempt put
  it in `@langwatch/agent-web` and bought three `ui-screen-closure` findings for
  it. It belongs in `apps/ui/src/behavior/ui-rpc.ts` instead:
  `UiFeatureShell` has both halves already, mounts one `BrowserUiRpc` beside the
  capability ports, and a feature asks for it with `useUiRpc()`. Net cost of the
  family: ONE new architecture-lint finding, the `@langwatch/platform-api-client`
  import in the procedure map that every family carries.
- **`useProjectsForCopy` did not need `~/server/api/rbac`.**
  `@langwatch/authz-contract` publishes `permissionSatisfiedBy`,
  `roleKeyForTeamRole` and `builtinRoleGrants`, and its own docblock says they are
  parity-tested against the two rbac functions the platform hook imported. The
  replication picker's per-team answer is rebuilt over them in
  `apps/ui/src/features/agent/model/agent-copy-targets.ts`, with the empty-custom-role
  fallthrough and the no-membership-means-no-projects rule intact. Settings S2 RBAC
  and governance both list that rbac import as a gate; for a picker, it is not one.

Overlays, and this is the family's whole drawer story:

- `agentHistory` was a pure deletion. Its lazy factory imported the platform
  adapter itself and the agents page was its only opener, so the registry entry
  and the module die together. The screen addresses the drawer with its own
  `?history=<agentId>` and renders it inline, the gateway shape.
- The type selector is the screen's too, at `?new=agent`.
- THE THREE EDITORS ARE NOT, and this is the move's one recorded gap.
  `agentCodeEditor`, `agentHttpEditor` and `agentWorkflowEditor` stay registered
  in `platform/app` — the scenario editor, the experiments workbench, the
  agent-testing dialog and the Agent list drawer all still open them, and their
  closures reach `~/optimization_studio`, `~/components/suites` and the
  application's own variables surface. The screen names the drawer and the host
  writes `?drawer.open=…&drawer.agentId=…`, the same address
  `agent-platform-url.ts` and Langy's deep links already produce, INCLUDING
  `openDrawer`'s clearing of every stale `drawer.*` key. Nothing mounts that
  registry above a screen served from `apps/ui` until the chrome layout route
  exists, so creating or editing an agent from this page writes the right address
  and opens nothing. Same gap the me family recorded for `traceV2Details` and
  automations recorded for `addOrEditDataset`; it closes with the same work.

Known costs, all reported rather than suppressed:

- **The Langy context chip is gone from the agent cards.** The adapter wrapped
  each card in `LangyContextTarget` with `agentContextChip`; `@langwatch/langy-web`
  is ungoverned and `apps/ui` may not import it. The same loss the me and
  automations families took.
- ONE new architecture-lint finding (783 → 784), the procedure map's
  `@langwatch/platform-api-client`.
- `@langwatch/ui`'s `RpcClientPort` and `TrpcAgentBrowserAdapter` root exports
  were deleted: `platform/app`'s adapter was their only importer, and the port
  itself moved to the global layer as `UiRpcPort`. The adapter stays a private
  feature module.
- The screen entry lost seven exports that only the deleted adapter imported —
  `AgentCard`, `AgentHistoryDrawer`, `AgentManagementPage` with its five ports and
  `getAgentEditorDrawer`. They are internal to the package now. What stays public
  is what `platform/app`'s HTTP editor and type-selector drawers still import.

### settings S5 data governance — MOVED. 2 keys (not 4), 13 platform files, 0 insertions, 2,967 deletions

Moved seventh, and the first SETTINGS family — which is the whole point of it.
Every `pages/settings/*` page wraps `SettingsLayout`, a feature-web package can
own neither host chrome nor `apps/ui`, and until this move nothing above a
package-served page framed it. The harvest is the structural addition; the two
screens are ordinary.

**THE SURVEY'S FOUR KEYS ARE TWO.** The re-ranking row counted
`pages/settings/{data-retention,data-privacy,topic-clustering,email-suppressions}`
as one family because a reader would call them all "data governance". Ownership
disagrees, and ownership is what a move follows:

- `topic-clustering` reads `@langwatch/topic-contract` and calls `api.topicClustering.*`.
  It is the TOPIC feature's page, and `packages/features/topic` has no web
  package at all. Moving it would mean creating one for a page that shares
  nothing with these two.
- `email-suppressions` calls `api.emailSuppression.*`, whose transport is
  `packages/features/automation/server/src/transport/api-trpc/email-suppression.api.ts`.
  It is the AUTOMATION feature's page, and that family already moved — its
  destination `@langwatch/automation-web` exists and is governed. It is a
  ride-along for whoever next touches automations, not this family's.

Both are recorded here rather than forced, and the effort estimate was right for
the two that remain.

Two destination packages rather than one, which is what makes this family look
bigger than its key count: `@langwatch/data-retention-web` and
`@langwatch/data-privacy-web` are separate features with separate contracts, so
there are two host ports, two procedure maps, two `apps/ui` features and two
catalogue entries. They travel together because they are one family to a reader
— what LangWatch keeps, and who may read it.

#### The SettingsLayout harvest

`apps/ui/src/ui/sections/ui-settings-layout.tsx` is `SettingsLayout`'s
collapsible menu and content frame, copied. `platform/app`'s copy stays for its
remaining twenty settings pages and dies with the last of them.

- **The menu is DATA**, in `apps/ui/src/model/ui-settings-menu.ts`, because the
  harvest's whole risk is a silently dropped link and a list is assertable in a
  way a tree of JSX is not. `tests/ui-settings-menu.unit.test.ts` pins every
  address under every gate; dropping one entry fails two cases.
- **An entry is an href, not a loader.** The twenty addresses `platform/app`
  still serves are unchanged and its router still answers them, so the menu is
  complete regardless of which half of the product renders the page behind it.
  Nothing about the harvest couples the menu to the migration.
- **Four gates, four answers, none of them invented.** `hasPermission` and both
  operator grants come off `UiSessionPort` (`ops:view` opens the workspace,
  `ops:manage` the Backoffice — the ops family's decoupling, restated). The plan
  tier, the `EXTERNAL` membership role and `IS_SAAS` are NOT permissions, so
  they are read in `apps/ui/src/behavior/ui-organization-facts.ts` over the
  application's own transport, under `trpcQueryKey` — `limits.getUsage` lands on
  the same cache entry as the application's `useActivePlan`, and the
  organization graph is the one the shell already holds. A feature could not do
  this for itself: `@tanstack/react-query` is sealed off from `src/features/*`.
- **`DashboardLayout` does not travel**, and that is the same chrome gap every
  family since the gateway has recorded: 738 lines of header, product menu,
  command bar, Langy dock and drawer registry. This layout frames the settings
  content and nothing above it.
- **The navigation-v2 branch does not travel either.** `SettingsLayout` stands
  its own menu down when the v2 shell is active because that shell carries a
  richer settings menu (`features/navigation/useSettingsMenu.ts`, 410 lines). No
  v2 shell exists above a page served from `apps/ui`, so the harvested menu
  always renders — and harvesting the v2 menu is navigation's move.
- **The chrome goes OUTSIDE the guard.** `withPermissionGuard({ layoutComponent })`
  wrapped its own refusal in the layout, so a reader who lacks the grant still
  sees the settings frame they navigated into. Getting this backwards is
  invisible until someone is refused; `tests/data-governance-page-policy.integration.test.tsx`
  mounts a refusal and reads the menu out of it.
- **`settings-page-chrome.unit.test.ts` HAD to move with the first settings
  family.** It read each `/settings` page key's source out of
  `platform/app/src/pages/settings`, so two keys that are now a package screen
  and an `apps/ui` loader made it fail for pages that are in fact framed. The
  invariant spans two source trees now, so it is stated where the route table is
  — `apps/ui/tests/settings-page-chrome.unit.test.ts` — and each key is checked
  against whichever half serves it. Its `@scenario` binding travels intact.
  WHOEVER MOVES THE NEXT SETTINGS FAMILY inherits a guard that already knows how
  to answer for both halves and needs no further edits.

#### The two contract moves, and why they are restatements

`RetentionPolicySnapshot` and `DataPrivacySnapshot` are the shapes the two pages
render, and both are declared in `platform/app/src/server`, which a browser
package may not reach. The obvious move — put the type in the contract and
repoint the read model — is FORBIDDEN by the deletes-only ruling: repointing an
import in `platform/app` is an insertion.

So both are DECLARED in their feature's contract
(`data-retention.snapshot.ts`, `data-privacy.snapshot.ts`) and the platform read
model keeps its own identical copy until it moves into its feature's server
package. The docblocks say so, and name the alignment obligation — the same
promise `@langwatch/enterprise-billing-contract` makes about its Prisma enum
copies. Whoever moves those read models deletes the platform copies and the two
files stop being restatements.

`PLATFORM_DEFAULT_RETENTION_DAYS` moved for real, and it is smaller than it
looks: the platform module already resolved to the production constant in the
browser (`typeof process === "undefined"` — vite substitutes only enumerated
`process.env.<KEY>` reads, and a bare `process.env` threw at module load), so
the contract's `49` is exactly the value every browser surface has rendered. The
dev-only `LANGWATCH_DEFAULT_RETENTION_DAYS` override is server-side and stays.

#### What actually happened, against what was surveyed

- **`ScopeFilter` went to `@langwatch/authz-web/surfaces/scope-picker`, not into
  two family-local copies.** Both screens need it, both already import that
  surface for `ScopeChipPicker`, and `ui-screen-closure` is counted PER IMPORT
  LINE — so adding it to a surface both screens already name cost ZERO extra
  findings, against ~200 duplicated lines for the copy-each approach. Its pure
  half (`scope-filter-address.ts`: the `?scope=` contract, `resolveScopeFilter`,
  `isScopeInFilter`) travels with it, harvested from `useUrlScopeFilter` and
  `~/utils/filterProvidersByScope`, both of which keep three non-family callers
  in `platform/app`. THE COLLISION TABLE'S ANSWER FOR A SHARED SETTINGS CONTROL
  IS NOW "THE SURFACE ITS SIBLING ALREADY LIVES IN", not "a copy each".
- **The scope filter reads the address instead of mirroring it.**
  `useUrlScopeFilter` kept a `useState` synced to `?scope=` by an effect. The
  screens read `host.route().query.scope` directly and write through
  `setQuery`. Every value the hook could hold survives the round trip (a
  "This Team" pick is written and read back as `TEAM:<id>`, and both render the
  same label and resolve the same way), so the mirror only ever risked
  disagreeing with the URL.
- **`dataPrivacyRule` was a pure registry deletion.** The page was its only
  opener, so the entry, its lazy factory and
  `components/settings/DataPrivacyRuleDrawer.tsx` — the URL shell that rebuilt
  the drawer from `drawer.*` params — die together. The screen addresses it with
  `?rule=new` / `?rule=<tier>:<id>:<personal>`, the gateway shape, third use.
  The spec's four scenarios still bind; its comment block, which named
  `drawer.open`, was corrected to describe the address rather than a parameter.
- **Both root `.` exports were DELETED**, and this family paid nothing for it:
  the only importers of either package were the two pages and three tests, all
  of which moved. Neither package carries a `ui-web-public-entry` finding.
- **The privacy drawer takes a `scopePicker` RENDER PROP**, copying its sibling
  `AddOverrideDrawer`, which already had one. One import of the authz surface per
  package rather than two, and the drawer stays free of scope vocabulary it does
  not own.
- **`isSafeRegex` came over as a family-local copy** (`model/data-privacy-patterns.ts`):
  `~/utils/safeRegex` has six non-family callers. The over-broad secret probe is
  `@langwatch/redaction`'s own and is imported directly, which is the one closure
  finding below that is not shared with an earlier family.
- **The team is DERIVED, not asked.** `UiActiveScope` carries the organization
  and the project; both pages also need the team, for "This Team" and for the
  cascade. Retention takes it out of the organization graph its provider already
  reads; privacy takes it off its own snapshot, where a project row carries its
  team. Neither adds a query.

#### Hazards, as they actually resolved

- **`UiFeedbackPort` HAS TWO LEVELS AND `toaster` HAD FOUR.** The amber
  "Saved 7 of 9 updates" line and the blue "Applying retention to existing data…"
  line are both success-lane notices now. The words are unchanged and the error
  toast beside the first still says something failed; only the colour is gone.
  Widening the capability is a change to a port every family shares, and a page
  move is not where that belongs. THE FIRST RECORDED COST OF THE TWO-LEVEL
  FEEDBACK PORT — the four families before this one happened to need only two.
- **The design system's `Drawer` is not `~/components/ui/drawer`.** The platform
  wrapper adds the Langy dodge and an inline error boundary; a package may reach
  for neither. Ten package drawers already made this substitution, so it is
  precedent rather than a decision, but it is a behaviour difference and the ops
  family's warning stands: diff before substituting.
- **`isPlatformAdmin` is on the HOST PORT, not the procedure map, and it is not a
  permission.** Only a platform administrator may turn retention off; that is an
  email allowlist, and folding it into an organization grant would widen it. The
  first host port to answer a capability question that the authz registry
  deliberately does not model.
- **THE PII LABEL PARITY TEST WAS REBUILT, NOT MOVED, AND IT LOST TWO PINS.**
  `piiEntityLabels.unit.test.ts` pinned the two label maps against
  `ESSENTIAL_PII_ENTITIES` and `PRESIDIO_STRICT_ENTITIES`, both in
  `platform/app/src/server`. The rebuild uses `@langwatch/redaction`'s
  `REDACTION_MARKER_ENTITIES`, which is the union of the analyzer list with the
  one native-only identifier, so coverage is pinned MORE completely than before
  — but the two assertions naming WHICH SIDE of the essential/strict split each
  entity falls on, and the one naming the Brazilian CPF as native-only, are gone.
  They return when the two engine lists move into `@langwatch/redaction`.

#### Known costs, all reported rather than suppressed

- 7 new architecture-lint findings (784 → 790, and one pre-existing
  `legacy-feature-fragment` for the data-privacy page retired): two
  `cross-feature` package edges for `@langwatch/authz-web` — the same edge
  governance and gateway already carry — and five `ui-screen-closure`: the
  `@langwatch/platform-api-client` import in each procedure map (the exception
  every family carries), one `@langwatch/authz-web/surfaces/scope-picker` per
  screen (the same class governance carries fourteen of), and
  `@langwatch/redaction` in the privacy patterns module, which is this family's
  own and is what keeps the form's over-broad verdict identical to the
  pipeline's.
- ZERO new `platform/app` typecheck errors. Nothing outside the family imported
  either page, either web package's root export, or the deleted drawer registry
  entry, so the deletions break nothing — the first family since the gateway to
  leave `platform/app` no redder than it found it.
- The `legacy-feature-fragment-baseline` row for the retention page and two
  `legacy-application-boundary-baseline` entries were deleted with their files;
  a stale baseline entry is itself a finding.
- `specs/data-retention/retention-policy-configuration.feature` GRADUATED OUT OF
  `LEGACY_INERT`: it had 18 untagged scenarios and enforced nothing, and six
  tagged `@integration` scenarios describing what the page itself does now bind
  to the screen suite. Removing the file from the inert list in
  `check-feature-parity.ts` is a pure deletion, which the ruling allows. The
  other 18 describe server resolution and are left untagged rather than bound to
  tests that do not prove them.

#### The seventh family's own additions, for whoever moves the eighth

- **Settings chrome exists now.** `withUiSettingsLayout` is one import and one
  wrapper, outside the guard and inside the host. A settings family costs a host
  port, a procedure map, a routes section and that one line.
- **Check feature OWNERSHIP before accepting a survey's key grouping.** Two of
  the four keys belonged to other features, and the tell was one import each —
  the contract the page names and the package its procedures are mounted from.
  A key belongs to the family that owns its transport, not to the section of the
  menu it appears under.
- **A shared settings control belongs in the surface its sibling already lives
  in.** `ui-screen-closure` counts import LINES, so adding a name to a surface
  every consumer already imports is free, and a second family-local copy is not.
- **A source-reading guard in `platform/app` is a migration hazard, and the fix
  is to move it rather than to leave it red.** `settings-page-chrome.unit.test.ts`
  read page source off disk; the first settings move broke two of its cases for
  pages that were still framed. Whoever moves a family should grep the tests that
  read `platform/app/src/<their keys>` BEFORE deleting anything.

### datasets — MOVED. 2 keys, 10 platform files, 0 insertions, 2,743 deletions

Moved eighth, and the first family whose PAGE was cheap and whose CLOSURE was
not. The two page files are 599 lines between them; what the survey's "6+6" did
not count is that the detail page renders `DatasetEditorTable`, a 937-line
spreadsheet with four non-Datasets callers (the workflow dataset node, the prompt
demonstrations modal, the upload drawer and the add-record drawer). Deletes-only
forbids repointing those, so the editor and everything under it travelled as
NARROWED family-local copies while the platform originals stayed for their other
consumers.

**Relayout first.** `@langwatch/dataset-web` was flat by topic (`editor/`,
`upload/`, `slug/`, `picker/`, `dropzone/`, `records/`) and is now the two-scope
layout — 12 modules to `model`, 5 to `behavior`, 9 to `ui/elements`, 3 to
`ui/blocks`, and the new sections and screens on top. Every move was a pure `mv`
plus an import rewrite; the suite was 79 tests before and 79 after, which is what
made it safe to do in one step. **The React context went to `model`, not
`behavior`**, and that is the load-bearing call: `ui/elements` may import `model`
and may NOT import `behavior`, and six element modules read `useDatasetTable()`.
A context is a portable value, so `model` is also where it belongs.

**The root export STAYS.** ~20 `platform/app` files import
`@langwatch/dataset-web` — the upload drawer, the workbench, the studio's dataset
modal, the prompt demonstrations — and deletes-only forbids repointing any of
them. It costs exactly one finding (`ui-web-public-entry`), the same one ops-web
and user-web carry, and it is the reason the relayout had to keep `src/index.ts`
serving every name it served before.

#### The contract DTO, and the bug it uncovered

The survey's "one AppRouter type → contract DTO" is
`inferRouterOutputs<AppRouter>["dataset"]["getAll"][number]` in the list page.
It resolves to `DatasetSummary`, which `@langwatch/dataset-contract` already
publishes and `listDatasets` already returns, so this was a REAL move rather than
a restatement: the screen names the contract type and the inference is gone.

Following it through found a live defect. `datasetDisplayRecordCount` read the
postgres-layout count off `_count.datasetRecords`, and the repository's `list`
projects that number onto `recordCount` and drops `_count` — so **the datasets
list has been rendering 0 entries for every postgres-layout dataset** since the
router moved into the package. Both platform tests that covered it built `_count`
fixtures the wire never produces, which is why nothing caught it. The contract
function now reads `_count.datasetRecords ?? recordCount`, one line in a package
the ruling allows repointing, with its own unit test; the moved screen test
builds a real `DatasetSummary`. Recorded rather than smuggled: this is a
behaviour change the move made, and it is the only one.

`platform/app/src/runtime/app/internal-api/__tests__/dataset.getAll.integration.test.ts`
still asserts `found._count.datasetRecords`, which the composed router cannot
return. It is a datastore-lane test this family did not touch and could not run;
whoever owns dataset counts should look at it.

#### What the deps cost, and how to add one without an install

Four third-party libraries the platform files used are not dataset-web's:
`react-feather` (→ `lucide-react`, which the Design System already uses),
`motion` (→ the confirm-columns section mounts and unmounts outright; the
animation is the one recorded visual loss), `react-papaparse` (→ a native input
over `papaparse`, which the package already had) and `react-hook-form` +
`@hookform/resolvers` (→ plain state; the resolver's three rules are now one
`describeProblems` function a test asserts on). Only `@dnd-kit/core`,
`@dnd-kit/utilities` and `@langwatch/platform-api-client` were added.

**The lockfile is hand-editable and the edit is verifiable.** CI installs with
`--frozen-lockfile`, and `pnpm install` rewrites the whole file, which is not
safe while another lane's additions sit uncommitted in it. Copy the exact
peer-suffixed `version:` string from another importer, insert the lines in
alphabetical order, then run
`pnpm install --frozen-lockfile --filter "<pkg>..."`: frozen mode never writes,
so it validates the edit AND creates the `node_modules` links, and "Lockfile is
up to date" is the proof.

#### Overlays, and why this family touched no drawer entry

The re-ranking said "touches NO drawer entries" and it was right, but not for the
reason it looks like. `addOrEditDataset` IS a registered drawer — the list page
simply never used the registry, it imported the component and drove it with
`useDisclosure`. So all four overlays (add-or-edit, bulk upload, replicate,
delete) are the screen's own state, the registry entry stays untouched for the
workbench and the studio, and there is **no chrome gap to record** — the first
family since the gateway with none.

`useDeleteDatasetConfirmation` RETURNED A COMPONENT, which the house rules
forbid. It died in the move: the dataset being deleted is the screen's own state
and `DeleteDatasetDialog` is just a dialog.

#### The eighth family's own additions, for whoever moves the ninth

- **A SIXTH host port of the same shape.** The signal has now fired and been
  deferred six times. Two questions this one asks that none before it did:
  `isLiteMember()`, because the `EXTERNAL` membership role is a column rather
  than a grant and `hasPermission` cannot answer it (`apps/ui`'s
  `useUiOrganizationFacts` already reads it for the settings menu); and
  `isReportedGlobally()`, which is a RECORDED GAP answered `false`.
- **A recorded gap should stay ON the port, answered honestly.** The datasets
  page asked `isHandledByGlobalHandler` before toasting, so a refusal the
  application already showed as a modal was not also toasted. That answer is a
  `WeakSet` four interceptors on `platform/app`'s MutationCache write to, and
  that cache does not wrap the client `apps/ui` builds. Guessing a code list
  would have been a fabrication; the adapter returns `false` with the reason
  written down, and the unit test pins it so the day those interceptors move to
  the transport, the test is what says so.
- **A toast ACTION is how an undo travels without widening the feedback port.**
  `UiSuccessNotice` carries a title and a description and no action. The undoable
  delete needed a button, and widening a shared capability is a change a page
  move does not own — so the package's own `DatasetSuccessNotice` carries an
  optional `undo`, and the frontend feature renders it on the Design System
  toaster's `action` trigger. Everything without an undo still goes through the
  capability, so the code-keyed copy still decides the words.
- **A replication picker can FILTER rather than grey.** The Agents family lists a
  project the reader may not create in and disables the row; the datasets dialog
  is a plain select with nowhere to put the explanation, so it leaves the row out
  — which is what the platform dialog did. Both read the same
  `@langwatch/authz-contract` rules; neither needed `~/server/api/rbac`. That
  import is now off the gate list for a picker twice over.
- **Two keys can carry two different policies, and asserting only one is how you
  miss it.** The list page was `withPermissionGuard("datasets:view")`; the detail
  page was wrapped in NO guard and read `hasPermission` only to decide whether to
  offer the experiment hand-off. A ninth family should check each key's page
  separately rather than assuming a family has one grant — inventing a guard for
  the detail page would have broken every deep link into a dataset.
- **Narrowing a copy is the cheapest part of taking one.** `DatasetEditorTable`
  lost its in-memory mode, its imperative controller and six embedding flags; the
  add-or-edit drawer lost the workbench's column-visibility props, the upload
  step's locked-columns prop and the record re-mapping branch that reached
  `@langwatch/workflow-web`. That last one is why this family's closure carries
  no web-to-web import: the branch is unreachable from either screen.

Known costs, all reported rather than suppressed:

- THREE new architecture-lint findings, 790 to 793: `ui-web-public-entry` for the
  root export (20 platform importers, un-repointable), `ui-screen-closure` for
  `behavior/dataset-api.ts`'s `@langwatch/platform-api-client` (the line every
  family carries), and `ui-screen-closure` for `behavior/direct-upload.ts` using
  `fetch` directly. The last is real: the presigned upload and the normalize
  retry are HTTP calls to non-tRPC endpoints, and `direct-upload.ts` is also
  imported by `platform/app`'s upload drawer through the root export, so putting
  it behind a host port would break a caller deletes-only forbids touching. It
  closes when that drawer moves.
- **`SetupWithAgentButton` is gone from the empty state.** It is 367 lines of
  `platform/app` chrome reaching Langy, and `apps/ui` may not import
  `@langwatch/langy-web`. The same loss the me, automations and agents families
  took for the Langy context chip — which this family also loses, from the
  dataset rows.
- The bulk upload drawer's confirm-columns section no longer animates open.
- `NoDataInfoBlock`, `SelectionActionBar`, `HorizontalFormControl`,
  `ExternalImage`, `CopyButton` and the type-to-confirm delete dialog all became
  family-local copies. Every one has non-Datasets callers in `platform/app`;
  three of them (`NoDataInfoBlock`, `ExternalImage`, `SelectionActionBar`) are
  promotion candidates for the Design System and were left alone rather than
  promoted inside a page move.

### settings S4 model config — MOVED. 2 keys, 15 platform files, 0 insertions, 3,728 deletions

Moved ninth, and the second settings family — which is what the seventh one was
for: the chrome is `withUiSettingsLayout`, one import and one wrapper, and this
move changed nothing about it. What this family adds is the first `apps/ui`
answer to "the drawer stays behind" for a family with THREE of them.

`@langwatch/model-provider-web` is created here, the eleventh governed web
package, two-scope from birth (`model/` · `behavior/` · `ui/` · `screens/`) with
its own `package.json`, `tsconfig`, `vitest.config.ts`, `vitest.setup.ts` and
`testing.tsx`. It holds both screens, the cascade, the provider catalogue, the
scope-filter fan, the connection-test hook, the provider marks and the model chip
— 72 tests in 8 files where `platform/app` had 6 files.

#### The three drawers that did not travel, and what the screens do instead

This is the family's whole overlay story, and it is the FIRST to keep a drawer it
could have deleted:

- **`editModelProvider`** has a non-family opener (`EvaluatorTypeSelectorContent`
  writes its address), and its closure is the provider form, the Codex device
  sign-in and the custom-model editor. Stays registered; the screen names it.
- **`llmModelCost`** has a non-family opener too — `UnmappedCostSuggestion` in a
  trace links straight to `/settings/model-costs?drawer.open=llmModelCost`.
  Stays registered; the screen names it.
- **`defaultModelOverride` HAS NO OTHER OPENER AND STILL STAYS.** Deleting it
  would mean moving `DefaultModelOverrideDrawer` (812 lines, 4 test files) plus
  `ProviderModelSelector`, which `SimulationModelSelect` also renders — so the
  registry entry survives with zero openers in `platform/app` and is reachable by
  address alone. THE FIRST DELIBERATELY ORPHANED REGISTRY ENTRY. It is not a
  regression relative to the other two: all three are the same chrome gap.

`ModelProviderHostPort.openPlatformDrawer` is the shape, and it improves on the
agents family's `openAgentEditor` in one way worth copying: `params` are the
DRAWER'S OWN names, unprefixed, and the ADAPTER owns the `drawer.` vocabulary
plus the clearing of every stale `drawer.*` key. A screen that has to write
`drawer.editingId` knows one thing too many about the host.

Same recorded gap as agents, me, automations and the gateway: nothing mounts the
registry above a screen served from `apps/ui` until the chrome layout route
exists, so the address is right and the drawer does not open yet.

#### The contract move is a REAL repoint, and it found a live defect

The survey's "server types the pages infer from AppRouter" is
`RouterOutputs["modelProvider"]["listAllForProjectForFrontend"][number]`, read
through `useAllModelProvidersList`. The producer is PACKAGED
(`@langwatch/model-provider-server`'s tRPC transport), so the ruling allows the
real fix rather than a restatement: `ModelProviderListEntry` is declared in
`@langwatch/model-provider-contract` and `toLegacyProvider` is ANNOTATED with it.
Twelve inserted lines in a package, and both halves are now checked against one
declaration. `getDefaultModelsForProject` and `llmModelCost.getAllForProject`
needed nothing at all — they already answer `ModelDefaultSnapshot` and
`ModelCost[]`.

Writing that declaration is what surfaced the defect: **the providers table's
"System" chip and its read-only row have never rendered.** The canonical provider
carries `isSystem` (`platform/app/src/runtime/app/features/model-provider.ts`
sets it `true` on the env-fed pseudo-rows), the transport's list projection drops
it, and the page read `(provider as any).isSystem` — always `undefined`. So an
env-var-fed provider has been showing an Edit/Delete menu that its config, which
lives in the server's process environment, cannot honour. RECORDED, NOT FIXED:
the field is declared optional with the reason in its docblock, the screen
behaves exactly as the page did, and adding it to the projection is a behaviour
change a page move does not own. The datasets family made the same call in the
other direction because its fix was one line in a function the screen itself
called; this one is a wire change.

#### What else the closure cost

- **`filterProvidersByScope` and `useUrlScopeFilter` did not travel.** Both are
  already harvested into `@langwatch/authz-web/surfaces/scope-picker`
  (`scope-filter-address.ts`), so the package keeps only the fan over rows that
  carry SEVERAL scopes — twenty lines in `model/provider-scope-filter.ts`. The
  platform copies stay for the api-keys page.
- **`ui-screen-closure` COUNTS IMPORT LINES, AND THAT CUTS BOTH WAYS.** Four
  modules wanted the authz surface and the first draft named it four times.
  `provider-scope-filter.ts` re-exports `ScopeFilterValue` and `ScopeHierarchy`
  for the package, so only it and the screen name the surface: 4 findings became 2. The data-governance lesson ("put a shared control in the surface its sibling
  already lives in") has a twin — put a shared TYPE behind the one module that
  already had to name the surface.
- **The scope filter reads the address instead of mirroring it**, the same
  correction data-governance made: `useUrlScopeFilter` kept a `useState` synced by
  an effect, and the screen reads `host.route().query.scope` and writes through
  `setQuery`.
- **`ModelChip`, `DefaultModelsSection`, `useModelProviderConnectionTest` and
  `LLMModelCost` were EXCLUSIVE** — page plus their own tests, nothing else — so
  they moved rather than being copied. `platform/app/src/utils/scopeBreadth.ts`
  lost its last two importers with them and was deleted; the family took the
  narrowed copy `@langwatch/gateway-web` already has.
- **The provider marks are a THIRD copy.** `gateway-web`'s
  `model-provider-icons.tsx` was copied verbatim (four Design System marks, ten
  drawn locally). Recorded rather than acted on: these are the model-provider
  feature's own marks, so THIS package is where they belong and gateway-web
  should eventually import them from a surface here — a change to two packages
  and eleven `platform/app` call sites.
- **`DefaultModelsSection` lost its uncontrolled mode.** The `filter` /
  `onFilterChange` props were optional and the section fell back to local state
  plus its own duplicate filter dropdown. It is mounted in exactly one place, by
  a page that owns the filter, so that branch was dead in production and alive
  only in a test.
- **`CodexCodingDefaultsAskHost` DID NOT TRAVEL, and could not have.** The ask is
  QUEUED by `ModelProviderForm` — inside the editor drawer, still `platform/app`'s
  — through a module-level zustand store, and ANSWERED by the page. A copy of the
  store in the package would be a second, empty store. It is the same chrome gap
  as the drawer: when the editor mounts above a package-served screen, the ask
  can travel with it. Recorded as a loss until then.
- **The Langy pill no longer follows a default-model deletion.**
  `syncLangyAfterDefaultModelWrite` invalidates the caches AND nudges
  `@langwatch/langy-web`'s store; `apps/ui` may not import that package. The
  invalidation travelled and the nudge did not, so a Langy pill open beside the
  settings page keeps a stale model until it refetches. Same class of loss as the
  Langy context chip the me, automations, agents and datasets families took.

#### Credentials, which is what this family is actually about

- **Nothing on the wire this package reads carries a credential value.** The list
  procedures answer `ModelProviderListEntry`, whose `customKeys` is the record
  `credentialPolicy.tryMask` has already masked; `testConnection` takes a ROW ID
  and answers a verdict. Both are now pinned: `model-providers.no-project.test.tsx`
  asserts the probe's payload contains no `customKeys`, no `apiKey` and no
  `customBaseUrl`, and the contract type's docblock says why widening it would be
  a leak.
- **THE FIRST FAMILY TO CARRY THE CODE-KEYED COPY FOR THE CODES ITS OWN SURFACE
  RAISES.** `gateway-web`, `ops-web` and `user-web` all took a `describe-error.ts`
  stub that degrades every code to the generic line. That is wrong here, because
  the copy IS the feature: "that API key was refused" and "nothing answered, so
  this key was not checked" send a customer to two different places. So
  `model/connection-verdict-copy.ts` holds the seven `provider_*` refusal codes
  verbatim from `features/errors/logic/presentation.ts`, including the two whose
  description branches on `meta` (the Google door, the configurable endpoint), and
  a unit test asserts that NOTHING arriving on the refusal is ever rendered — a
  rejected-credential body is where a key turns up. The obligation to keep the two
  in step is in the docblock and dies with the registry harvest.
- Everything else still goes through the host: a delete refusal is
  `host.failed({ error, fallbackTitle })` with the raw error, never
  `error.message`, which since #5984 is the code slug.
- **The delete path gained a reader-visible failure.** `platform/app` left a
  refused provider deletion to a global MutationCache interceptor that showed a
  modal; nothing above a package-served screen holds one, so an uncaught rejection
  would have shown NOTHING. The screen catches and tells the host.
  `isReportedGlobally` is on the port and answers `false` with the reason written
  down — the datasets family's shape, second use.

#### The page guard, and why there isn't one

NEITHER KEY CARRIES A PAGE-LEVEL GRANT. Both platform pages were `SettingsLayout`
and nothing else — no `withPermissionGuard`, no flag — and both read
`hasPermission("project:manage")` INSIDE the page to decide whether the write
controls are live. A reader who cannot manage providers can still see which ones
exist, which is what a project-scoped member needs in order to understand why a
model is missing. The datasets family's warning ("check each key's page
separately") applies to a family whose keys BOTH carry none, and inventing one
here would have refused readers the product admits today.

#### Known costs, all reported rather than suppressed

- 4 new architecture-lint findings, 794 → 798: one `cross-feature` for
  `@langwatch/authz-web` (the edge governance, gateway and data-governance all
  carry) and three `ui-screen-closure` — `@langwatch/platform-api-client` in the
  procedure map (the line every family carries) and the authz surface named twice.
  Two `legacy-application-boundary-baseline` entries and one
  `legacy-feature-fragment-baseline` row went with their files, plus a third
  boundary entry for `useModelProviderConnectionTest`; all three were already
  STALE — the page and the hook stopped importing `~/server/modelProviders/*` some
  time ago and the baseline still listed them.
- `apps/ui/tests/settings-page-chrome.unit.test.ts` needed ONE WORD:
  `settingsRouteSections()` reads `features/<feature>/ui/sections/<feature>-routes.tsx`
  off a hardcoded list, so a third settings feature has to be named in it. The
  seventh family's promise that the guard "needs no further edits" holds for its
  LOGIC and not for that list — whoever moves the next settings family adds one
  string there too.
- **THE PERSONAL-WORKSPACE PAGE TEST WAS DELETED RATHER THAN MOVED, and it loses
  no binding.** It drove the real `useOrganizationTeamProject` to prove the page
  files a provider against the organization's project rather than the personal
  one. That resolution is now `apps/ui`'s `activeScope()`, covered by
  `ui-scope-resolution.unit.test.ts`, and porting the page half would have been
  the fake host handing back the project id it was constructed with — a value
  echo. Both its scenarios stay bound by
  `platform/app/src/hooks/__tests__/useOrganizationTeamProject.personal-workspace.integration.test.tsx`.
- **THREE ASSERTIONS IN A NEIGHBOUR'S SOURCE-READING GUARD WERE DELETED.**
  `pages/settings/api-keys/__tests__/api-keys-scope-filter.unit.test.ts` read
  `src/pages/settings/model-providers.tsx` off disk to prove the two pages share
  `ScopeFilter` and `useAvailableScopes`. The file is gone, so those three cases
  would ENOENT. Both scenarios they carried stay bound by their surviving api-keys
  siblings. The seventh family's lesson stands and should be read as a
  PRE-FLIGHT: grep for tests that read `platform/app/src/<your keys>` — including
  from other families' directories — before deleting anything.
- ZERO new `platform/app` typecheck errors. Nothing outside the family imported
  either page, either deleted component, or the deleted hook.

#### The ninth family's own additions, for whoever moves the tenth

- **A SEVENTH host port of the same shape.** Deferred a seventh time, for the
  seventh time because promotion is a change to packages a page move does not own.
- **A drawer with no other opener can still be cheaper to leave than to move.**
  `defaultModelOverride` is the counter-example to the agents family's "a pure
  deletion" rule: the deciding number is not how many surfaces OPEN the drawer, it
  is how many surfaces its CLOSURE is shared with.
- **The adapter owns the `drawer.` prefix, not the screen.** Pass a drawer's own
  parameter names; let the host spell the address.
- **Annotating a packaged producer's return type is the cheapest contract move
  there is** — and it is the one that finds the drift. Twelve lines bought a live
  defect nobody had noticed in a `(x as any).field` read.
- **A code-keyed copy table belongs to the feature that RAISES the codes.** The
  registry harvest is still owed, but "degrade everything to the generic line" is
  only free on a surface where the specific sentence was a nicety.

### prompts — MOVED. 1 key, 56 platform files, 0 insertions, 8,094 deletions

Moved tenth, and the first family whose PAGE was three lines and whose CLOSURE
was two thirds shared. `platform/app/src/pages/[project]/prompts.tsx` is 16
lines; what it renders is Prompt Studio, and the studio's closure is 63 files
under `platform/app/src/prompts/` — of which **fourteen have callers outside the
family** (the prompt editor drawer, the workflow studio's signature panel, the
experiments workbench, agent testing, the scenario target selector and the trace
explorer between them). Deletes-only forbids repointing any of those, so the
shared fourteen stayed in `platform/app` WITH their tests and travelled as
narrowed family-local copies, and only 56 files could actually be deleted.

**THE RE-RANKING'S "44+14" COUNTED THE CLOSURE, NOT THE DELETABLE SET.** A
family whose feature directory is also the library every other surface imports
its prompt form from moves as copies, not as a move. Whoever surveys the next
one should compute the deletable set the way this move did: take the files with
an outside importer as roots, close them transitively, and delete the
complement. Everything in the closure of a root stays, even when it looks like
page code.

`@langwatch/prompt-web` was already governed, already declared in the catalogue
and already held the prompt form, ten surfaces and a third of the studio's
components — the ops family's "relayout first" lesson, arrived at from the other
direction: the relayout had happened over months of earlier prompt work, and the
move cost a host port, a procedure map, one `apps/ui` feature and a great deal
of narrowing.

#### The nine model-selection copies, and why they are copies

The survey's "model out first" prerequisite resolved exactly as predicted:
family-local copies, no shared promotion. `ModelSelectFieldMini` — the compact
model chip on every prompt tab — pulls a subtree whose other consumers are the
evaluator config field, the workflow studio's LLM field and Langy's model pill,
none of which this move may repoint. All nine went into
`screens/prompt-studio/model-selection/` or `model/`:

| #   | platform module                                    | package module                                             | other platform consumers |
| --- | -------------------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| 1   | `components/ModelSelector.tsx`                     | `screens/prompt-studio/model-selection/model-selector.tsx` | 26                       |
| 2   | `components/llmPromptConfigs/LLMConfigPopover.tsx` | `…/model-selection/llm-config-popover.tsx`                 | 5                        |
| 3   | `components/llmPromptConfigs/LLMModelDisplay.tsx`  | `…/model-selection/llm-model-display.tsx`                  | 5                        |
| 4   | `components/NoModelsConfiguredCallout.tsx`         | `…/model-selection/no-models-configured-callout.tsx`       | 4                        |
| 5   | `components/outputs/OutputsSection.tsx`            | `…/model-selection/outputs-section.tsx`                    | 1                        |
| 6   | `components/OverflownText.tsx`                     | `…/model-selection/overflown-text.tsx`                     | 1                        |
| 7   | `components/modelProviders/iconsMap.tsx`           | `…/model-selection/model-provider-icons.tsx`               | 10                       |
| 8   | `components/llmPromptConfigs/constants.ts`         | `model/model-selection-constants.ts`                       | 5                        |
| 9   | `utils/clampMaxTokens.ts`                          | `model/clamp-max-tokens.ts`                                | 1                        |
| —   | `hooks/useModelProvidersSettings.ts`               | `behavior/use-model-providers-settings.ts`                 | 28                       |
| —   | `hooks/useModelLimits.ts`                          | `behavior/use-model-limits.ts`                             | 0 — a real move          |

The nine narrowed in three ways. `ModelSelector` lost its dev-only
`?__no_models=1` escape hatch, which was gated on `import.meta.env.PROD` — a
build-time environment a feature-web package may not read, and a case the
screen's own suites construct directly. `OutputsSection`'s JSON-schema editor
takes `WorkflowCodeEditor` from `@langwatch/workflow-web` with `secretNames={[]}`
rather than the application's transport wrapper, because a schema names no
secrets. And the provider marks are a **FOURTH COPY**, taken verbatim from
`@langwatch/model-provider-web`'s so the two cannot disagree — with
`ProviderIconGlyph` and the monochrome set added back, because the
published-prompt rows render them and the model-config copy had dropped them.
The model-config family recorded a third copy as the signal to promote these
into a surface on the model-provider feature; this is the fourth, and it is
recorded again rather than acted on.

#### The contract moves, and the two live defects they found

Four real repoints, all of them possible because the producer is PACKAGED:

- **`PromptCreateTrpcInput` / `PromptUpdateTrpcInput`** in
  `@langwatch/prompt-contract`. `platform/app/src/prompts/providers/types.ts`
  read `RouterInputs["prompts"]["create"]["data"]` — an inference through the
  whole application router. The contract already owned the two input schema
  FACTORIES that `@langwatch/prompt-server`'s transport builds from, so the DTOs
  are `z.infer` over them and both halves of the wire now resolve to one
  declaration.
- **`LlmConfigInputTypes` / `LlmConfigOutputTypes`** were already in
  `prompt.field-schemas.ts` and simply unexported; `platform/app/src/types.ts`
  carried an identical hand-kept copy the type picker read. Exporting them is
  four lines and there is now one list.
- **`PromptScope` AS A VALUE.** The dialogs compared against
  `PromptScope.PROJECT` off the generated Prisma client. Stated in the contract
  off the schema's own members.
- **`PromptStudioSpanResult`** — the span hand-off's payload — is already
  published by `@langwatch/trace-contract`, so the builder names it instead of
  `RouterOutputs["spans"]["getForPromptStudio"]`.

Writing the third of those is what surfaced **the span hand-off has been
throwing outright**. `formSchema`'s `version.parameters` had its schema default
removed ("the form always provides this field") and
`createDefaultPromptFormValues` never provided it, so `formSchema.parse` threw on
every "Open in Prompts" from a trace that did not resolve to a managed prompt.
FIXED, one line in a package the ruling allows repointing — the datasets
family's call, second use — because both suites covering it were red where they
sat: `useLoadSpanIntoPromptPlayground.unit.test.ts` was 10/35 red at HEAD in
`platform/app`, and its `.integration.test.ts` sibling **was in no test lane at
all** and had never run. Both now run in the package and are green.

WHOEVER MOVES THE NEXT FAMILY SHOULD RUN THE TESTS THEY ARE ABOUT TO MOVE, IN
PLACE, FIRST. Two of this family's would have been reported as "broken by the
move" otherwise, and the second one would not have been reported at all.

#### Overlays, and the one drawer

`traceV2Details` is the family's only drawer and it is a pure address: it is
registered in `platform/app` and opened by most of the product, so it may be
neither deleted nor copied. The chat's View Trace button names it and
`UiPromptHost.openPlatformDrawer` writes `?drawer.open=traceV2Details` plus
`drawer.traceId`, clearing every stale `drawer.*` key — the model-config
family's shape, where the ADAPTER owns the `drawer.` vocabulary. Same recorded
gap as agents, me, automations, the gateway and model config: nothing mounts
that registry above a screen served from `apps/ui` until the chrome layout route
exists.

Everything else the studio opens is its own state and always was — the deploy
dialog, the replicate dialog, the push-to-replicas dialog, the version history
popover, the API-snippet dialog and the change-handle dialog were all driven by
`useDisclosure`, never by the registry. **No drawer-registry entry was touched
by this move**, the second family after datasets with none.

#### Hazards, as they actually resolved

- **`ui-web-public-boundary-leakage` is what dictates where a store lives.** The
  tab store, the tab-id context, the chat-sync context and the version-badge
  rule all sat under `screens/prompt-studio/`, and `behavior` hooks read every
  one of them — which a global layer may not do. All four moved to `model/`,
  which is where the datasets family put its table context for the same reason:
  a store and a context are portable values, and `model` is the only layer both
  `behavior` and a screen can reach. `getMaxTokenLimit` moved out of the
  LLM-parameters SURFACE into `model/token-limits` for the same reason and the
  surface re-exports it, so no caller changed.
- **A SCREEN ENTRY THAT RE-EXPORTS ITS OWN INTERNALS COSTS ITS CONSUMER A
  TYPECHECK.** `screens/prompt-studio/index.ts` was the studio's internal
  barrel — thirty names its own modules compose each other through — and making
  it the public entry meant `apps/ui` compiled the whole studio, including
  `@langwatch/workflow-web`'s source, under ITS OWN stricter tsconfig. Four
  functions in a package this family does not own turned red on
  `noImplicitReturns`. The barrel is now `studio-internals.ts` and the entry is
  four names: the loader, the procedure map, the host port and its types. The
  four workflow-web functions got an explicit `return undefined` anyway, because
  the lazy `import()` in the loader is still type-checked by the consumer and
  splitting the barrel does not change that — it only keeps the runtime chunk
  honest.
- **`useInvokePrompt`, `invokeLLM` and `fetchSSE` WERE DEAD** and were deleted
  rather than moved. Nothing had called them since the chat moved to CopilotKit;
  only the `hooks/index.ts` barrel kept them reachable. Deleting them is what
  kept this family's screen closure free of a `fetch` finding — the one the
  datasets family carries for its presigned upload.
- **A docblock that spells a browser global reads as a use of it.** The
  screen-closure check greps the source with comments blanked, and it did not
  blank a `/** … localStorage … */` block inside a `.tsx` function body. The
  comment says "Web Storage" now, and says why.
- **`toHaveBeenCalledWith` TREATS A PROPERTY SET TO `undefined` AS ABSENT.** The
  first version of the drawer-address test asserted the cleared key with that
  matcher, and disabling the clearing entirely still passed. The assertion reads
  the recorded argument's own key set instead. A sabotage that does not land is
  indistinguishable from a test that guards nothing.

#### Known costs, all reported rather than suppressed

- **THE DEMONSTRATIONS EDITOR IS GONE; THE PREVIEW STAYS.** The Edit button on a
  prompt's few-shot examples opened `DatasetEditorTable` — 937 lines of
  spreadsheet with four non-Datasets callers, whose in-memory branch the
  datasets family deliberately dropped when it narrowed its own copy into
  `@langwatch/dataset-web`. Rebuilding that branch on the primitives that
  package publishes is the datasets feature's work, not a page move's.
  Demonstrations still render (through `@langwatch/dataset-web`'s
  `DatasetPreviewTable`), and the prompt editor drawer — still `platform/app`'s,
  opened from the workflow studio and the experiments workbench — still edits
  them. THE ONE FEATURE LOSS OF THIS MOVE that a customer can reach.
- **A structured output is pretty-printed rather than folded.**
  `RenderInputOutput` is `@microlink/react-json-view` behind a dynamic import
  plus a media-part collector, a Python-repr parser and the toast singleton —
  four modules with seven other consumers. Same frame, same monospace, no fold
  arrows and no copy button.
- **The hover-peek on View Trace is gone** (`features/traces-v2`' internals,
  which `@langwatch/trace-web` does not publish), and **the Langy context chip is
  gone from the published-prompt rows** — the same loss the me, automations,
  agents, datasets and model-config families took. **`SetupWithAgentButton` is
  gone from the empty state**, the datasets family's loss, second time.
- **`compactMenu` did not travel.** The studio asked the application's product
  menu to collapse so its sidebar had room; there is no capability for a screen
  to ask that of a chrome it no longer knows about.
- 8 new architecture-lint findings, 798 → 806: one `cross-feature` and one
  `ui-screen-closure` for `@langwatch/dataset-web` (the preview table, cheaper
  than a fifth copy of a table the datasets feature owns), four
  `ui-screen-closure` for `@langwatch/workflow-web` — two of them the surface
  findings this package already carried, now counted a second time because the
  screen entry reaches those surfaces — and the `@langwatch/platform-api-client`
  import in the procedure map that every family carries.
- 39 `legacy-feature-fragment-baseline` rows went with their files. The prompt
  feature keeps 41: the fourteen shared modules and their closure.
- ZERO new `platform/app` typecheck errors. The whole-tree count is 14 in 11
  files, which is exactly the baseline; nothing outside the family imported the
  page, the playground, or any deleted module.
- `describeError` is the fourth `describe-error.ts` stub — gateway-web, ops-web
  and user-web took the same one. Its single caller is the chat bubble's
  `unknown` branch, which is the branch the classifier already gave up on, so
  the registry's answer for it was the generic line too. The words are
  `UNKNOWN_ERROR_PRESENTATION`'s verbatim, which is what keeps the scenario that
  pins them bound.

#### The tenth family's own additions, for whoever moves the eleventh

- **AN EIGHTH HOST PORT OF THE SAME SHAPE.** Deferred an eighth time. What this
  one asks that none before it did is `tabCapabilities()`: the open prompt tabs
  are persisted per project in Web Storage, one key per tab, and the store had
  already been written to take its storage and its logger as arguments. The host
  answers them, so the package never names a browser global — and `apps/ui`
  answers them from `behavior/ui-browser-storage.ts` rather than from the
  feature, because `ui-browser-capability` seals a frontend feature off from
  `window` just as firmly.
- **COUNT THE DELETABLE SET, NOT THE CLOSURE.** See the top of this section. It
  is the difference between "44 files move" and "56 files delete, 14 are
  copied and 63 are read".
- **Run the moving tests where they are, before moving them.** Two of this
  family's were red at HEAD and one of those had never been in a lane at all.
  Without the before-run, a red inherited suite reads as a move that broke
  something — and a suite that never ran reads as coverage that existed.
- **A public screen entry must not re-export the screen's internals.** The
  consumer compiles what the entry names, under its own tsconfig. Four names:
  loader, api, port, port types.
- **A copy that loses its writer loses its `Controller` too.** The narrowed
  demonstrations field kept a `react-hook-form` `Controller` whose render never
  touched the field it subscribed to — a subscription the `watch` above it had
  already made. Narrowing a copy means narrowing what it is wired to, not only
  what it renders.

### settings S2 RBAC — MOVED. 2 keys, 8 platform files, 1 insertion, 1,422 deletions

Moved eleventh, and the third settings family: the chrome is `withUiSettingsLayout`,
one import and one wrapper, and this move changed nothing about it. What this
family adds is the first move into a web package that ALREADY EXISTED and was
NOT governed, and the first `~/server/api/rbac` rebuild done for a whole page
rather than for one picker.

The one insertion is the token-subset edit named under the page guard below;
every other platform line in this change is a deletion.

`@langwatch/authz-web` is not created here — it has held
`surfaces/scope-picker` since the data-governance move — so this family adds
`screens/authz`, a host port, a procedure map, a `vitest.setup.ts` and a
`testing.tsx` to a package that had none of them, and puts the whole thing under
`governedWebPackages`.

#### Governing an existing package clears NOTHING, and the ranking row was wrong

The re-ranking promised that "governing authz-web clears 14 findings
governance+gateway carry". It does not, and the mechanism is worth writing down
so nobody costs the next family on the same promise.

`ui-screen-closure` rejects `@langwatch/<anything>-web` UNCONDITIONALLY —
`forbiddenWebPresentationImport` matches `/^@langwatch\/[^/]+-web(?:\/|$)/`
before any catalogue is consulted — and `cross-feature` fires on a package.json
dependency between two features whenever the target is not a contract. Neither
rule reads `governedWebPackages`. That list decides only which packages the
lint WALKS: `lintWebPublicExports`, `lintWebPrivateStructure`,
`lintWebScreenClosures` and `lintWebSurfaceClosures` run over the governed set
and skip everything else. So governing a package can only ever ADD findings
about that package, never remove one a consumer carries.

Measured, not argued: the twenty-five findings naming `@langwatch/authz-web`
before this move (governance 3, gateway 15, data-privacy 2, data-retention 2,
model-provider 3) are all twenty-five of them still there afterwards.

**Governing it cost zero all the same**, which is the part worth keeping: the
existing scope-picker surface was already ADR-004-shaped — one `surfaces/<id>`
export resolving to a local module, no local escape, no browser capability — so
the four new walks it now runs raised nothing on it. A package written to the
layout before it was governed passes the day it is governed.

#### The `~/server/api/rbac` rebuild

Both pages named that module and one of them called into it. It is 2,239 lines,
it reaches the engine gate and through it a Node-only logger, and `apps/ui` bans
`~/server` outright — so the import had to go, and the deletes-only ruling
forbids repointing the platform copy.

- **`Permission` was a bare alias.** `export type Permission = AuthzPermission`,
  deprecated in its own docblock. Three components and both pages named it; all
  of them now name `AuthzPermission` from `@langwatch/authz-contract` directly.
- **`getTeamRolePermissions(role)` became `builtinRolePermissions(roleKeyForTeamRole(role))`**,
  the fix the agents family made for the copy-target picker, applied to a whole
  page. The contract's docblock records that the two are parity-tested cell for
  cell by `platform/app/src/server/app-layer/authz/__tests__/roles-parity.unit.test.ts`,
  which is the ADR-092 stage-A characterisation suite.
- **THE TWO SETS ARE NOT CHARACTER-IDENTICAL, and it does not show.** A textual
  diff of the two role bags found exactly three differences: the contract's
  `admin` set lists `langy:create`, `langy:update` and `langy:delete` explicitly
  where the legacy bag left them to `langy:manage` and the hierarchy rule.
  `langy` is not a resource the permission catalogue offers, so no built-in role
  dialog has ever rendered a row for any of the three.
- **The pin that makes raw membership safe.** The dialog reads membership RAW —
  a permission appears because the bag lists it, not because the engine would
  grant it — and the bags DO lean on the hierarchy (every built-in role holds
  `annotations:manage` with no `annotations:create` beside it). The first
  attempt at a pin asserted bag ≡ grants and went red on twenty-one cells, which
  is the test doing its job. What it says now is the invariant the READER
  depends on: nothing the engine grants is missing from the dialog unless the
  resource's `manage` is there to say it, and nothing appears that the engine
  would refuse.

#### The permission matrix, and how "moved exactly" was measured

The five implication rules — manage covers its resource, a write pulls in the
read, unticking the read withdraws the writes, a click on an implied row goes to
the manage that implies it, nothing outside the registry is ever offered — lived
as closures over a `useMemo` inside `PermissionSelector`, and had no test. They
are `model/permission-matrix.ts` now, and the move was MEASURED rather than
asserted:

A temporary differential harness in the package rendered `platform/app`'s
selector and the moved one side by side (a `~` alias to `platform/app/src` in
the package's vitest config, deleted with the harness) and drove both through
fifty-two click sequences over four resource shapes — full CRUD plus manage,
view-only, view plus share, view plus manage — comparing the reported lists. It
passed; sabotaging the moved copy's "a write pulls in the read" rule produced
twelve disagreements; restoring it went green. Then the harness and the alias
were deleted, because keeping it means keeping the platform component.

**RULES 2 AND 3 ARE DELIBERATELY NOT INVERSES,** and the round-trip test is
where that shows. Ticking `create` adds `view`; unticking `create` does NOT take
`view` away. The first version of the test asserted a clean round trip and was
wrong — the code was right. Whoever moves a matrix like this should expect the
asymmetry rather than "fix" it.

#### The contract move is a REAL repoint, and it needed no new declaration

`RouterOutputs["roleBinding"]["listForOrg"][number]` is
`AuthzManagedOrganizationBinding`, which `@langwatch/authz-contract` ALREADY
declares. The procedure is mounted from `@langwatch/role-server`, whose handler
answers `AuthzListManagedBindingsForOrganizationOutput`, so this is the
model-config family's "real repoint" case at its cheapest: zero inserted lines
in any contract, and both halves now checked against one statement of the row.
`role.getAll` and `role.getById` needed nothing either — they already answer
`Role` from `@langwatch/role-contract`.

#### The ownership tension, recorded rather than forced

The data-governance family's rule is "a key belongs to the family that owns its
transport", and by that rule these two keys are the ROLE feature's:
`role.*` and `roleBinding.*` are mounted from `@langwatch/role-server`, and
`packages/features/role` has no web package.

They went to `@langwatch/authz-web` anyway, and the reason is that the transport
is a door rather than an owner: `RoleApp.listBindingsForOrganization` delegates
straight to `permissions.listManagedBindingsForOrganization`, the answer is
typed by `@langwatch/authz-contract`, and the roles page is a permission-matrix
editor over authz vocabulary from end to end. The alternative was creating a
twelfth web package for two pages whose every type comes from authz.

WHAT THIS COSTS is one thing and it is written into the procedure map's
docblock: **the segment names stay `role` and `roleBinding`**, because tRPC
hashes the path into the React Query key and the members page, the teams page
and the group binding editor all still read `api.role.getAll`. A package named
for one feature calling procedures mounted under another's name is the honest
shape of this, and renaming either segment would silently split the cache.

#### What the closure cost

- **Four components were EXCLUSIVE and moved**: `RoleCard`, `RoleFormDialog`,
  `PermissionSelector`, `PermissionViewer` — page plus nothing else.
- **`permissionsConfig.ts` and `rbacVocabulary.ts` did NOT travel** and came over
  as one family-local copy (`model/permission-catalogue.ts`). The first keeps
  three server-side test consumers; the second keeps ten callers across the
  server, `apps/api` and the Langy contract. The copy is bounded by the registry
  — every string it produces is filtered through `isRegistryPermission` — so it
  can only ever be a SUBSET of the engine's vocabulary, never a second opinion
  about it. That is what makes a restatement of a vocabulary safe.
- **`RandomColorAvatar` did not travel** (sixteen platform callers) and neither
  did the `UserAvatar` under it. `ui/elements/principal-avatar.tsx` is the
  family-local copy; the automation family's `ParticipantAvatar` could not be
  reused because it renders initials only and these rows carry `userImage`.
- **Three Design System substitutions, all precedented, one with a behaviour
  difference**: `~/components/gateway/ConfirmDialog` and `~/components/ui/checkbox`
  are byte-identical to their Design System twins (the checkbox is literally a
  re-export), and `~/components/ui/dialog` is NOT — the platform wrapper adds an
  inline error boundary around the body and stands `trapFocus` and
  `preventScroll` down. Ten package dialogs already made that substitution, so
  it is precedent; it is recorded because it is real.
- **`ScopeChipPicker` was not needed and not used.** The surface next door WRITES
  which scopes a rule applies to; these pages only read which tier a binding
  sits at. A family moving into a package with a surface already in it should
  check whether it actually wants it.

#### Two deliberate additions, named because a move should not have any

- **Three icon-only buttons gained `aria-label`.** Edit, delete and view on a
  custom role card had no accessible name at all — a screen reader announced
  three unlabelled buttons. Nothing visible changed. Recorded as an addition
  rather than slipped in.
- **The two permission dialogs became one component.** The platform page carried
  eighty lines of dialog twice, differing only in whether the description fell
  back to a sentence, and `getDefaultRoleDescription` was a second switch over
  the same three descriptions the cards already held. One component, one table.

#### The page guard, and the regression pin it inherits

BOTH keys carry `organization:manage`, and that is not a detail:
`platform/app/src/pages/settings/__tests__/admin-page-guards.unit.test.ts` is a
regression pin written after five legacy administration pages guarded themselves
on permissions a MEMBER inherits and leaked full organization data. It worked by
READING PAGE SOURCE, and `roles.tsx` was one of its five.

So the seventh family's pre-flight — grep for tests that read
`platform/app/src/<your keys>` before deleting anything — caught its second
victim. The row was deleted (a pure deletion) and the line is now held by
`apps/ui/tests/authz-page-policy.integration.test.tsx`, which MOUNTS the refusal
under a session holding `organization:view` and reads the result. That is
strictly stronger than a source match. The docblock's "The five legacy admin
pages below" became "The legacy admin pages below" — a strict token subset of
the line, which is the only kind of edit the deletes-only ruling admits.

#### Known costs, all reported rather than suppressed

- 4 new architecture-lint findings and 1 retired (809 → 820 overall, of which
  +8 belong to the identity worker lane running concurrently). Mine, line by
  line: `cross-feature` and `enterprise-direction` on
  `packages/features/authz/web/package.json` for `@langwatch/enterprise-billing-web`,
  one `ui-screen-closure` for `@langwatch/platform-api-client` in the procedure
  map (the line every family carries), and one `ui-screen-closure` for the
  enterprise package in `ui/elements/enterprise-upsell.tsx`. Retired:
  `legacy-feature-fragment` on `pages/settings/roles.tsx`, with the file.
- **THE ENTERPRISE UPSELL IS THE STRUCTURAL BLOCK AGAIN.** Both pages show
  `ContactSalesBlock` to an organization that is not on Enterprise. Neither
  `@langwatch/authz-web` nor `apps/ui` may import an enterprise package — both
  are core — and a family-local copy of the sales copy would drift from
  `ENTERPRISE_PLAN_FEATURES`, which lives in the billing package. So this family
  takes the same import `@langwatch/gateway-web` already takes on its webhooks
  screen, and carries the same three findings plus the same two
  `langwatch(package-boundaries)` oxlint errors. It clears when
  `packages/enterprise/composition/ui` exists — the gate that blocks the billing
  settings family outright.
- **ONE MODULE NAMES THE ENTERPRISE PACKAGE, not two.** `ui-screen-closure`
  counts import lines, so routing both screens through
  `ui/elements/enterprise-upsell.tsx` is one finding where naming it twice would
  be two. The model-config lesson, applied to a component rather than a type.
- Three `legacy-application-boundary-baseline` rows went with their files
  (`RoleCard`, `RoleFormDialog`, `roles.tsx`, all naming `../../server/api/rbac`);
  leaving them would have raised three "baseline retains removed occurrence"
  findings on the migration lane, which is where they were measured: 1,130 → 1,127.
- ZERO new `platform/app` typecheck errors. Nothing outside the family imported
  either page, any of the four components, or the two loader keys.
- Two spec files were WRITTEN, not moved: `specs/rbac/custom-role-permission-editing.feature`
  (23 scenarios) and `specs/rbac/role-binding-audit.feature` (5). Neither page
  had a spec, and the permission matrix — the part of this family most worth
  being sure about — had no test of any kind. Both files report fully bound.

#### The eleventh family's own additions, for whoever moves the twelfth

- **A NINTH HOST PORT OF THE SAME SHAPE.** Deferred a ninth time, for the ninth
  reason. What this one asks that none before it did is `plan()`, and it asks it
  as a PAIR: `isEnterprise` and `isLoading`, because still-arriving is a third
  state and collapsing it into not-Enterprise pitches Enterprise at an
  Enterprise customer for the length of one round trip.
- **CHECK WHAT "GOVERNING A PACKAGE" ACTUALLY DOES BEFORE COSTING A MOVE ON IT.**
  `governedWebPackages` selects what the lint WALKS. It does not change what any
  rule says about an import. A ranking row that promises a finding count will
  fall is a claim to verify, not a budget to spend.
- **A DIFFERENTIAL HARNESS IS THE HONEST WAY TO SAY "MOVED EXACTLY"** for logic
  that had no test. Alias the platform source into the package's vitest config,
  drive both copies, compare, sabotage to prove the harness bites, then delete
  the harness and the alias with the same commit that deletes the original.
- **A vocabulary copy is safe when something narrows it.** `permissionsConfig`
  and `rbacVocabulary` could not travel, and a second copy of a permission
  vocabulary is exactly the kind of restatement that drifts — except that every
  string it produces passes through `isRegistryPermission` first, so the copy
  can only shrink the offer, never widen it. Look for the narrowing before
  accepting the copy.

### annotations — MOVED. 4 keys of 5, 8 platform files, 0 insertions, 2,497 deletions

Moved twelfth, and the first family whose ranking row was wrong about the KEYS
rather than about the effort. Five keys were listed; four moved. Everything else
follows the shape by now: one host port (`model/annotation-host.ts`), one
hand-written procedure map (`behavior/annotation-api.ts`), the
router/session/feedback re-bindings, `withUiPageGuard` in front of the loader
registry, a `testing.tsx` harness and a package-owned `vitest.setup.ts`.

Destination `@langwatch/annotation-web`, relaid out from flat-by-topic to the
two-scope layout: 3 modules to `model`, 5 to `ui/elements`, 7 to `ui/blocks`,
the tests colocated beside them, and the new `behavior`, `screens` and
`ui/sections` on top. The suite was 36 tests before the relayout and 36 after,
which is what made it safe to do in one step. The root `.` export STAYS —
twelve `platform/app` modules import it (the trace drawer's annotation rail, the
trace table's annotations column, the comment editor, the score editor) and
deletes-only forbids repointing any of them.

#### THE FIFTH KEY DID NOT MOVE, and that is the finding

`pages/[project]/annotations/my-queue` is the annotation queue WALKER, and it
does not merely open the trace drawer — it MOUNTS the drawer's conversation
view inline. `features/traces-v2/components/TraceDrawer/conversationView` is
4,347 lines that reach the transcript, the turn ledger, the annotation rail, the
waterfall's anchored comments, `FormatSelect` and `useTraceDrawerNavigation`.
`@langwatch/trace-web` publishes the annotation-queue SESSION STORE and the
Shiki adapter and no conversation surface at all.

So the two honest options were a placeholder or leaving the key. A placeholder
is what the me family shipped for recent-traces and what automations shipped for
the query autocomplete — but those are a widget and a completion popup, and this
is the entire surface the queue exists for: the reviewer reads the thread, marks
turns into the sitting's set, and annotates in the rail. Deleting it and calling
it a recorded gap would have been deleting the feature. **A key belongs to the
family that can carry its content, not to the family whose name is in its URL.**

What that costs, and it is not free: four platform modules stay alive for the
one key — `components/AnnotationsLayout.tsx` (the sidebar), `hooks/useAnnotationQueues.tsx`,
`features/traces-v2/components/AddToAnnotationQueueDialog.tsx` and
`components/AddAnnotationQueueDrawer.tsx` — and the family now renders TWO
sidebars, the platform one on the walker and the package copy on the other four
addresses. They die together when traces moves. The moved screens still link to
the walker as a plain address, and the loader merge leaves a key the package
registry does not name to the host's, so the seam is invisible to a reader.

#### The move introduced a live render loop, and the suite is what found it

`model/annotation-period.ts` is the reading half of the platform's
`usePeriodSelector`, made pure so the "a queue does not narrow until a range is
picked" rule could be a unit test. Pure means it takes `now` — and calling it
straight out of a render body gives a RELATIVE window a new end timestamp every
render, to the millisecond. The list's "the picks belong to these rows" effect is
keyed on that window, so it fired, set state, rendered, and moved the window
again. In a browser that is a render loop AND a tRPC round trip per frame,
because the queue read's input carries the two dates.

It surfaced as a test worker that stalled inside an ordinary synchronous render
and walked to its four-gigabyte ceiling with NO failing assertion — raising the
ceiling to eight gigabytes only made it take longer, and the apparent culprit
moved every time anything else in the file changed, which is how three hours went
into splitting files that were never the problem. **A jsdom worker that dies of
memory with every test green is an infinite render, not a heavy suite. Look for
a value recomputed per render that something is keyed on, before you touch the
runner.** The platform hook held the same line with the same `useMemo` and said
why in a comment; `behavior/use-annotation-period.ts` says it again, with a
referential regression pin beside it.

#### Four keys, one screen, and the view as a prop

The automations tab-as-prop shape, applied to a list. Four page files whose
bodies differed only in the props they handed one table become one screen and a
`view` prop; `apps/ui`'s routes section maps a key to a view. That is why the
host port has NO `pathname` — the only thing still read off the address is the
queue `:slug`, which the router captured as a parameter.

Two things a later family should copy from how it was pinned:
`annotation-page-policy.integration.test.tsx` asserts each key resolves ITS view
by name, so a swapped pair cannot pass; and the guard asymmetry is asserted in
both directions, because only ONE of the four platform pages carried a
`withPermissionGuard` and inventing three more is a change to who can reach a
page that a move does not own. It is not a hole — every procedure behind all four
carries `annotations:view` — and it is recorded so somebody can decide.

#### The one feature loss, and it is the same wall automations hit

**The All Annotations page's FILTERED MODE did not travel.** The platform page
asked `useFilterParams` whether the address carried any trace filter and, if it
did, queried the matching traces first and the annotations on them second. That
hook reaches `~/server/filters/registry`, `~/server/filters/types` and
`~/server/analytics/utils`; a browser package may name none of them, and
`availableFilters` is a vocabulary with NOTHING to narrow a copy of it — the
RBAC family's test for when a vocabulary copy is safe, failed. Nothing in the
product links to `/annotations/all` with a filter: the annotations pages render
no filter control, so the mode was reachable only by a hand-made URL or by the
saved-view fallback the hook reads out of the browser's key-value store. That
fallback is the visible half — a reviewer with a saved trace view selected used
to see this page silently narrowed to it and now sees every annotation in the
range.

#### Chrome gaps, recorded

- `traceV2Details` and `addDatasetRecord`. Every row opens one of them, and both
  are `platform/app` registry entries mounted by `DashboardPageBody`. The screens
  write the address (`model/annotation-overlay-address.ts`, clearing every stale
  `drawer.` key first, which is what the registry did) and nothing opens until the
  chrome layout route lands. The same gap coding-agent, me and automations
  recorded; the addresses are asserted on the host's recorded query rather than on
  a rendered overlay, which is the only assertion available and is the right one.
- **The queue editor does NOT carry that gap**, and that is the gateway family's
  shape paying off: creating and editing a queue is `?queue-editor=<id|new>`,
  this family's own key, and the screen mounts its own narrowed copy of the
  drawer. A link that opens a queue for editing still works.

#### What the closure cost

- **`AnnotationsTable` was EXCLUSIVE and moved** (631 lines, four callers, all of
  them the four moved pages) along with both of its suites.
- **Seven family-local copies, every one with platform callers that stay**:
  `NoDataInfoBlock`, `SelectionActionBar` (the datasets family took the same two),
  `RandomColorAvatar`/`UserAvatar` (→ `reviewer-avatar`), `MenuLink` (→ a narrowed
  `sidebar-menu-link` that no longer resolves selection from the pathname),
  `PeriodSelector` (split into a pure model and a picker), `RedactedField`
  (narrowed to its query-driven half) and `downloadCsv` (papaparse did not travel
  — eleven lines do the same RFC 4180 job).
- **Two more the walker keeps**: `AddToAnnotationQueueDialog` and
  `AddParticipants`. The dialog is opened by the trace table's bulk bar and the
  trace drawer's overflow menu as well, so both stay and both travelled as copies.
- **Three things the queue editor dropped**, all recorded in its docblock: the
  nested "Add New" score-type sub-drawer (score types are defined in Settings, and
  the picker now says so — the automations dataset-sub-flow precedent), the slug
  preview under the name field (the server mints the slug; a preview that can
  disagree is worse than none), and `react-hook-form` (two text fields are plain
  state; the server's field rejections still land on the field, read through the
  same nine-line `readHandledError` copy gateway and automations carry).

#### Known costs, all reported rather than suppressed

- **2 new architecture-lint findings, 5 retired** (823 measured before, 819
  after; the extra movement belongs to the identity worker lane running
  concurrently, which came and went during this move). Mine:
  `ui-screen-closure` for `@langwatch/platform-api-client` in the procedure map —
  the line every family carries — and `ui-web-public-entry` for the root `.`
  export, un-repointable. Retired: five `legacy-feature-fragment` rows, the four
  page shells and `AnnotationsTable`, and their baseline entries went with them.
- Two findings were FIXED rather than carried, and both are worth knowing about.
  `ui-web-layer-direction` fired because a `ui/blocks` dialog imported its state
  TYPE from `behavior`; the type moved to `model`, where a portable value belongs.
  And `ui-screen-closure` fired on the SCREEN for "browser session or storage
  state" — because its docblock contained the word `localStorage` while
  explaining the filtered mode that did not travel. **The closure rule reads
  source text, comments included.**
- ZERO new `platform/app` typecheck errors: 18 in 13 files, the attributed
  baseline, none of them annotations. Nothing outside the family imported any of
  the eight deleted files.
- **TWO INHERITED RED SUITES, not caused and not fixed.** Both of the queue
  walker's test files —
  `pages/[project]/annotations/__tests__/my-queue-{conversation,bar}.integration.test.tsx`
  — fail on an incomplete `@langwatch/trace-web` module mock: the page imports
  `useAnnotationQueueSessionStore`, `sessionTraceIds` and (transitively)
  `useDrawerStore`, and the factories declare only `useShikiAdapter`. Proved
  pre-existing by restoring the eight deleted platform files and the four loader
  keys and running both again: identically red. They belong to the key that did
  not move, and they are the trace family's to fix with it.
- `annotations-list-selection.feature` went from **0/14 bound to 20/20**. It was
  already 0 before this move — the tests carried fine-grained `@scenario` titles
  the spec's coarse scenarios never matched, so the file reported unbound and
  nobody noticed. Both halves are bound now (stacked `/** @scenario */`
  docblocks bind more than one title to one test), and six scenarios were added
  for what the move changed.

#### The twelfth family's own additions, for whoever moves the thirteenth

- **A TENTH HOST PORT OF THE SAME SHAPE.** What this one asks that none before it
  did is `isOwnPersonalWorkspace()` — a column on the TEAM crossed with who is
  signed in, which `hasPermission` cannot answer and which cannot be discovered
  by asking the procedure, because `personalWorkspaceFeatures.get` answers
  NOT_FOUND for anybody else's workspace. A refusal is not an answer.
- **RE-SURVEY THE KEYS, NOT JUST THE FILE COUNT.** The ranking row's "12+7" was
  almost exactly right about the files and wrong about which of them could
  travel. Before costing a family, open every page and ask what each one MOUNTS,
  not what it links to.
- **A pure function that takes `now` must be memoised at the render seam.**
  Making a hook pure is right; calling it per render is not. The rule generalises
  to anything a reading is keyed on.
- **Check the spec's binding count BEFORE you move it.** `0/14 bound` on a file
  full of `@integration` tags is the feature-parity trap in its quietest form,
  and a page move is the moment somebody is actually reading both halves.
- **A DELIBERATE ADDITION IS STILL AN ADDITION.** Three unguarded keys were left
  unguarded. Writing the reason down in the routes section and asserting the
  refusal in both directions is what turns "we did not get round to it" into a
  question somebody can answer.

### settings S6 credentials + /cli/auth — MOVED. 3 keys, TWO packages, 29 platform files, 0 insertions, 9,269 deletions

Moved thirteenth, and the first family to create TWO packages in one change and
the first whose keys do not all share a frame. `@langwatch/api-key-web` holds
`/settings/api-keys` and `/cli/auth`; `@langwatch/secret-web` holds
`/settings/secrets`. Everything else follows the shape by now: one host port per
package, a hand-written procedure map, `withUiPageGuard` in front of the loader
registry, `withUiSettingsLayout` for the settings keys, a `testing.tsx` harness
and a package-owned `vitest.setup.ts`.

#### TWO PACKAGES, and the rule that decides which

The ranking row said "create api-key-web" and left secrets implied. It is its own
package, and the reasoning is the data-governance family's rule read strictly:
**a key belongs to the family that owns its transport.** `secrets.*` is mounted
from `@langwatch/secret-server`, the row is `@langwatch/secret-contract`'s
`Secret`, the four refusal codes are its `HandledError` subclasses and the
fifty-per-project ceiling is its constant. Nothing on that page comes from the
API key contract.

The RBAC family's EXCEPTION — the roles pages went to `@langwatch/authz-web`
though `role.*` is the role feature's — turned on every TYPE on those pages
coming from authz, so the transport was "a door rather than an owner". That test
fails here in both directions, so the rule applies and secrets got its own
package. The cost is one more host port, one more frontend feature and one more
catalogue entry, for a 346-line page. The alternative was `@langwatch/secret-web`
never existing and the next person looking for the secrets surface finding it
under `api-key`.

THE OTHER TWO KEYS COULD NOT BE SPLIT, which is what the ranking row got right:
`/cli/auth` imports the permission ceiling (`utils.ts`) and the category picker
that Settings > API Keys owns, so moving one without the other would have left
the CLI screen importing files the settings move deletes.

#### The CLI exchange, and why it is the only wire in this migration

`/cli/auth` is the page a browser opened by `langwatch login` lands on. It talks
to three REST routes — `/api/auth/cli/{lookup,approve,deny}` — and the OTHER SIDE
OF THAT EXCHANGE IS A PUBLISHED BINARY: the CLI polls `/exchange` until the
record these calls flip comes back approved. So the wire is a compatibility
surface with software that is already installed, not an internal detail.

A screen may not name `fetch` (`ui-screen-closure` lists it, and rightly), so the
three calls are host-port methods and the transport lives in
`apps/ui/src/behavior/ui-cli-device-flow.ts` — the browser-transport home the
feature-pilot gate carved out, and the only place in `apps/ui` where `fetch` is
allowed. THE SPLIT IS THE POINT: the SELECTION an approval carries is decided in
the package and pinned there (`cli-auth.screen.test.tsx`), and the BODY it goes
out as is pinned in `apps/ui/tests/cli-device-flow.unit.test.ts` — sixteen cases
over the paths, the header, the snake-cased keys, the 404/410 split and the
message precedence. Sabotaging `scope_type` to `scopeType` turns one of them red,
which the old page-level suite could only have caught by accident.

Three readings are preserved exactly because each one is a different sentence to
the reader: 410 is "restart `langwatch login`", 404 is "that code was not
recognised", anything else is the endpoint's own description. Collapsing any two
costs the reader the one line that tells them what to do.

#### Credential hygiene, which is what this family is actually about

- **No read in either package carries key material.** `apiKey.list` answers
  `ApiKeyListEntry`, whose `lookupIdPrefix` is five characters of the PUBLIC
  lookup id and not a prefix of any secret; `secrets.list` answers the contract's
  `Secret`, a `.strict()` schema whose own docblock reads "Safe metadata. The
  encrypted value is deliberately absent." Both are asserted rather than assumed —
  the secret one by parsing a row that carries a value and watching it fail.
- **Exactly three shapes carry a credential and all three are MINTS.**
  `apiKey.create`, `project.regenerateApiKey`, and the two secret writes (which
  carry a value out and answer none back). Every one feeds a one-time surface.
- **The one-time reveal is pinned by closing it.** `token-created-dialog` keeps
  the token in screen state; the test closes the dialog, reopens the create flow
  and asserts the token is gone. Sabotaging the close to keep the state turns it
  red.
- **What is DISPLAYED is masked; what is COPIED is real.** Three separate places
  get this right and each would be silent if it did not: `copyText` bypasses the
  CodeBlock copy trigger, the config block renders the masked JSON and copies the
  unmasked one, and the Basic Auth tab masks the BASE64 BLOB rather than the
  token — a token is not a substring of its own base64, so masking on it there
  fails open.
- **`maskSecret` hides a short value entirely.** Eight characters or fewer leaves
  nothing between the two four-character ends, so the naive version prints the
  whole thing. Sabotaging that branch turns the credential suite red.
- **The legacy project key is the one credential on a READ, and it predates this
  move.** `project.apiKey` has always travelled inside the organization graph the
  shell holds; the row shows four characters and copies in full. The port declares
  it with that history written down rather than passing it silently.

#### The four refusal codes that had no words

`secret_already_exists`, `secret_limit_reached`, `secret_name_reserved` and
`secret_not_found` are declared `HandledError` subclasses and NONE of them is
listed in `platform/app/src/features/errors/logic/codes.ts` — so the presentation
registry's exhaustiveness never demanded an entry, none was written, and every one
of them reached the customer as "Couldn't create the secret" plus the generic
"something went wrong on our side". All four are things the reader can fix in the
dialog they are looking at.

`@langwatch/secret-web`'s `model/secret-refusal-copy.ts` is the model-config
family's precedent applied ("a code-keyed copy table belongs to the feature that
RAISES the codes"), and its test is exhaustive against the CONTRACT rather than
against a list kept beside it: a fifth `HandledError` subclass added without copy
fails. **A DELIBERATE ADDITION, and named as one** — a customer who hits the
fifty-secret ceiling now reads why, which they did not last week.

`UiFailureNotice` gained an optional `description` to carry it, plus the two form
guards on the API Keys page that are decided in the browser and have no code to
look up at all. The registry still WINS over it, so it can never talk over
registered copy; it only fills the gap where there is no code.

#### What did not travel, and what it cost

- **`CreateProjectDrawer` is a RECORDED GAP, and half of a scenario with it.**
  It is a registered `platform/app` drawer `DashboardLayout` also opens, and its
  closure is `ProjectForm` — 301 lines of team selection and slug minting
  belonging to the organization settings family — so the move may neither delete
  nor copy it. The button addresses the drawer through the host, which is right
  and does not open yet. The old page then ADOPTED the created project by matching
  the slug the drawer reported; without the drawer's callback there is nothing to
  adopt, so that half is a loss until the chrome layout route lands.
- **The onboarding container's SIGN-OUT button did not travel.** `/cli/auth`
  frames itself — it is not a settings page and never was — and the frame is a
  narrowed copy of `OnboardingContainer`. The sign-out control reached the session
  client and the analytics emitter, and it is also the one control on that frame
  with nothing to do with approving a device code. The mesh background, the logo,
  the entrance animation and the loading skeleton all travelled.
- **Seven onboarding modules and `FullLogo` are family-local copies**, every one
  with callers that stay: `CodePreview` (narrowed — its `llmPrompt` action was the
  only thing reaching a toast singleton, and its inline `await import("shiki")`
  became the Design System's shared singleton), `JsonHighlight`, `TabButton`,
  `InlineCopyButton`, `copy-to-clipboard` (folded into the host), `maskApiKey`,
  `build-mcp-config`, and the wordmark. `formatTimeAgo` is its third byte-identical
  copy and `personalProject` its second.
- **`RegenerateApiKeyDialog` was EXCLUSIVE and moved** — one caller, the rotate
  control — so the platform file is deleted rather than copied.
- **`apiKeyAnchor.ts` STAYS.** The trace drawer's `langwatch.api_key` attribute
  links to `/settings/api-keys#api-key-<id>` and deletes-only forbids repointing
  it. Fourteen lines, two copies, both pinned to the same literal strings.
- **`filterRowsByScope` is the SECOND copy of the model-provider family's fan**,
  byte-identical below the docblock. A web package may not import another web
  package, so the choice is this or a third surface on `@langwatch/authz-web`
  publishing twenty lines. Recorded rather than acted on.

#### The `~/server/api/rbac` substitution, and the one difference it makes

`hasPermissionWithHierarchy` became `permissionSatisfiedBy` and
`getTeamRolePermissions` became `builtinRolePermissions(roleKeyForTeamRole(role))`
— the RBAC family's fix, third use. THE TWO ROLE BAGS ARE NOT CHARACTER-IDENTICAL
and here, unlike on the roles page, IT SHOWS. The contract's `admin` set lists
`langy:create`, `langy:update` and `langy:delete` explicitly where the legacy bag
left them to `langy:manage` and the hierarchy rule, and `langy` IS one of the API
key permission categories.

Everywhere a bag is read through `categoryAccessAvailability` that is invisible,
because the manage implication applies either way. The one visible place is the
CLI key's DEFAULT permission list, which filters by plain set membership: an
organization admin's minted key now carries those three strings alongside the
`langy:manage` it already carried. The key can do exactly what it could before —
manage satisfies all three at the engine, which the test asserts beside the
difference — but the stored list is three entries longer.
`cli-key-defaults.unit.test.ts` pins it so it reads as a decision rather than as
drift.

#### The contract move is a REAL repoint, and this time it found no drift

`RouterOutputs["apiKey"]["list"][number]` is produced by a PACKAGED transport, so
the ruling allows the real fix: `ApiKeyListEntry` is declared in
`@langwatch/api-key-contract` and `ApiKeyApp.listKeys` is ANNOTATED with it. The
model-config family's twelve-line move found a live defect; this one type-checked
first time, which is the other outcome and worth recording — the annotation is
still what makes a future widening of a list answer a compile error rather than a
credential disclosure.

`NamedApiKeyBinding` moved from `@langwatch/api-key-server`'s app module into the
contract, and the server barrel's export of it was DELETED rather than
re-exported: nothing outside that package consumed it. `ApiKeyProject`,
`ApiKeyTeam` and `ApiKeyUser` needed nothing — they were already contract types.

#### The page guards, and why there are none

NONE OF THE THREE KEYS CARRIES A PAGE-LEVEL GRANT OR A FLAG, one for one with the
platform pages. Both settings pages were `SettingsLayout` and nothing else,
deciding inline what a reader may DO — `apiKey.orgMembers` answering non-empty is
how the API Keys page knows the reader is an organization admin, and
`secrets:manage` is read per control. `/cli/auth` carried no guard because it does
its own session redirect, which a permission guard would pre-empt: a refused
reader would never reach the redirect that preserves their device code through
SSO. `api-key-page-policy.integration.test.tsx` asserts all three in BOTH
directions, and sabotaging one key with `organization:manage` turns it red.

#### The specs, and the trap one of them was in

- `specs/secrets/secrets-manager.feature` WAS 0/0 BOUND. It carried one untagged
  scenario, so `check-feature-parity` counted nothing and reported it green while
  binding nothing at all — the annotations family's trap, second sighting. Six
  scenarios for the page's own behaviour were written and bound; the vocabulary
  scenario stays deliberately UNTAGGED, because the suite covering it lives in
  `platform/app` and deletes-only forbids adding the docblock that would bind it.
- **Sixteen bindings were dropped by the move and every one was restored**, three
  of them somewhere new. "zero selected reads None selected", "the scope filter
  offers the same options as the model-providers page" and "the filter is keyboard
  navigable" are the SURFACE's behaviour now, so they are bound in
  `@langwatch/authz-web`'s own scope-picker suite — a caller asserting them again
  would be testing that package through a page.
- Seventeen scenarios were WRITTEN for behaviour that held before the move and had
  never been stated: the one-time reveal, the masking split, the row that never
  renders a secret, and eight states of the authorize screen.

#### Known costs, all reported rather than suppressed

- **5 new architecture-lint findings, 2 retired** (824 measured after). Mine, line
  by line: `cross-feature` on `packages/features/api-key/web/package.json` for
  `@langwatch/authz-web` (the edge governance, gateway, data-governance and
  model-provider all carry), two `ui-screen-closure` for
  `@langwatch/platform-api-client` in the two procedure maps (the line every
  family carries), and two for the authz surface. Retired: two stale
  `legacy-feature-fragment-baseline` rows for api-key files earlier passes had
  already deleted.
- **THE SURFACE IS NAMED TWICE, NOT SEVEN TIMES.** Five modules wanted it. The
  components go through `ui/elements/scope-picker.tsx` and the address helpers
  through `model/api-key-scope-filter.ts`, which already had to name it for the
  predicate: 7 findings became 2. The model-provider lesson, applied to components
  as well as types — and one import statement per module, because a separate
  `export … from` is a second line and therefore a second finding.
- **`sessionStorage` IS A FORBIDDEN IDENTIFIER, NOT A FORBIDDEN CALL.**
  `ui-browser-capability` reads the name anywhere in a frontend feature's source,
  so a port field called `sessionStorage` is a finding even though the feature
  never touches the global. Renamed `visitStorage`; the global layer owns the API.
- **The lead-source stamp is a RESTATEMENT.** `platform/app/src/utils/attribution.ts`
  owns the `lw_attrib.` convention and stays with its capture hook and its signup
  reader; the adapter knows one key of it, and the test pins both strings so a
  rename on either side fails rather than silently stopping a marketing signal.
- **Two `platform/app` docblocks still name deleted paths.**
  `server/routes/auth-cli.ts` refers to `/pages/cli/auth.tsx` in two comments.
  Correcting them would be an insertion; they are wrong and recorded.
- ZERO new `platform/app` typecheck errors: the attributed baseline, none of them
  this family's. Nothing outside the two families imported any deleted file — the
  only outside consumer, `apiKeyAnchor`, stays.
- **Six sabotages, each caught red then restored**: the CLI auth page guard, the
  one-time reveal's close, `maskSecret`'s short-value branch, the clipboard's
  honesty about a refused write, the approval body's `scope_type` keys, and the
  secret value input's `type="password"`.

#### The thirteenth family's own additions, for whoever moves the fourteenth

- **AN ELEVENTH AND A TWELFTH HOST PORT OF THE SAME SHAPE.** Deferred again, for
  the same reason. What the api-key one asks that none before it did is a
  TRANSPORT: three device-flow calls, because the wire belongs to the application
  and the screen may not name `fetch`. What the secret one asks is
  `projectSwitcher()`, which answers `null` — the ability travels, the control
  does not.
- **THE TRANSPORT RULE DECIDES A PACKAGE, AND THE TYPE RULE IS THE EXCEPTION TO
  IT.** Before folding a key into a neighbouring package because the move is
  cheaper, check where its TYPES come from. Same contract as the neighbour: fold.
  Its own contract: its own package, however small the page.
- **PIN A WIRE WHERE THE WIRE IS.** A page suite that mocked `fetch` was asserting
  the transport through a render. Splitting it — selection in the package, body in
  `apps/ui` — made both halves legible and caught a key-casing sabotage the old
  shape would have missed.
- **A SPEC WITH ONE UNTAGGED SCENARIO REPORTS GREEN.** Second sighting of the
  feature-parity trap. Check the binding count before you move a family, and check
  it for the neighbours whose tests live in the directory you are deleting.
- **RESTORE EVERY DROPPED BINDING, AND ASK WHERE IT BELONGS.** Diff the
  `@scenario` tags of the files you delete against the ones you write. Three of
  the sixteen belonged to the shared surface rather than to this family, and
  moving them there is what stops a page suite from testing somebody else's
  package.
- **A LINT RULE THAT READS IDENTIFIERS WILL READ YOUR PORT'S FIELD NAMES.** Name a
  port after what it is FOR, not after the browser API behind it.

### settings S7 identity — MOVED (2 of 3 keys). TWO packages, 11 platform files, 0 insertions, 2,639 deletions

Moved fourteenth, and the first family whose keys DID NOT ALL MOVE. Two of the
three went: `/settings/audit-log` to a new `@langwatch/organization-web`, and
`/settings/authentication` into the existing `@langwatch/user-web`.
`/settings/scim` is SPLIT-BLOCKED and is the only key of this family left in
`platform/app`.

#### THE OWNERSHIP RULE DECIDED ALL THREE, AND IT SPLIT THEM THREE WAYS

The credentials family's rule read strictly — a key belongs to the family that
owns its TRANSPORT, with the type rule as the exception — puts the three keys in
three different places, which is why "settings S7 identity" was never one family:

- **`audit-log` → `organization`.** `organization.getAuditLogs` and
  `organization.getOrganizationWithMembersAndTheirTeams` are mounted from
  `@langwatch/organization-server`, a CORE package. `EnrichedAuditLog` is the
  organization contract's. The only thing on the page that is not this feature's
  is the plan gate, which is one boolean off `limits.getUsage`. New package.
- **`authentication` → `user`.** Every tRPC call on the page is `user.*` —
  linked accounts, whether a password exists, and the two password writes.
  `@langwatch/user-web`'s own description already claimed the subject ("their
  credentials"). Folded in rather than given a package of its own, which would
  have duplicated a host port that already declares who is signed in.
- **`scim` → enterprise scim, which has no web package.** `scimToken.*` is
  `@langwatch/enterprise-scim-server`'s and `ScimTokenSummary` — `{ id,
connectionId, description, createdAt, lastUsedAt }`, exactly the row the table
  renders — is `@langwatch/enterprise-scim-contract`'s. Both rules agree, so the
  key belongs in an enterprise web package that does not exist, and mounting one
  means a SECOND enterprise dependency on `apps/ui`.

**THE "STRUCTURAL BLOCK" IS A POLICY COST, NOT AN IMPOSSIBILITY, and the S3 row
overstates it.** `apps/ui` ALREADY depends on `@langwatch/enterprise-governance-web`
and carries the `enterprise-direction` finding for it; governance shipped with
that finding recorded rather than blocked. So `packages/enterprise/composition/ui`
is what would RETIRE the finding, not what makes the move possible. `scim` is
recorded as blocked because this move did not have the standing to add a second
such edge, not because the edge cannot exist. Whoever takes S3 billing should
start from that correction.

#### A NEW PACKAGE FOR ONE 662-LINE PAGE, AND WHY THAT IS RIGHT

`@langwatch/organization-web` exists for one screen, and it is the secret-web
call taken a second time: `organization` is the widest contract in the platform
and the audit trail will not be its only surface — S1 (org / members / teams) is
five more keys of the same transport, and its ranking row's blocker
(`OrganizationUserRole` has no contract home) is a CONTRACT decision, not a
package one. The package, its host port, its procedure map and its testing
harness are all in place for it now.

#### THE CONTRACT MOVE IS A REAL REPOINT, AND IT FOUND A DUPLICATE

`EnrichedAuditLog` existed TWICE: exported from
`platform/app/src/server/app-layer/organizations/repositories/organization.repository.ts`
and restated privately inside `@langwatch/organization-server`'s
`organization.app.ts`, field for field. The producer is packaged, so the ruling
allows the real fix: the type is declared in `@langwatch/organization-contract`,
`OrganizationApp.getAuditLogs` is annotated with it, and the package's private
copy is deleted. The PLATFORM declaration stays — three other platform modules
read it and deletes-only forbids repointing them — so the duplicate is halved
rather than closed, and it closes when the organization app-layer moves.

#### THE THIRD WIRE, AND THE SECOND KIND OF SPLIT

The credentials family carved out `apps/ui/src/behavior` for a wire whose other
side is a published binary. This family put two more things there, and only one
of them is a wire:

- **`ui-passkeys.ts` is a wire.** Four better-auth ceremonies plus
  `/link-social`, and a screen may name neither `better-auth` nor `fetch`. What
  the screen SAYS about an outcome is pinned in `@langwatch/user-web`; what an
  outcome MEANS is pinned in `apps/ui/tests/ui-passkeys.unit.test.ts`. THE
  READING THAT MATTERS is that better-auth reports a device prompt the person
  DISMISSED as an error with STATUS ZERO. Reading that as a failure is telling
  somebody off for a decision, and it is invisible from a render — sabotaging
  `error.status === 0` to `false` turns exactly one wire test red and no screen
  test at all.
- **`ui-file-download.ts` is not a wire, it is a SAVE.** The audit trail's CSV
  export is the one place in this family where a screen hands the reader a FILE,
  and a screen may not mint an object URL, synthesise an anchor or click one. So
  the same split applies to a different kind of browser ability: WHAT the file
  contains is decided in `@langwatch/organization-web` and pinned there, HOW it
  reaches the disk is `apps/ui`'s. All three ways to get the sequence wrong are
  SILENT — a detached anchor's click does nothing, a URL revoked before the click
  cancels the save it was racing, and one never revoked leaks a blob for the life
  of a page whose whole purpose is repeated exports — which is exactly why it was
  worth taking out of a 662-line page body.

#### THE EXPORT IS THE PROPERTY THIS FAMILY ACTUALLY TURNS ON

`/settings/audit-log?targetKind=virtual_key&targetId=vk_…` is a link the gateway
detail pages write, and the Export CSV button walks the whole filtered history.
An export that widened past the filters on screen would hand a compliance
reviewer rows they did not ask for and did not know they had — a DISCLOSURE
DRESSED UP AS A CONVENIENCE. The screen sends ONE filter object to both the table
and the export, and `audit-log.screen.test.tsx` asserts it; blanking `targetKind`
in that object turns it red.

#### FOUR THINGS THE PLATFORM PAGE DID THAT ARE NOW BETTER, EACH NAMED

- **A failed export told the CONSOLE.** `console.error` and a button that had
  visibly done nothing. It is a `failed` notice now. A report that did not arrive
  is exactly what a compliance reviewer has to be told about.
- **The range control could not name four of its own eleven presets.** The
  platform label matched calendar days BEFORE sub-day windows, and every window
  shorter than a day spans one calendar day — so picking "Last 1 hour" relabelled
  the trigger "Today". The order is reversed here.
- **An Auth0 account id with no strategy in it rendered an EMPTY label.** The
  platform code passed `"unknown"` as the default and then never reached it: an
  empty string is not nullish, so `titleCase("")` won. A row in a list of
  sign-in methods with no label at all.
- **`ChangePasswordDialog`'s inputs were never asserted to be masked.** Three of
  them, every one a credential. Sabotaging one to `type="text"` now turns the
  suite red.

#### THE AUTHORED MESSAGE, AND WHY IT COULD NOT JUST BE DROPPED

`user.changePassword` throws ONE customer-authored sentence: a 401 saying WHICH
password was wrong. `BrowserUiFeedback` resolves copy from an error CODE, and an
authored non-5xx `TRPCError` carries none — so the move would have degraded it to
"something went wrong on our side", telling the reader to wait for something that
will never change. The narrowed reader
(`@langwatch/user-web`'s `model/handled-error.ts`) travels with the family and the
sentence rides `UiFailureNotice.description`, which the capability uses ONLY where
there is no code, so it can never talk over registered copy. BOTH of the platform
guard's layers travelled: the server's own `data.authored` flag, and the
independent machine-prose refusal, because the cost of being wrong is a Prisma
string in front of a customer.

#### A FOURTH SIGHTING OF THE FEATURE-PARITY TRAP, AND A NEW SHAPE OF IT

**A `@scenario` ON A LINE OF ITS OWN INSIDE A DOCBLOCK BINDS NOTHING.**
`isFollowedByTestCall` scans forward from the end of the annotation and expects
`it(` after whitespace and complete comments; a `*/` on the next line is neither,
so the annotation is silently discarded. Only `/** @scenario … */` on ONE line
above the test binds. **47 scenario titles across the repo are annotated ONLY in
the multi-line form**, including one in `apps/ui/tests/ui-page-guard.unit.test.tsx`
— an `@regression @rbac` scenario about a principal who manages the organization
but cannot read governance, which has been reading as unbound since it was
written. That one is restored here (additively, a second single-line annotation);
the other 46 are recorded and untouched.

The four specs this family touches, before and after:

- `specs/audit-log/audit-log.feature`: **0 of 17 enforced → 20/20 bound.** Every
  page-level scenario was `@unimplemented` and the file said why in a comment —
  "no JSDOM render integration test exists for it yet". Two of the seventeen were
  simply un-`@unimplemented`ed; EIGHTEEN more were written for behaviour that held
  before the move and had never been stated: the
  export's filter fidelity, its batch walk, the truncation marker, the file's
  arrival, the plan gate, the empty state, the system-actor row, and the whole
  address-carried filter and paging surface.
- `specs/settings/change-password-auth0.feature`: 14/16 → **19/19 bound.** Four
  scenarios written for the linked-methods list, which had none, plus the masking
  pin and the page's absence of a guard. Two scenarios' PROSE was corrected: they
  described a "Failed to change password" toast carrying the server's message,
  which #5984 stopped being true.
- `specs/identity/passkeys.feature`: **four settings scenarios un-`@unimplemented`ed
  and three written.** The section shipped with no render test at all.
- `specs/licensing/self-hosted-enterprise-discovery.feature`: 4/4, preserved.

#### The page guards, and the pair of them

`/settings/audit-log` carries `organization:manage` and `/settings/authentication`
carries NOTHING, and asserting the two together in one file is the point: the
audit trail names who did what from every address in the organization, and the
sign-in methods page is the reader's own account. A page-level refusal on the
second would leave a member with no way to change their own password.
`organization-page-policy.integration.test.tsx` asserts both directions of the
first and the absence of the second; swapping `manage` for `view` turns it red.

#### Known costs, all reported rather than suppressed

- **4 new architecture-lint findings (821 → 825), and THREE of them are one
  import.** `ContactSalesBlock` from `@langwatch/enterprise-billing-web` costs a
  `cross-feature`, an `enterprise-direction` and a `ui-screen-closure` on
  `@langwatch/organization-web`. `@langwatch/authz-web` and
  `@langwatch/gateway-web` each carry the SAME THREE for the SAME component, so
  this is the third instance of a documented edge rather than a new class. The
  fourth is `@langwatch/platform-api-client` in the procedure map, the line every
  family carries. `+2` on the oxlint side (2,590 → 2,592), both the same import.
- **`ui-screen-owner` REFUSES A SECOND SCREEN ENTRY PER FRONTEND FEATURE.** The
  obvious shape — `@langwatch/user-web/screens/authentication` beside
  `screens/personal-workspace` — is exactly what that rule exists to stop: an
  entry's id must match the frontend feature composing it, so ONE feature mounts
  ONE entry. The screen rides `personalWorkspaceScreens` instead, which is the
  api-key family's shape (one entry, two screens at unrelated addresses) reached
  by a different route. Worth knowing before the eighth family designs an export.
- **`@langwatch/enterprise-licensing-server` and `@langwatch/enterprise-scim-server`
  PROCEDURES ARE ADDRESSED AND NEITHER PACKAGE IS IMPORTED.** A procedure map
  names STRINGS. `license.getSsoGateStatus` and `limits.getUsage` cost
  `@langwatch/user-web` nothing, the same way `routingPolicy` costs
  `@langwatch/gateway-web` nothing. The enterprise-direction rule is about
  manifests; only a TYPE or a COMPONENT crosses it.
- **`authClient.useListPasskeys()` WAS REACTIVE AND A PORT METHOD CANNOT BE.**
  The plugin re-ran its own hook after each of its writes; the section re-reads
  the list explicitly after every ceremony that changes it. Same thing on screen,
  stated rather than implied.
- **The project switcher is the same recorded chrome gap**, and this family loses
  least by it: the audit trail's own Project filter already narrows the table to
  any project in the organization.
- **`PeriodSelector` and `NavigationFooter` are narrowed family-local copies.**
  343 and 443 lines with twenty-odd and two callers respectively; what travelled
  is presets-only (no absolute inputs, no "All time") and offset-only (no cursor
  mode, no scroll id, no tRPC total-hits hook — the platform footer's own docblock
  says the audit log never used them). `disambiguateLabels` was EXCLUSIVE and
  moved with its suite; its docblock named three prospective callers and none
  ever arrived.
- **`Link` is the fifth copy of a dozen lines of policy** — user-web, gateway-web
  and governance-web carry the same one. A web package may not import another web
  package, so the alternative is a surface publishing twelve lines.
- **ZERO new `platform/app` typecheck errors**: 18 in 13 files, the attributed
  baseline, none of them this family's. Nothing outside the two families imported
  any deleted file.
- **Six sabotages, each caught red then restored**: the audit-log page guard
  (`manage` → `view`), the export's target filter (blanked, so the report widens),
  the object URL revoked before the click, the new-password input's
  `type="password"`, `readPasskeyOutcome`'s zero-status branch, and the authored
  message on a rejected password change.

#### The fourteenth family's own additions, for whoever moves the fifteenth

- **A FAMILY IS NOT A FAMILY BECAUSE THE SETTINGS MENU GROUPS IT.** Three keys
  sat under one heading and belonged to three different features. Survey the
  TRANSPORT of every key in a ranking row before believing the row's count; this
  one moved two, blocked one, and created a package the row did not name.
- **CHECK WHETHER A "STRUCTURAL BLOCK" IS STRUCTURAL.** The S3 row says `apps/ui`
  may not import enterprise web. It already does, and has since governance. The
  finding is a recorded cost, and the composition package RETIRES it rather than
  enabling anything.
- **A HOST PORT CAN CARRY A SAVE AS WELL AS A WIRE.** `download` is the first
  port method that hands the reader a file. The split is the credentials
  family's, applied to a browser ability rather than to an HTTP call, and it is
  what made three silent ordering bugs assertable.
- **AN ENTERPRISE PROCEDURE PATH IS FREE; AN ENTERPRISE TYPE IS NOT.** Before
  concluding a key is enterprise-blocked, separate the two. Two of this family's
  keys address enterprise procedures and neither pays for it.
- **CHECK THE FORM OF EVERY `@scenario` YOU WRITE.** The multi-line docblock form
  reads correctly, formats correctly, and binds nothing. Run
  `pnpm check:feature-parity` after writing the tests, not after writing the spec.

### analytics — MOVED. 9 keys, 8 screens, 72 platform files, 0 insertions, 13,642 deletions

Moved fifteenth, and the largest since ops. It is the first family where the
OWNERSHIP RULE WAS OVERRULED rather than obeyed, the first to relay out a
destination package that already had 6,150 lines of its own in it, and the
first to give a package a real-browser test lane.

Destination `@langwatch/analytics-web`, which existed and served the LangWatchQL
workbench. Governing it meant relaying the whole package out first: 46 modules
from `src/{components,logic,hooks,visualization}` and two flat root files into
`model`, `behavior` and `ui/{elements,blocks,sections}`, with 177 tests green
before and after — which is what made it safe to do in one step, the same
property the annotation relayout leaned on.

#### THE TRANSPORT RULE PUT THREE KEYS ELSEWHERE, AND THEY ARE HERE ANYWAY

The credentials family's rule read strictly — a key belongs to the family that
owns its TRANSPORT, with the type rule as the exception — sends
`/analytics/reports` and both custom-chart keys to `@langwatch/dashboard-server`.
`reports` names ONLY `dashboards.*` and `graphs.*`; the builder stores through
`graphs.create` / `graphs.updateById` / `graphs.getById`. Four reasons put them
here, and they are recorded on `analyticsScreens` so the call is auditable:

1. **THE RULE ALREADY DISAGREES WITH ITSELF IN THIS VERTICAL.** The application's
   own mount file says `analytics.savedWorkbenchCharts` belong to
   `@langwatch/dashboard-server` "even though the namespace a member reaches them
   through is `analytics.savedWorkbenchCharts`". Namespace and subject are
   already crossed here, so the rule cannot be applied mechanically.
2. **THE TYPE RULE — THE RULE'S OWN EXCEPTION — POINTS HERE FOR ALL NINE.**
   `graphPayloadSchema` is `z.record(z.string(), z.unknown())`: the dashboard
   contract deliberately declines to know what it stores. The type the screens
   name is `CustomGraphInput` — series, aggregations, group-bys, filter fields —
   which is the analytics registry's vocabulary end to end.
3. **A SPLIT COSTS A SECOND COPY OF THE RENDERER.** `CustomGraph` is 1,677 lines
   and is the single engine behind six of the nine screens, the report grid's
   cards AND the builder's preview. A web package may not import another web
   package, so splitting means duplicating it plus the layout, the filter rail,
   the period control and the filter catalogue — about 3,500 lines to honour a
   namespace. S7's ruling generalises: a cross-feature procedure PATH is free, a
   cross-feature 1,677-line component is not.
4. **ADDRESSING FOUR FEATURES COSTS NOTHING.** The map names `analytics.*`,
   `dashboards.*`, `graphs.*`, `traces.getTopicCounts`, `monitors.getAllForProject`
   and `licenseEnforcement.checkLimit` as STRINGS. No server package is imported;
   two CONTRACTS are, and `cross-feature` exempts a contract by construction
   (`isImplementationTarget = target.kind !== "contract"`).

RECORDED: if a `@langwatch/dashboard-web` is ever created, those three keys are
the ones to re-examine, and the first blocker to look at is publishing the
custom-graph renderer as a SURFACE rather than copying it.

#### NINE KEYS, EIGHT SCREENS, AND THE BUILDER TAKES ITS MODE AS A PROP

Seven addresses are their own screen; `/analytics/custom` and
`/analytics/custom/:id` are one screen told which it is. The automations
tab-as-prop shape, applied to a form — and the failure it prevents is specific:
the two keys pass every other assertion when swapped, and land a reader on a
blank builder at the address of a saved chart. `analytics-page-policy.integration.test.tsx`
asserts the pairing by name, and swapping it turns two tests red.

ALL NINE CARRY THE SAME GRANT. Every one of the nine platform page files was
`withPermissionGuard("analytics:view")`, so unlike annotations there is no
asymmetry to carry and none to invent. The policy is asserted in both
directions, key by key, so a later tidy-up cannot widen or narrow it quietly.

#### THE SIX `~/server` MODULES, AND HOW EACH RESOLVED

- **`server/filters/types`** — a REPOINT. `filterFieldsEnum` and `FilterField`
  were already published, field for field, by `@langwatch/analytics-contract`;
  the platform module is a duplicate that predates the contract. The package
  names the contract, and `model/analytics-filter-definition.ts` restates only
  `FilterDefinition`, the reader-facing half the contract does not carry.
- **`server/filters/registry`** — an UN-NARROWABLE COPY, taken anyway. The rail
  renders every field, so there is nothing to leave behind; the annotations
  family's test for a safe vocabulary copy fails here the same way. What makes
  it honest is that the enum half is a repoint rather than a third declaration,
  and `analytics-filter-catalogue.unit.test.ts` asserts the copy answers for
  EVERY field the contract enumerates — so a field added there without an entry
  fails a test rather than disappearing out of the rail.
- **`server/analytics/registry`** and **`server/analytics/types`** — COPIES.
  Both are pure vocabulary (metrics, groups, pipelines, aggregation names, the
  shared filter schema) with no server dependency; they sit under `~/server` by
  historical placement alone. Roughly thirty platform modules still read them.
- **`server/analytics/utils`** — twenty-one lines of `filterOutEmptyFilters`,
  folded into `model/analytics-filter-params.ts` with the reading half of
  `useFilterParams`, and unit-tested for the first time.
- **`server/analytics/chartKinds`** — two strings that ARE the wire. Copied with
  a test that pins the values rather than the identity, because a copy that
  disagrees is a report grid drawing the wrong editor.

`~/server/api/root`'s `AppRouter` — the seventh, which every family hits — is
gone from both places that named it: the chart's four `UseTRPCQueryResult<…>`
annotations and the filter editor's one are now structural types over the
package's own payloads, which cannot drift from the wire.

#### WHAT DID NOT TRAVEL, EACH NAMED

- **THE ALERT SHORTCUTS.** Four call sites — the report card's bell and "Add
  alert", and the builder's two — called `openDrawer("automation", …)`. That
  registry entry was DELETED when the automations family moved, so all four had
  not compiled since; deleting them RETIRES four of that move's seven recorded
  platform breaks. Alerts already authored still fire and the automations pages
  still edit them; what is gone is the shortcut from a chart to its alert.
  Recorded as the first customer of a cross-feature overlay capability.
- **THE LEGEND'S MEMORY.** `CustomGraph` remembered which series a reader had
  clicked out of the legend under `analytics:hidden:<projectId>:<graphId>` in
  the browser's key-value store. A governed screen may not touch that store, so
  the toggle now lasts as long as the page. Not smuggled through the host port:
  a per-viewer convenience is not something the application should answer for.
- **THE SAVED-VIEW FALLBACK.** `useFilterParams` read a saved view out of the
  same store when the address named no filter. The bar that WRITES those keys is
  `DashboardPageBody`'s `SavedViewsBar` — chrome a packaged screen has nothing
  above it to supply — so the mode was not merely unreachable here, it was
  unwritable. The annotations family recorded the same loss on `/annotations/all`.
- **"SAVE AS VIEW"**, for the same reason: the button opened a dialog belonging
  to a bar that is not on the page.
- **THE LANGY CONTEXT TARGET** on the overview's dashboard cards.
  `@langwatch/langy-web` is ungoverned and every consumer compiles its source,
  which needs an `es2023` library and a stylesheet declaration this package
  would have had to adopt globally — the me and automations families' refusal,
  for the third time.
- **THE REGISTRY'S WORDS.** Four suites asserted the code-keyed presentation
  registry's exact copy. The registry is `platform/app`'s; the package alert says
  what that registry itself says for a code it does not list. Each assertion
  moved to the property a package can still prove — WHICH code reached the
  renderer, which STATE the pane chose, and that the wire message (which since
  #5984 IS the code slug) never reaches a reader.

#### WHAT THE CLOSURE COST

- **Two overlays became inline dialogs and their registry entries died with
  them**: `dashboardName` and `seriesFilters`. The second is the more
  interesting: it was opened through `openDrawer` after a separate
  `setFlowCallbacks("seriesFilters", { onChange })` — a registry-wide side
  channel that exists only because an address carries strings and not functions.
  Mounted inline, `onChange` is a prop.
- **Eight platform modules stay and travelled as copies**, each with a consumer
  the move does not own: `CustomGraph` (the project home's traces overview and
  the report-chart service), `ChartTooltip` (DSPy experiments), `FilterToggle`
  and `FilterIconWithBadge` (checks' Try-it-out), `FilterSidebar`,
  `FieldsFilters`, `SaveAsViewButton` and `TopicsSelector` (all reached from
  Try-it-out through the sidebar), plus `PeriodSelector` and `useFilterParams`,
  which twenty-odd non-analytics modules read.
- **`components/automations/FilterDisplay` was DELETED**, and that closes a loop.
  The automations family recorded that it had to stay because the analytics
  report grid still rendered it; that indicator left with this move, the module
  had no other importer, and a file nothing reaches is not a file to keep. Two
  package copies of forty lines remain, one per family.
- **Nine promotions to the Design System instead of copies**: `checkbox`,
  `dialog`, `confirm-dialog`, `toaster`, `small-label`, `rotating-colors`,
  `page-layout`, `drawer` and `shiki` all already existed there, and
  `rotating-colors` is byte-identical to the platform module the charts read.
  `RenderCode` was the one that could not be reused — it highlights through
  `@langwatch/trace-web` — so `ui/elements/code-snippet.tsx` reaches the same
  Shiki adapter through the Design System, the gateway family's shape.
- **`Link` is the SIXTH copy of a dozen lines of policy** — user-web,
  gateway-web, governance-web and organization-web carry the same one. Six is
  the point at which a surface publishing twelve lines starts to look cheaper
  than the sixth copy; recorded rather than built, because a page move does not
  own the Design System's boundary.

#### THE PACKAGE GAINED A BROWSER LANE, AND CI DOES NOT RUN IT

Four `*.browser.test.tsx` files came with the workbench: Vega draws to a canvas,
loads its own grammars and refuses `eval`, and jsdom can observe none of it. They
could not stay in `platform/app` — every one imported a component that left —
and deleting four real-browser guarantees to avoid the problem is worse than
having them, so the package took `vitest.browser.config.ts`, a
`test-setup.browser.ts` and a `test:browser` script.
`.github/scripts/run-package-suites.sh` invokes a package's `test:unit` or
`test` and nothing else, so the lane runs locally and nowhere else. STATED IN
THE CONFIG'S OWN DOCBLOCK rather than left to be discovered; closing it is one
step in `langwatch-app-ci.yml` beside the application's browser lane.

#### TWO INHERITED DEFECTS, ONE FIXED AND ONE HALVED

- **`vegaLazyBoundary.unit.test.ts` HAD NEVER RUN.** It used `LAZY_BOUNDARIES`
  and declared it nowhere, so the file threw `ReferenceError` on load and vitest
  reported "no tests" — a bundle guarantee that had been reading green while
  pinning nothing. Proved by running it in `platform/app` before the move.
  Declared here, both boundaries named, and the suite is 7 green tests that
  actually walk the import graph.
- **`CustomGraph`'s outer wrapper is a no-op gate.** It called `usePublicEnv()`
  and passed `load={!!publicEnv.data}`; without `includeCapabilities` that hook
  returns a static object, so the flag has always been `true`. The port method
  it would have needed was dropped rather than declared inert, and the wrapper
  now just forwards.

#### Known costs, all reported rather than suppressed

- **5 new architecture-lint findings, 25 retired** (827 measured before, 805
  after; the extra two retired belong to a worker lane running concurrently).
  Mine: `ui-screen-closure` for `@langwatch/platform-api-client` in the procedure
  map — the line every family carries — and FOUR `ui-web-public-entry`, for the
  package's `.`, `./chart`, `./validation` and `./visualization` exports. All
  four have `platform/app` importers outside this family (`app/api/analytics-sql`,
  `runtime/app/features/dashboard-saved-workbench-chart-policy.adapter.ts`, two
  router suites), and deletes-only forbids repointing them. This is the first
  family to bring FOUR such entries rather than one, because the destination was
  already a published library rather than a new package.
- **oxlint: 3,148 → 3,148, a delta of ZERO.** Twenty violations arrived with the
  copied files (`eqeqeq` on literal comparisons, bare `@ts-ignore`, one
  `no-else-return`, two dead initialisers) and every one was fixed in the COPY —
  behaviour-identical in each case, and the platform originals keep theirs
  because deletes-only forbids touching them.
- **ZERO new `platform/app` typecheck errors, and FOUR retired**: the attributed
  baseline goes from 18 errors in 13 files to **14 in 11**. The four are the
  automations family's alert-drawer breaks in `GraphCardHeader` (×2) and
  `pages/[project]/analytics/custom/index.tsx` (×2). Three of that move's seven
  remain, in `FieldsFilters`, the command bar and `AutomateButton`.
- **A FALSE EXCLUSIVITY CALL, CAUGHT BY THE TYPECHECKER.** `FilterSidebar`,
  `FieldsFilters`, `SaveAsViewButton`, `TopicsSelector`, `ChartErrorState`,
  `SummaryMetric` and `formatChartDate` were deleted on a precise
  import-specifier survey that missed `components/checks/TryItOut`, which
  imports the sidebar by a RELATIVE path the survey's regex did not match. Four
  broken platform files was the whole cost, and restoring them was one
  `git checkout`. The lesson is in the additions below.
- **`specs/analytics/analytics-pages.feature` is new and 15/15 bound.**
  `analytics-lwql-workbench.feature` was 5/34 before this move and is 5/34
  after: no binding was lost by the move, and the 29 that were unbound stay
  unbound — they describe the workbench's server half.
- **Seven sabotages, each caught red then restored**: the unknown-bucket filter
  on a grouped chart, the page guard's grant, the builder's mode per key, the
  overlay address's stale-key clearing, the period memo's stability, the range
  write's removal of the preset, and the filter catalogue's exhaustiveness over
  the contract.

#### The fifteenth family's own additions, for whoever moves the sixteenth

- **A PRECISE SURVEY IS STILL A REGEX.** The exclusivity sweep matched
  `from "…components/filters/FilterSidebar"` and missed
  `from "../filters/FilterSidebar"` — a relative path from a sibling directory,
  which is the one shape a path-anchored pattern cannot see. Before deleting a
  module, grep its BASENAME as well as its path, and read the difference between
  the two lists rather than trusting the narrower one.
- **RELAY OUT THE DESTINATION FIRST, AND PROVE IT BY THE TEST COUNT.** Governing
  a package that already has content turns on four rules at once
  (`ui-web-root-flat`, `ui-web-root-components`, `ui-web-private-layout`,
  `ui-web-layer-direction`) — 63 findings here, measured by adding the package
  to `governedWebPackages` and running the lint BEFORE writing a line of the
  move. Do that measurement first; it is thirty seconds and it decides the shape
  of the whole slice.
- **`ui-web-layer-direction` DECIDES WHERE A COMPONENT LIVES, NOT TASTE.** Only
  `sections` may touch `behavior`, so anything that calls a hook is a section
  whatever it looks like. A barrel that re-exports sections belongs beside them,
  not under `model` — moving `chart.ts` was the fix, and exempting it was not.
- **THE FIRST OVERRULED OWNERSHIP CALL, AND WHAT MADE IT DEFENSIBLE.** Not that
  the split felt awkward: that the repo already held the opposite position in
  writing, that the type rule pointed the other way for all nine keys, and that
  the alternative was a named number of duplicated lines. If the next family
  overrules the rule, it owes the same three.
- **A COPIED VOCABULARY NEEDS AN EXHAUSTIVENESS TEST, NOT A COMMENT.** The
  annotations family refused a catalogue copy because there was nothing to
  narrow. The way to take one anyway is to keep the ENUM in the contract and
  assert the copy answers for every member of it — then a field added upstream
  fails a test instead of vanishing from a filter rail.
- **A TEST THAT REPORTS "no tests" IS A TEST THAT IS NOT RUNNING.** Vitest counts
  a file that throws on load as a failed FILE and zero tests; on a shard of a
  thousand, that reads as noise. When a suite moves, check its test COUNT
  survived, not just that the run is green.

### evaluations/evaluators — MOVED (3 of 7 keys). TWO packages, 12 platform files, 0 insertions, 1,598 deletions

Moved sixteenth, and the second family whose keys did not all move. Three of
seven went: `/:project/evaluators` to `@langwatch/evaluator-web`,
`/:project/online-evaluations` to a NEW `@langwatch/monitor-web`, and
`/:project/evaluations/wizard` to a route-table redirect with no loader at all.
The other four stay in `platform/app`, each for a reason argued with a number
below.

#### THE OWNERSHIP RULE SPLIT SEVEN KEYS FOUR WAYS, AND "EVALUATIONS" WAS NEVER ONE FAMILY

The credentials family's rule read strictly — a key belongs to the family that
owns its TRANSPORT, with the type rule as the exception — puts the ranking row's
seven keys in four different places:

- **`evaluators` → evaluator.** Every tRPC call is `evaluators.*`, mounted out of
  `@langwatch/evaluator-server`; every type is `@langwatch/evaluator-contract`'s
  (`Evaluator`, `EvaluatorCopy`, `EvaluatorHistoryEntry`). Transport and types
  agree, so there was nothing to argue.
- **`online-evaluations` → monitor.** The list and every write are `monitors.*`,
  mounted out of `@langwatch/monitor-server`, and the row is
  `@langwatch/monitor-contract`'s. NEW PACKAGE.
- **`evaluations/wizard` and `evaluations/wizard/:slug` → experiment.** The only
  read is `experiments.getExperimentBySlugOrId` and the branch turns on
  `ExperimentType` and `workbenchState`. The no-slug half needed no read at all
  and is retired; the `:slug` half is blocked (below).
- **`evaluations/:id/edit`, `.../edit/choose` → monitor**, and blocked on size
  rather than on ownership (below).
- **`experiments/index` → experiment**, and it never was this family's. The
  module `pages/[project]/evaluations.tsx` is the EXPERIMENTS page end to end:
  `ExperimentsPage`, its `GuardedExperimentsPage` export, and a dead default
  export that a route-table redirect replaced in an earlier slice. Splitting
  along ownership means it stays untouched, and it did — not one line of it is
  in this diff.

#### A NEW PACKAGE FOR ONE SCREEN, AND WHY NOT ONE PACKAGE FOR BOTH

`@langwatch/monitor-web` exists for one 256-line page. That is the
`@langwatch/organization-web` call taken a third time, and the same three things
make it right: `monitor` is a wide contract, this will not be its only surface
(the online evaluation drawer, the guardrails drawer and the legacy edit form
are three more screens' worth of the same transport, each blocked today for a
recorded reason rather than for want of a package), and the alternative — riding
in `@langwatch/evaluator-web` — fails the type rule in both directions.

ONE THING POINTED THE OTHER WAY AND IS RECORDED RATHER THAN SUPPRESSED.
`@langwatch/evaluator-web` published `online-evaluation-performance-preview`, a
component named for the online evaluations page and consumed by nothing else.
That is a misplacement, not a claim of ownership, so the MODULE moved into
monitor-web rather than the screen moving into evaluator-web — the gateway
family's `RoutingPolicyRowActions` ruling, applied a second time. The split cost
154 lines. The analytics family overruled the rule at 3,500; two orders of
magnitude below that number, the rule stands.

**AND THE MOVE FOUND THE TYPE DECLARED TWICE.** `OnlineEvaluationPerformance`
was restated field for field inside `@langwatch/evaluator-web` while
`@langwatch/evaluation-contract` already declared it and
`EvaluationService.getMonitorPerformance` was annotated with it. The producer is
packaged, so the S7 ruling allows the real fix: the moved module names the
contract's type and the private restatement is gone. Not halved — closed.

#### FOUR KEYS STAY, AND EACH ONE HAS A NUMBER

- **`evaluations/:id/edit` and `.../edit/choose` — BLOCKED ON THE CLOSURE, NOT ON
  OWNERSHIP.** The page body is `CheckConfigForm`, whose exclusive closure is
  ~1,800 lines (`TryItOut` 644, `EvaluationManualIntegration` 379,
  `EvaluatorSelection` 419, `PreconditionsField` 245,
  `EvaluatorLLMConfigField` 120) and whose SHARED closure is the problem: a copy
  of `DynamicZodForm` (662 lines, also read by two evaluator editors and the
  studio's properties panel), a copy of `components/traces/TracesMapping` (1,057
  lines, also the datasets family's), a copy of `~/server/tracer/tracesMapping`
  (1,414 lines with 31 importers — the trace feature's vocabulary, and
  `packages/features/trace` is another agent's live slice), plus
  `~/server/evaluations/{types,preconditions,evaluationMappings}` and
  `~/server/filters/{registry,types,precondition-matchers}`, and `TryItOut`
  alone drags `FieldsFilters` (967) and `~/server/api/root`'s `AppRouter`.
  **About 8,000 lines of copies to move a legacy form the online evaluation
  drawer superseded.** It also names `EvaluationExecutionMode` as a VALUE out of
  the generated Prisma client, which a governed screen may not — resolvable
  through `monitorExecutionModeSchema`, and irrelevant next to the size.
  RECORDED: these two keys move when `~/server/tracer/tracesMapping` and
  `components/traces/TracesMapping` are packaged, which is the trace family's
  work and not a page move's.
- **`evaluations/wizard/:slug` — BLOCKED ON PROPORTION.** Its transport is
  `experiments.*` and its branch reads `ExperimentType` and `workbenchState`, so
  it belongs in `@langwatch/experiment-web` — which is 100 files, 27,178 lines,
  ungoverned, and carries its own real-browser lane. Governing all of that for
  ONE redirect screen is the disproportion the S7 scim ruling names: recorded as
  blocked because this move did not have the standing, not because the edge
  cannot exist.
- **`experiments/index` — an anti-target, and the split along ownership was
  clean.** The shared module needed no platform insertion to split, because
  there was nothing of this family in it to take out.

#### THE WIZARD'S NO-SLUG HALF IS A ROUTE-TABLE ROW, NOT A SCREEN

`/:project/evaluations/wizard` with no experiment named did exactly one thing:
`router.replace(/${project.slug}/experiments/workbench)`. That is the gateway
family's `/gateway` ruling and the retirement `/:project/evaluations` already
had — a redirect row says the same thing without a loader — so the key is gone
and the module keeps only the `:slug` branch it still serves. THE `:slug` HALF
IS NOT THIS: with a slug the destination depends on what kind of experiment it
names, and a static forward would land a legacy experiment on a workbench that
cannot render it, which is what the page's own docblock exists to prevent.

#### THE WORST DRAWER SHARING IN THE PROGRAMME, MEASURED

The ranking row called this out and it was right. `openDrawer` call sites,
repo-wide:

| drawer                      | openers | outside this family | disposition                                                                                                          |
| --------------------------- | ------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `evaluatorEditor`           | 15      | 14                  | STAYS. Address only.                                                                                                 |
| `codeEvaluatorEditor`       | 4       | 3                   | STAYS. Address only.                                                                                                 |
| `evaluatorCategorySelector` | 5       | 4                   | STAYS. Address only.                                                                                                 |
| `onlineEvaluation`          | 4       | 2                   | STAYS. Address only.                                                                                                 |
| `guardrails`                | 1       | 0                   | STAYS: its opener moved, but it renders `EvaluatorSelectionBox` and opens `evaluatorList` (7 openers). Address only. |
| `evaluatorHistory`          | 1       | 0                   | **TRAVELLED**, inline, at `?history=<id>`.                                                                           |
| `evaluatorList`             | 7       | 7                   | Not this family's to move.                                                                                           |

So SIX of the seven overlays are addresses the moved screens write and nothing
opens under `apps/ui` — the same recorded chrome gap the coding-agent, me,
automations, annotations and analytics families carry for the same registry,
and **this family loses the most to it**: creating and editing an evaluator, and
creating, editing and guarding an online evaluation, are the primary actions of
both pages. What still works on the evaluators page is delete (with its
cascade), replicate, push-to-replicas, sync-from-source, history and the API
snippets; on the online evaluations page, the list, the performance, the
analytics link, pause/resume, replicate and delete.

`evaluatorHistory` is the exception the gateway ruling describes exactly: ONE
opener in the whole repository, so it was never an application drawer, and the
registry is composition where a screen only ever needed the address. The screen
keeps the evaluator in `?history=<id>` and renders the panel inline;
`platform/app`'s registered copy stays for the URL that still names it.

**`setFlowCallbacks("evaluatorEditor", …)` DID NOT TRAVEL AND COULD NOT.** The
platform page registered a callback so that saving a NEW evaluator closed the
drawer rather than walking back up the category → type → editor stack. That is a
registry-wide side channel that exists only because an address carries strings
and not functions — the analytics family found the same shape behind
`seriesFilters` — and it belongs to whoever owns the drawer. It is the single
most-registered flow key in the repository (13 production registrations, 12 of
them outside this family).

#### THE `~/server` MODULES, AND HOW EACH RESOLVED

Only ONE reached the moved closures, and it is the one three families have now
answered the same way:

- **`server/api/rbac`** via `hooks/useProjectsForCopy` —
  `hasPermissionWithHierarchy` and `teamRoleHasPermission`, imported into a
  browser hook. `@langwatch/authz-contract` publishes both, parity-tested
  against the rbac pair, and the derivation now lives in
  `apps/ui/src/model/ui-copy-targets.ts`.
- `server/api/root`'s `AppRouter` and `server/tracer/tracesMapping` are in the
  BLOCKED closures only, and are the reason they are blocked.

#### THE FOURTH COPY WOULD HAVE BEEN THE FIFTH, SO IT IS ZERO

The agents, prompts and datasets families each wrote the copy-target derivation
out privately in their own `apps/ui/src/features/<family>/model/`. This move
needed it for TWO more families at once, and authoring a fourth and a fifth
identical file in one commit is not recording a duplication, it is creating one.
It went into the GLOBAL model instead (`apps/ui/src/model/ui-copy-targets.ts`) —
a private frontend feature may import a global layer and only the reverse is
refused, so this costs no finding — and the three existing private copies are
untouched, because repointing them is a change to three other families' code
that a page move does not own. That module is where they fold in.

It is also the first time the derivation has been ASSERTED. Six tests, including
the two cases the platform hook handled only implicitly: a custom role whose
permission column has never been written falls through to the built-in role, and
an unrecognised legacy role string reads as the most restrictive one rather than
as permission.

#### WHAT DID NOT TRAVEL, EACH NAMED

- **THE LANGY CONTEXT TARGETS.** Both screens wrapped their rows in
  `LangyContextTarget`. `@langwatch/langy-web` is ungoverned and every consumer
  compiles its source, which needs an `es2023` library and a stylesheet
  declaration these packages would have had to adopt globally — the me,
  automations and analytics families' refusal, for the fourth and fifth time.
- **`SetupWithAgentButton`** on both empty states. 367 lines with seven
  importers outside this family, and it reaches `features/langy/useCanAskLangy`
  and `features/skills/setupPrompt`. The empty states keep their own create
  action and lose the agent shortcut.
- **THE REGISTRY'S WORDS.** `ReplicateToProjectDialog` and the generic
  `PushToCopiesDialog` reported failures through `showErrorToast` and
  `HandledErrorAlert`, both of which resolve copy from `platform/app`'s
  code-keyed presentation registry. The narrowed copies report through the host
  port's failure notice instead, so the registry still decides the words and the
  screens never compose a sentence over a code.

#### WHAT THE CLOSURE COST

- **Twelve platform files deleted, 1,598 lines.** Two pages, three exclusive
  evaluator components with two of their suites, three exclusive monitor
  components with one suite, one exclusive hook, three loader keys and one row
  of the loader parity suite's shared-module table.
- **Nine family-local copies**, each with a consumer this move does not own.
  Six are genuinely NARROWED: `CascadeArchiveDialog` → `evaluator-delete-dialog`
  (three entity types and four related lists down to one and two, which is
  exactly what `getRelatedEntities` answers), `ReplicateToProjectDialog` → two
  `*-replicate-dialog`s (the generic `title`/`entityLabel`/`onCopy`/`logError`
  seam collapsed, because the subject is known), the generic `PushToCopiesDialog`
  → `evaluator-push-to-copies-dialog`, `formatTimeAgo` (the compact half stayed
  behind) and `langwatchEndpointEnv` (the bare-URL half kept, the location made
  injectable). Three travelled whole because there was nothing to leave behind:
  `EvaluatorApiUsageDialog` (still rendered by `EvaluatorListDrawer`, and its
  substitutions are stated in the copy's own docblock), `NoDataInfoBlock` and
  `FullWidthListPageContent`.
- **`Link` is the SEVENTH copy of a dozen lines of policy** — user-web,
  gateway-web, governance-web, organization-web and analytics-web carry the same
  one. Recorded again, and the sixth-copy note now reads as an understatement.
- **Promotions to the Design System instead of copies**: `page-layout`,
  `dialog`, `confirm-dialog`, `drawer`, `menu`, `select`, `checkbox`,
  `list-table` and `shiki` all already existed there. `RenderCode` was the one
  that could not be reused — it highlights through `@langwatch/trace-web` — so
  `ui/elements/code-snippet.tsx` reaches the same Shiki adapter through the
  Design System, the gateway and analytics families' shape.
- **`@langwatch/evaluator-web` was relaid out first, and the test count proved
  it.** Twelve flat modules and a flat `__tests__` moved into
  `model` / `ui/{elements,blocks}` with 26 tests green before and after — the
  measurement the analytics family said to take before writing a line of the
  move. `evaluation-status.tsx` SPLIT on the way: `evaluationPassed` and
  `evaluationStatusColor` are pure vocabulary a counter reads, so they are
  `model`, and only `CheckStatusIcon` stayed an element.
  `ui-web-layer-direction` decided that, not taste.

#### THREE DEFECTS THE MOVE FOUND, ALL FIXED

- **THE EVALUATOR CARD'S ROW ACTIONS HAD NO ACCESSIBLE NAME.** The menu trigger's
  only child is an icon, so a screen reader announced "button" and nothing else —
  in a grid of them, with no way to tell which card one belonged to. The online
  evaluations table's trigger has always carried `aria-label="Actions for …"`;
  the card's now does too.
- **A REFETCH WIPED THE READER'S PUSH SELECTION.** `PushToCopiesDialog`'s effect
  depended on the query RESULT's identity, so a window refocus or an
  invalidation reset every checkbox while the dialog was open. The moved copy
  keys the reset on the replica IDS as a value, so it happens when the list of
  replicas actually changes. Found because the test-time hook returned a fresh
  array each render and the screen rendered forever — an infinite render loop
  that is a hang in a test and a wiped form in production.
- **THE API SNIPPETS' ENDPOINT WAS UNASSERTABLE.** `langwatchEndpointEnv` read
  `window.location` inline, so nothing could pin either branch; getting them the
  wrong way round hands a self-hosted customer a snippet that posts their traffic
  and their key to `app.langwatch.ai`. The copy takes the location as an
  injectable parameter — `@langwatch/gateway-web`'s `docs-url` shape — and both
  branches, the port handling and the no-document fallback are pinned.

#### Known costs, all reported rather than suppressed

- **3 new architecture-lint findings, 0 retired** (805 measured before, 821
  after; the other +13 belong to a trace slice running concurrently in the same
  tree and are named below). Mine: TWO `ui-screen-closure` for
  `@langwatch/platform-api-client` in the two procedure maps — the line every
  family carries, once per package — and ONE `ui-web-public-entry` for
  `@langwatch/evaluator-web`'s root `.` export. THIRTEEN `platform/app` modules
  import that entry (the trace span detail, four evaluator drawers, the checks
  Try-it-out and the evaluator editors) and deletes-only forbids repointing a
  single one, so it stays and the finding is recorded. `@langwatch/monitor-web`
  is new and exports only its screen, so it brings none.
- **oxlint: 3,148 → 3,255, and the delta attributable to this move is ZERO.**
  All 107 arrivals are in three `packages/features/trace/server` files a
  concurrent slice added. Every file this move authored or copied is clean under
  `.oxlintrc.architecture.json`, checked one file at a time.
- **ZERO new `platform/app` typecheck errors, and zero retired**: 14 errors in
  11 files before and after, the attributed baseline unchanged. Nothing outside
  the two families imported any deleted file, which a `grep` over each deleted
  basename confirmed before the deletion and after.
- **`specs/evaluations/evaluation-pages.feature` is new and 28/28 bound.**
  `experiments-online-evaluations-separation.feature` is 0 of 19 enforced before
  and after — every scenario is untagged, so it binds nothing, and six of its
  page-level scenarios are restated and bound in the new file rather than
  retagged in place, because the rest of that file is about navigation sections
  and agent skills this move does not touch.
- **Five sabotages, each caught red then restored** (table below).
- **One inherited red, NOT this move's**:
  `components/evaluators/__tests__/EvaluatorEditorMappingRender.integration.test.tsx`
  fails on `No "ColorfulBlockIcon" export is defined on the
"@langwatch/workflow-web" mock`, thrown from
  `packages/features/prompt/web/src/surfaces/variables/variable-mapping-input.tsx:153`.
  `ColorfulBlockIcon` arrived there in `af61da741a` (2026-08-29) and the test's
  mock was never widened; nothing in this move's diff is on that render path.
- **Foreign hunks in the tree, named**: `pnpm-lock.yaml` carries this move's two
  dependency additions plus a `retry-axios` peer-key normalisation pnpm wrote on
  its own; `packages/architecture-lint/src/service-quality-baseline.json` and
  every `packages/features/trace/**` and `apps/worker/**` change belong to the
  concurrent trace slice and were not touched.

#### Sabotage table

| #   | suite                                         | sabotage                                                                     | what turned red                                                 |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `evaluators.screen.test.tsx`                  | `hasRelated` forced to `true`, so every delete takes the cascade             | "takes the plain delete and never the cascade"                  |
| 2   | `langwatch-endpoint.unit.test.ts`             | `langwatchEndpoint` always answers the hosted address                        | all three self-hosted and fallback readings                     |
| 3   | `online-evaluations.screen.test.tsx`          | the legacy-wizard experiment lookup dropped, so Edit always opens the drawer | "goes to that experiment's workbench rather than to the drawer" |
| 4   | `evaluation-page-policy.integration.test.tsx` | `EVALUATORS_PAGE_PERMISSION` widened to `evaluations:manage`                 | both directions of the evaluators grant                         |
| 5   | `ui-copy-targets.unit.test.ts`                | `canCreate` hard-coded to `true`                                             | the closed project, and the unrecognised legacy role            |

#### Gate numbers, before and after

| gate                                 | before                    | after                                               |
| ------------------------------------ | ------------------------- | --------------------------------------------------- |
| `pnpm --filter @langwatch/ui test`   | 77 files / 667 tests      | **79 files / 682 tests**                            |
| `@langwatch/evaluator-web`           | 4 files / 26 tests        | **6 files / 41 tests**                              |
| `@langwatch/monitor-web`             | — (package did not exist) | **1 file / 12 tests**                               |
| `pnpm test:unit run src/runtime/ui`  | 1 file / 8 tests          | **1 file / 7 tests** (the retired wizard key's row) |
| whole-tree `pnpm typecheck`          | 14 errors / 11 files      | **14 errors / 11 files**                            |
| architecture-lint suite              | 332 tests                 | **332 tests**                                       |
| architecture-lint CLI findings       | 805                       | **821** (+3 mine, +13 the trace slice's)            |
| oxlint                               | 3,148                     | **3,255** (+0 mine, +107 the trace slice's)         |
| `git diff --numstat -- platform/app` | —                         | **0 insertions, 1,598 deletions**                   |

#### The sixteenth family's own additions, for whoever moves the seventeenth

- **A RANKING ROW'S KEY COUNT IS A GUESS ABOUT ADDRESSES, NOT ABOUT FEATURES.**
  Seven keys under one heading belonged to four features and produced three
  moves, one retirement and four recorded blocks. Survey the TRANSPORT of every
  key before believing a row — the S7 lesson, and this is its largest instance.
- **COUNT THE DRAWER OPENERS BEFORE COSTING THE MOVE, AND COUNT THEM BY KEY.**
  `openDrawer("<key>"` is a precise grep and it decides the whole shape: one
  opener means the overlay travels inline (gateway's ruling), more than one means
  it stays and the screen writes an address. This family had one of each and five
  of the other, and knowing that before writing a line is what kept the screens
  honest about what they can still do.
- **A TEST-TIME HOOK THAT RETURNS A FRESH ARRAY FINDS REAL RENDER LOOPS.** The
  push-to-replicas effect depended on a query result's identity. Under the real
  tRPC hook that is stable and the bug is invisible; under a mock it is an
  infinite loop, which reads as a hung vitest worker rather than as a failure.
  When a new screen suite HANGS, suspect an effect keyed on identity before
  suspecting the runner.
- **AN "UN-NARROWABLE COPY" HAS A LINE COUNT, SO SAY IT.** The edit page is not
  blocked because it felt big: it is blocked because moving it means copying
  ~8,000 lines including 1,414 of another feature's vocabulary that 31 modules
  read. A block argued with a number can be re-examined when the number changes;
  a block argued with a feeling cannot.
- **WHEN TWO FAMILIES MOVE IN ONE SLICE, THE SHARED HELPER GOES GLOBAL, NOT
  TWICE.** Three earlier families each kept a private copy of the copy-target
  derivation and each recorded it. Writing the fourth and fifth in the same
  commit would have been manufacturing the duplication rather than inheriting it;
  `apps/ui/src/model` takes it, costs no finding, and is where the other three
  fold in.

## Post-five-families re-ranking (2026-09-01 survey of the remaining keys)

82 keys → 80 distinct modules at survey time; the evaluations redirect
retirement below took it to 81 keys. Chrome baseline noise: every page's
raw closure drags 733 files through DashboardLayout → CurrentDrawer →
drawerRegistry (45 lazy drawers) → traces-v2's TraceDrawer; exclusive
closures are computed net of that.

**Dispatch order (effort = moving prod files + tests touching):**

| #   | Family                                                                                                                    | Keys | Effort | Gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | agents                                                                                                                    | 1    | ~2+0   | **MOVED** — see the section below. The estimate was wrong in one direction only: the platform adapter was 100% adapter, but three of the four generic dialogs it rendered were the application's and had to be taken as family-local copies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | settings S5 data governance                                                                                               | 4    | 5+5    | **MOVED** — see the section above. TWO keys, not four: `topic-clustering` belongs to the topic feature and `email-suppressions` to automation, both recorded rather than forced. The harvest landed, and the settings chrome is one wrapper for every family after this one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | datasets                                                                                                                  | 2    | 6+6    | **MOVED** — see the section above. Two keys, and the estimate held for the exclusive files; what it missed is that the detail page's whole spreadsheet editor has four non-Datasets callers, so it travelled as a narrowed family-local copy rather than as a move.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | settings S4 model config                                                                                                  | 2    | 7+6    | **MOVED** — see the section above. Two keys, and the file estimate held almost exactly (7 prod + 6 tests surveyed, 7 prod + 5 tests moved). What it missed is that all THREE of the family's drawers stay in `platform/app`, including one with no other opener, and that the AppRouter type it names is produced by a PACKAGED transport — so the contract move was a real repoint, and it found a live defect.                                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | prompts                                                                                                                   | 1    | 44+14  | **MOVED** — see the section above. ONE key, and the nine model copies landed as surveyed. What the estimate missed is that fourteen of the sixty-three closure files have callers outside the family, so they stay in `platform/app` with their tests and travel as narrowed copies: 56 files delete, not 44. The `~70 prompt fragment lines` were 39.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 6   | settings S7 identity                                                                                                      | 3    | 8+3    | **MOVED (2 of 3 keys), SPLIT-BLOCKED** — see the section above. The row's "a web package decision" was three decisions, not one: `audit-log` went to a NEW `@langwatch/organization-web` (core transport, core contract), `authentication` folded into `@langwatch/user-web` (every call on it is `user.*`), and `scim` is blocked because both the transport and the row type are `@langwatch/enterprise-scim-contract`'s. The `EnrichedAuditLog` move was a real repoint and found the type declared TWICE. What the row missed is that the export is the property the audit page turns on, that the CSV save needed a host port of a kind no family had asked for, and that the multi-line `@scenario` form binds nothing.                                                                                   |
| 7   | settings S2 RBAC                                                                                                          | 2    | 8+4    | **MOVED** — see the section above. Two keys, and the effort estimate held exactly (8 platform files, 4 tests touched). What it got wrong is the gate: governing `@langwatch/authz-web` clears NOTHING that governance or gateway carry, because `governedWebPackages` selects what the lint walks and changes no rule's verdict about an import. The `~/server/api/rbac` fix was real and cheap — a bare type alias and one deprecated function, both already published by the authz contract.                                                                                                                                                                                                                                                                                                                  |
| 8   | annotations                                                                                                               | 5    | 12+7   | **MOVED** — see the section above. FOUR keys, not five: `/annotations/my-queue` mounts 4,347 lines of the trace family's conversation view, which no package publishes, so it stays with traces and takes four platform modules with it. The chrome gap and the tab-as-prop shape were both as forecast; what the row missed is that making the period reading pure introduced a render loop that read as a four-gigabyte test worker, and that the family's spec was already 0/14 bound.                                                                                                                                                                                                                                                                                                                       |
| 9   | settings S6 credentials + /cli/auth                                                                                       | 3    | 14+12  | **MOVED** — see the section above. Three keys and TWO packages: `secrets` went to a new `@langwatch/secret-web` rather than riding in `api-key-web`, because every type on that page is the secret contract's. The row was right that the CLI screen could not ship separately. What it missed is that `/cli/auth` talks to three REST routes the published CLI polls the other side of, so the exchange moved into `apps/ui/src/behavior` and is pinned there byte for byte; that the secrets spec was 0/0 bound and its four refusal codes had no customer copy at all; and that the rbac fix, harmless on the roles page, adds three explicit `langy` strings to an admin's CLI key.                                                                                                                         |
| 10  | analytics                                                                                                                 | 9    | 49+17  | **MOVED** — see the section above. Nine keys, eight screens, 72 platform files. The row was right about the four retired automations breaks and about `custom/[id]` being tab-as-prop, and it undercounted the files by half: `features/analytics-query` (21 prod + 18 tests) and the filter rail were not in its 49+17. What it missed is that three of the nine keys address ANOTHER feature's transport and stay here anyway — the first overruled ownership call, argued on the record — and that governing a destination which already had 6,150 lines of its own meant relaying the whole package out first.                                                                                                                                                                                              |
| 11  | evaluations/evaluators                                                                                                    | 7    | 16+8   | **MOVED (3 of 7 keys), TWO packages** — see the section above. THREE keys and four features, not one family: `evaluators` to `@langwatch/evaluator-web`, `online-evaluations` to a NEW `@langwatch/monitor-web`, and `evaluations/wizard` retired to a route-table redirect. The row's drawer warning was right and undercounted the shape: `evaluatorEditor` has 15 openers not 20, but SIX of the family's seven overlays stay platform-owned, so both moved screens lose their create and edit actions to the recorded chrome gap. What it missed is that `experiments/index` needed no split at all — the shared module is the experiments page end to end — and that the two `edit` keys are blocked on ~8,000 lines of copies, 1,414 of them the trace feature's mapping vocabulary that 31 modules read. |
| 12  | workflows/studio/chat                                                                                                     | 3    | 53+19  | killing it also kills the prompt-model platform copies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 13  | auth front door + public (joint)                                                                                          | 13   | ~76    | ZERO blockers of any kind but NO destination package — create auth/identity web                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 14  | onboarding                                                                                                                | 4    | 54+11  | order after traces (traces-v2/onboarding is the largest consumer)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 15  | settings S1 org/members/teams                                                                                             | 5    | 25+7   | OrganizationUserRole has NO contract home and the org contract REFUSES to restate it — contract decision first; createProject drawer is permanently un-deletable (DashboardLayout opens it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 16  | settings S3 billing                                                                                                       | 4    | 17+9   | STRUCTURALLY BLOCKED: apps/ui (core) may not import enterprise web — needs packages/enterprise/composition/ui first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 17  | settings S8 integrations                                                                                                  | 2    | 2+2    | zero blockers, no destination — ride along with any settings package                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 18+ | setup, project home, simulations+agent-testing (joint, subscription-blocked), langy layout, experiments workbench, traces |      |        | anti-targets / downstream                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Cross-cutting gates:**

- tRPC subscriptions: apps/ui's transport declares none — blocks traces (5
  consumers), experiments workbench, langy layout, simulations+agent-testing.
- The chrome layout route that would mount CurrentDrawer for package-served
  screens is SEPARATE work from moving ProjectLangyLayout, and it is what
  closes the recorded me/automations/gateway drawer gaps.
- ProjectLangyLayout: DO NOT move it — nothing below it is blocked (children
  resolve through the merged registry); govern @langwatch/langy-web as its
  own relayout commit first, then reassess.
- Prisma enum value exports needed: TeamUserRole + RoleBindingScopeType
  (authz-contract has schemas), AnnotationScoreDataType (annotation-contract),
  OrganizationUserRole (NO home — the hard one), OrganizationIntent,
  ExperimentType.

**Retired without moves (landed with this survey):** the
/:project/evaluations key became a route-table redirect to
/:project/experiments (module stays — the experiments key serves its named
export); dead pair pages/settings/api-keys/{ProjectApiKeySection,CodeBlock}
deleted; dead drawer entry evaluatorTypeSelector deleted; gateway-web and
enterprise-governance-web root exports deleted (zero importers; the
governance-web count previously recorded here was stale). ops-web root
export stands (17 platform importers); user-web's stands (one test).
