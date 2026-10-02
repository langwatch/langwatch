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
| No polling; visible tabs stay live, hidden tabs make no calls                                 | §10    |
| Deployment facts from `useUiDeployment()` or the module's `*HostApi`, never env               | §6     |
| Reads take an opaque id plus tenant scope; mutations `setData`, never hand-invalidate         | §10.2  |

Two habits the table does not show: a sub-flow passes `onClose`, never
`closeDrawer` (it clears the stack); an in-app link is
`@langwatch/browser-host/link`, never a bare anchor.

## Worked example: a hook over the derived client

```ts
// modules/organization/browser/src/behavior/use-department-column.ts
import { api } from "./organization-api.ts";
const listQuery = api.departments.list.useQuery({ organizationId }, { enabled });
```

No `invalidate` at the call site: a cursor-backed read goes stale through its key,
any other through SSE hints (§10, "A write makes reads stale through the key").

`organization-api.ts` is `createModuleApi<…>()` over the contract's declared
procedures, never `AppRouter`. The declaration names it:
`.withApi(organizationApi, { contracts: [organizationTrpc, planTrpc] })`, which
is how a contract's cache policy reaches the browser.

A read takes an opaque id plus its tenant scope (`projectId`,
`organizationId`), never a slug alone. A query never returns a credential; a
secret comes back only from a mutation. A mutation writes the entity with
`setData` instead of invalidating by hand.

## Traps

- **Importing a router, `browser-host` internals or another module's browser
  package from a screen.** Read host services through their tokens
  (`useLent`, `useUiDeployment`, `openDrawer(Token, props)`) or the module's `*HostApi`, which
  the shell implements. An unmounted `*HostApi` is refused at install, by name.
- **A `queryFn` that re-enters the cache under its own key** hangs the query
  for the life of the page (§10, by-path dispatch).
- **Sharing by `./surfaces/*` or `./screens/*` exports.** Deleted spellings (§15).
- **`useFeatureFlag`, slots, `withCapabilities` for a peer lend, `useDrawer`
  by bare name.** All in §15. Use a lent component (§10.1), `openDrawer(Token, props)`
  with the owner's drawer token (`navigateToDrawer` is the address door) and
  `useReleaseFlag`, a target with no code yet (today `useFeatureFlag`; no §16 row).
- **Host services are not "capabilities".** §3.5 reserves that word for the
  four layers; §16 renames the browser-host list to host services.
- **A banner, toast or fatal error built by hand.** Use the design system and
  the code-keyed error presentation (§12), never `error.message`.

## References

Host wiring (host services, lending, `*HostApi` mounts, entitlement): §3.3,
§10.1 and the `frontend` skill. Layout of a screen:
`dev/docs/design/guidelines.md` §4. Specs: `specs/ui/ui-page-composition.feature`,
`specs/ui/browser-query-caching.feature`, `specs/ui/in-app-links.feature`.
Tests sit in a colocated `__tests__/` beside the code (§13). The module
anatomy: the `module` skill.
