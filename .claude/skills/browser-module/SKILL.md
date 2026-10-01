---
name: browser-module
description: "Write or change a module's browser half (modules/<name>/browser): a screen, a drawer, a section, a hook, a slice of browser state, a cached read, or a data fetch in the UI. Use when someone says 'add a screen', 'add a drawer', 'where does this component go', 'browser state', 'global UI store', 'defineBrowserModule', 'defineWebModule', 'stale read', 'cache this query', 'polling', 'auto-refresh', 'IndexedDB mirror', 'useUiDeployment', 'can I import another module's component', or 'ui/elements vs blocks vs sections'. Teaches the record (ARCHITECTURE.md section 3.4, 10, 10.2, ADR-169); for the typed data client see module-client, for components and tokens see design-system."
user-invocable: true
argument-hint: "<screen, drawer, hook or state question>"
---

# A module's browser half

Read `dev/docs/ARCHITECTURE.md` §3.4, §10 and §10.2. This skill is the short
version. Exemplar: `modules/organization/browser` (screens, drawers, hooks,
features/ nesting, a colocated test). New code uses the left column of §16;
today's tree still spells `defineWebModule` (ui-kernel) for the target
`defineBrowserModule`. The declaration stem stays `<name>.web.ts`.

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

1. **Closed package.** Nothing imports `@langwatch/organization-browser`. The
   exports map is `./declaration` only, so a side door cannot exist. Types
   cross (`import type`), values do not (§3.4).
2. **No kits.** Repeated in one module: stays. Repeated across modules: the
   design system (props or a query result in, never fetches). Another module's
   data: its `<name>-client` (see `module-client`). Pure logic: the owner's
   contract. A framework hook: `browser-host`.
3. **Screens are declared, guarded by the router.** `.withScreens({ key: {
   path, within, requires: "organization:manage", load } })` in
   `organization.web.ts`. A screen never guards itself and never names its URL.
4. **Drawers are URL-routed singletons with a stack.** Declared with
   `.withDrawers({ name: { load } })`; the name is the wire
   (`?drawer.open=person`), so renaming one is a regression. A sub-flow
   navigates and passes `onClose`, never `closeDrawer` (it clears the stack).
   Keep the caller's draft in a store that survives its unmount.
5. **The URL is the truth** for filters, tabs and drawers (§10.2 tier 2). A
   link in-app is `@langwatch/browser-host/link`, never a bare anchor.
6. **Four state tiers, one home each** (§10.2, ADR-169). Server data stays in
   React Query, never in `useState` or a store. Address state in the router.
   Shared client state in the **one global UI store**, a slice per module,
   named `<module>:<key>` (`defineSlice` in `@langwatch/browser-host/global-store`):
   write only your own prefix, read any. Local state is `useState`, derived
   during render. No Redux.
7. **A screen expects missing data.** Frame renders at once, each block shows a
   skeleton in its final shape, held data stays while reloading, an error shows
   inline with Retry. Empty, loading and error never look alike.
8. **Every read is cached; the cache is not yours to tune.** React Query in
   memory plus the sealed IndexedDB mirror (§10.2: default, LRU-bounded). No
   per-read tiers, no `staleTime` at a call site. A server SSE read hint or a
   newer session version marks a read stale; a 5-minute safety refetch backs it.
9. **No polling.** Follow events instead. The one exception is a
   user-chosen dashboard auto-refresh. Only the focused tab talks to the
   server; hidden tabs make no calls (React Query's focus manager,
   `@langwatch/browser-host/page-visibility`, never your own `visibilitychange`).
10. **Deployment facts come from `useUiDeployment()`**
    (`@langwatch/browser-host/capabilities`), or the module's own `*HostApi`.
    Never `import.meta.env`, `process.env`, a fetch, or a meta-tag parse.

## Worked example: a hook over the derived client

```ts
// modules/organization/browser/src/behavior/use-department-column.ts
import { api } from "./organization-api.ts";
const listQuery = api.departments.list.useQuery({ organizationId }, { enabled });
const utils = api.useUtils();
refetch: () => utils.departments.assignments.invalidate({ organizationId });
```

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
  (`useLent`, `useUiDeployment`, `useDrawer`) or the module's `*HostApi`, which
  the shell implements. An unmounted `*HostApi` is refused at install, by name.
- **A `queryFn` that re-enters the cache under its own key** hangs the query
  for the life of the page (§10, by-path dispatch).
- **Sharing by `./surfaces/*` or `./screens/*` exports.** Deleted spellings (§15).
- **`useFeatureFlag`, slots, `withCapabilities` for a peer lend, `useDrawer`
  by bare name.** All in §15. Use `useReleaseFlag`, a lent component (§10.1) and
  the owner's drawer by name. Not all landed in the tree yet: check §16.
- **Host services are not "capabilities".** §3.5 reserves that word for the
  four layers; §16 renames the browser-host list to host services.
- **Pattern docs lag.** `dev/docs/best_practices/react.md` still says `web`
  packages and `screens/`. The record wins.
- **A banner, toast or fatal error built by hand.** Use the design system and
  the code-keyed error presentation (§12), never `error.message`.

## References

Host wiring (host services, lending, `*HostApi` mounts, entitlement): the
future `module-dependencies` skill. Layout of a screen:
`dev/docs/design/guidelines.md` §4. Specs: `specs/ui/ui-page-composition.feature`,
`specs/ui/browser-query-caching.feature`, `specs/ui/in-app-links.feature`.
Tests sit in a colocated `__tests__/` beside the code (§13). The module
anatomy: the `module` skill.
