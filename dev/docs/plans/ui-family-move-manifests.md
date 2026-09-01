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

## Family facts (keys = legacy-page-loaders.ts entries to DELETE)

### governance — 11 keys, ~20 prod files + 15 tests, ~8.3k page LOC (largest)
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

### gateway — 11 keys, ~38 prod files + 27 tests, ~5.7k page LOC
- Exclusive: all of `components/gateway/` except ConfirmDialog; all of
  `components/webhooks/`; `components/settings/governance/routingPolicies/`
  (misfiled — gateway owns it; baseline lines file it under governance);
  `hooks/useRollingWindow`.
- Hard blockers: `guardrails.tsx` imports the generated prisma client
  (banned in apps/ui — needs contract types first); `routing-policies.tsx`
  opens the `routingPolicy` drawer via platform's drawerRegistry (platform
  copy undeletable — family carries a package copy).
- `/gateway` index page is a pure client-side redirect — becomes a route-table
  redirect row, not a screen.
- Destination `@langwatch/gateway-web` exists, flat, needs restructure.
  `VirtualKeyUsageSnippet` drags shiki + openai deps.

### me — 5 keys, ~44 prod files + 13 tests (widen by 2 keys recommended)
- `PullRequestsTable`/`SessionsTable` are also the entire bodies of
  `pages/[project]/{pull-requests,sessions}` (52/63 lines) — widen the family
  to take those two keys rather than duplicating.
- DO NOT move (filed under `components/me/` but owned by others):
  `PersonalFeatureGateDialog` + `usePersonalFeatureGate` (traces-v2/annotations),
  `PasskeyNudge` (DashboardLayout), `PasskeysSection`/`SignInMethodsSection`
  (settings/authentication).
- Hard problems: `PersonalRecentTracesTable` reaches six deep paths into
  `features/traces-v2/` (ship placeholder or build a trace-web surface —
  never copy traces-v2); `AvatarUploadControl` reaches better-auth via
  `~/utils/auth-client` (banned — inject the action).
- Destination ambiguous: recommend apps/ui hub feature `personal-workspace`
  composing `user-web` (owner, gains `screens/personal-workspace`),
  `gateway-web` (budgets), coding-agent presentation, trace surface.
  NOTE: 5 files import `@langwatch/coding-agent-web` but no such directory
  was found — resolve before dispatch.

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

| Component | Families | Resolution |
|---|---|---|
| `gateway/ConfirmDialog` | gateway+governance | design-system `./confirm-dialog` (dispatched) |
| `me/InstallCliCard` | me+governance | each takes own copy |
| `modelProviders/iconsMap` | me+gateway | copy or model-provider-web promotion |
| `ui/{ListTable,Pagination}` | me+governance | design-system (dispatched) |
| `settings/{ScopeChipPicker,ProviderScopeChips}` | gateway+governance | NEW shared package (authz-web or scope-web) — undecided |
| traces-v2 deep imports | me+automations | trace-web surface or placeholder — undecided |

## Single-owner files (serialize)

- `apps/ui/src/ui/sections/ui-application.tsx` + the loader-merge module —
  host-capability agent only, then frozen as reference.
- `packages/architecture-lint/src/frontend-ui-boundaries.ts` — only if a
  new source root is ever added; prefer not.
- `apps/ui/src/features/catalogue.json`, `legacy-page-loaders.ts` (+ its
  unit test), `legacy-feature-fragment-baseline.json` (gateway owns lines
  filed under governance for routingPolicies), `pnpm-lock.yaml` —
  coordinator split-stages; one family commit at a time.
