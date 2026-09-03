# Web packages

`packages/features/<name>/web` is `@langwatch/<name>-web`. It is optional, browser-safe,
and depends on the feature's contract, `@langwatch/platform-api-client` and
`@langwatch/design-system`. It never imports the server package or `apps/*`.

## Layers and direction

```
model/          pure values, types, view-model transforms, *HostPort contracts
behavior/       hooks, the api binding (createFeatureApi), stores, form logic
ui/elements/    leaf presentation: props in, JSX out
ui/blocks/      small compositions of elements
ui/sections/    composed presentation fed by behavior; drawers.ts lives here
screens/<owner>/index.ts    a whole page, owner-only, public
surfaces/<id>/index.ts      an embeddable piece other features may mount, public
```

Allowed imports (`UI_LAYER_DEPENDENCIES` in
`packages/architecture-lint/src/frontend-ui-boundaries.ts`):

| from        | may import                                  |
| ----------- | ------------------------------------------- |
| behavior    | model, behavior                             |
| ui/elements | model, elements                             |
| ui/blocks   | model, elements, blocks                     |
| ui/sections | model, behavior, elements, blocks, sections |

Elements and blocks can never fetch: they cannot import behavior. Sections are where
data meets layout. Screens and surfaces compose sections.

## The public entry is closed

`package.json` `exports` may name only `./screens/<owner>` and `./surfaces/<id>`
(`ui-web-public-entry`), plus `./drawers` where the feature publishes drawers.
`ui-screen-closure` walks the whole import graph of each exported screen and rejects
direct browser capabilities, non-literal module specifiers, forbidden presentation
imports and anything reaching outside the package. `@langwatch/design-system` and any
`*-contract` package are always allowed (`PORTABLE_BY_ROLE`).

A screen export looks like:

```ts
// screens/secret/index.ts
export const secretScreens = { secrets: () => import("./secrets.screen") }; // the one
export { secretApi } from "../../behavior/secret-api"; // allowed
export { SecretHostPort } from "../../model/secret-host"; // lazy form
```

(The lazy `import()` of a screen module inside `screens/*/index.ts` is how page loaders
code-split; everywhere else inline `import()` is banned.)

## Screen versus page

A **screen** is the package's export. A **page** is the application's addressable key
(`"pages/settings/secrets"`) in `apps/ui/src/model/ui-route-table.ts`, answered by a
loader in `apps/ui/src/features/<f>/ui/sections/<f>-routes.tsx` that wraps the screen:
host provider outermost, then chrome (`withUiSettingsLayout`), then the permission guard
(`withUiPageGuard`) innermost. That order is load-bearing. See `install.md`.

## Host ports

A screen never reads the session, the project or the router directly. It declares what
it needs as an abstract `*HostPort` class in `model/`, and the application's private
feature folder provides an implementation in the loader. This is what keeps a screen
portable and its closure clean.

## Data access

```ts
// behavior/use-secrets.ts
export function useSecrets({ projectId }: { projectId: string }) {
  return secretApi.secrets.list.useQuery({ projectId });
}
```

- The api binding is one `createFeatureApi<XApiMap>()` at module scope in `behavior/`.
- Mutation errors: read with `readHandledError` and render copy from the code-keyed
  registry; `error.message` on the wire is the code slug, never toast it. Map
  `meta.fieldErrors` onto form fields instead of a toast.
- Subscriptions ride the SSE link the shell configures; a feature never opens its own
  EventSource.

## Components and hooks

- Hooks return state and callbacks, never JSX. `.ts` for hooks, `.tsx` for components.
- Children that receive `form` use `useWatch({ control, name })`, never `form.watch()`;
  the React Compiler breaks `register` in children, so use `Controller`.
- Chakra v3 through the design system; read `dev/docs/best_practices/react.md`,
  `drawers.md`, `row-actions-overflow-menu.md`, `selection-action-bar.md`,
  `scope-selector-and-badges.md` before building a settings or list surface.
  Scope selection always uses `ScopeChipPicker`.
- Copy: no abbreviations, no internals ("uses the analysis service"), spell out tokens,
  requests, context. Read `dev/docs/best_practices/copywriting.md`.

## Drawers

Drawers are URL-routed singletons from `@langwatch/ui-drawer`: `?drawer.open=<name>`
names the open one, `drawer.<key>` carries serialisable props, a module-scope store
carries the rest, and a stack makes the back button work. A feature publishes its map
from `ui/sections/drawers.ts`:

```ts
export const secretDrawers = { "secret.edit": lazyDrawer(() => import("./secret-edit.drawer")) };
```

and the application spreads it in `apps/ui/src/features/installed-ui-drawers.ts`. A
sub-flow navigates (`openDrawer("target", { onSuccess, onClose: goBack })`); it never
mounts another drawer with `useState`, and the target never calls `closeDrawer`, which
clears the whole stack.

## Tests

Rendering a component with mocked boundaries is an integration test:
`<name>.integration.test.tsx` under `__tests__/`, with `// @vitest-environment jsdom` in
the docblock. Browser-lane tests are `.browser.test.tsx`. Pure model functions get
`.unit.test.ts`. Every `it` binds a scenario.
