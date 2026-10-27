---
name: browser-module
description: "Write or change a module's browser half (modules/<name>/browser): a screen, a drawer, a section, a hook, a slice of browser state, a cached read, or a data fetch in the UI. Use when someone says 'add a screen', 'add a drawer', 'where does this component go', 'browser state', 'global UI store', 'defineBrowserModule', 'stale read', 'cache this query', 'polling', 'auto-refresh', 'IndexedDB mirror', 'useUiDeployment', 'can I import another module's component', or 'ui/elements vs blocks vs sections'. Teaches the record (ARCHITECTURE.md section 3.4, 10, 10.2, ADR-169); for the typed data client see module-client, for components and tokens see design-system."
user-invocable: true
argument-hint: "<screen, drawer, hook or state question>"
---

# A module's browser half

Read `dev/docs/ARCHITECTURE.md` §3.4, §10 and §10.2. This skill is the short
version. Exemplar: `modules/organization/browser` (screens, drawers, hooks,
features/ nesting, a colocated test). §16 says per row whether the new name has
landed; the declaration is `defineBrowserModule` from `@langwatch/browser`. The declaration stem stays `<name>.web.ts`.

## The shape

```
modules/organization/browser/src/
  organization.web.ts   the declaration; package.json exports ./declaration and nothing else
  model/                pure values and the module's *HostApi contract
  behavior/             hooks, the api binding, stores (organization-api.ts, use-*.ts)
  ui/elements|blocks|sections/
  features/<name>/      a feature owns model/behavior/ui again, one level, past 30 files
  testing.tsx           the module's test harness
```

Imports run one way: entry, then `model`, `behavior`, `ui/elements`,
`ui/blocks`, `ui/sections`. Elements and blocks take props or a query result and
never fetch. A section is where data meets layout. A feature that is one
component is a section, not a feature.

## Rules that matter

Each rule lives in the record; this table only points at it.

| Rule                                                                                          | Record |
| --------------------------------------------------------------------------------------------- | ------ |
| Closed package: exports `./declaration` only; types cross, values do not                      | §3.4   |
| No kits: shared UI to the design system, another module's data to its `<name>-client`         | §3.4   |
| Screens declared with `.withScreens`, guarded by the router, never self-guarded               | §10    |
| Drawers are URL-routed singletons (`?drawer.open=<name>`); the name is the wire               | §10    |
| A screen expects missing data: skeleton in final shape, held data stays, inline Retry         | §3.4   |
| Four state tiers: React Query, router, the one global UI store (`<module>:<key>`), `useState` | §10.2  |
| Every read cached (React Query + IndexedDB mirror); no `staleTime` at a call site             | §10    |
| No polling, but two bounded exceptions (below); visible tabs stay live, hidden tabs make none | §10    |
| Deployment facts from `useUiDeployment()` or the module's `*HostApi`, never env               | §6     |
| Reads take an opaque id plus tenant scope; mutations `setData`, never hand-invalidate         | §10.2  |

**The two polling exceptions** (§10): a refresh interval the user chooses, off by default
(`modules/analytics/browser/src/behavior/use-dashboard-auto-refresh.ts`), and suite freshness
polling only while the live stream is down
(`modules/scenario/browser/src/behavior/suites/use-suite-run-freshness.ts`). Anything else is
a hint over SSE or a cursor-backed read.

Two habits the table does not show: a sub-flow passes `onClose`, never
`closeDrawer` (it clears the stack); an in-app link is
`@langwatch/browser-host/link`, never a bare anchor.

## Worked example: a hook over the derived client

The owner's client is derived from its contract and holds no handwritten procedure map. Clean
example: `modules/identity/client/src/identity-client.ts` (`createModuleApi<ContractApiMap<...>>()`
over the contract's declared procedures, never `AppRouter`). A new module puts its derived hooks in
`modules/<name>/client` (§3.4) and the declaration installs it with
`.withApi(client, { contracts: [...] })` (`installedModuleApis`, §10.1). Every read is mirrored to
disk by default (§10.2); there is no per-read cache policy.

```ts
const query = identityClient.<router>.<procedure>.useQuery({ organizationId }, { enabled });
```

No `invalidate` at the call site: a cursor-backed read goes stale through its key, any other
through SSE hints (§10, "A write makes reads stale through the key").

**Debt, not a model.** `modules/organization/browser/src/behavior/organization-api.ts` calls the
same factory but intersects the derived map with a 500-line handwritten one, and
`use-department-column.ts` hand-invalidates. Do not copy either; when a procedure is missing, add
it to the owner's contract and client.

A read takes an opaque id plus its tenant scope (`projectId`, `organizationId`), never a slug
alone. A query never returns a credential; a secret comes back only from a mutation. A mutation
writes the entity with `setData` instead of invalidating by hand.

## Worked example: a routed drawer

The token (`openDrawer(Token, props)`) opens it; the drawer mounts only while open and passes the
router's callbacks to the design system's callable `Drawer` (props in the `design-system` skill,
`references/component-apis.md`):

```tsx
<Drawer title="Edit score" onClose={onClose} onBack={goBack} size="md" footer={{ primaryAction: { type: "submit", label: "Save" } }} onSubmit={save}>
```

A sub-flow gets `onClose` from its caller, so closing returns to the caller; only the root drawer
calls `closeDrawer`. `dev/docs/best_practices/drawers.md` has the routing detail.

## Worked example: state and host services

One global UI store, owned per module and namespaced `<module>:<key>`:
`defineSlice` from `@langwatch/browser-host/global-store` (`persist` keeps preferences only, never
server data); another module reads with `readSlice` and cannot write. Example:
`defineSlice` in `use-dashboard-auto-refresh.ts`.

A host service has two shapes. A module's own `*HostApi` mount is implemented by the shell and
refused at install if unmounted. A **service the owner provides** is declared with
`defineBrowserModule(name).provides(Service, { load })` and read with `useHostService`; example:
`modules/feature-flag/browser/src/feature-flag.web.ts` and `packages/browser-host/src/feature-flag.ts`.

## Traps

- **Importing a router, `browser-host` internals or another module's browser
  package from a screen.** Read host services through their tokens
  (`useLent`, `useUiDeployment`, `openDrawer(Token, props)`) or the module's `*HostApi`, which
  the shell implements. An unmounted `*HostApi` is refused at install, by name.
- **A `queryFn` that re-enters the cache under its own key** hangs the query
  for the life of the page (§10, by-path dispatch).
- **Sharing by `./surfaces/*` or `./screens/*` exports.** Deleted spellings (§15).
- **Slots, `withCapabilities` for a peer lend, `useDrawer` by bare name, a
  per-module `use-feature-flag.ts` copy.** All in §15. Use a lent component (§10.1),
  `openDrawer(Token, props)` with the owner's drawer token (`navigateToDrawer` is the
  address door) and `@langwatch/browser-host`'s `useFeatureFlag(flag, { projectId })`,
  which keeps its name and is off §15's deleted list (§10.1, Alex 2026-10-05).
- **Host services are not "capabilities".** §3.5 reserves that word for the
  four layers; §16 renames the browser-host list to host services.
- **Any component built by hand.** A banner or alert, dialog, drawer, empty
  state, menu, picker or table comes from `@langwatch/design-system`; a missing
  need is added there first. Errors use the code-keyed presentation (§12),
  never `error.message`.

## References

Host wiring (host services, lending, `*HostApi` mounts, entitlement): §3.3,
§10.1 and the `frontend` skill. Layout of a screen:
`dev/docs/design/guidelines.md` §4. Specs: `specs/ui/ui-page-composition.feature`,
`specs/ui/browser-query-caching.feature`, `specs/ui/in-app-links.feature`.
Tests sit in a colocated `__tests__/` beside the code (§13). The module
anatomy: the `module` skill. The browser half has no generated page yet (plan
`dev/docs/plans/module-readmes-2026-10-06.md` §2); who owns what is on the module's own `README.md`.
