# Web packages

`packages/features/<name>/web` is `@langwatch/<name>-web`. It is optional, browser-safe,
and depends on the feature's contract, `@langwatch/platform-api-client`,
`@langwatch/design-system`, `@langwatch/ui-host` and `@langwatch/ui-drawer`. It never
imports the server package or `apps/*`. The reference is
`packages/features/annotation/web`.

## Layers and direction

```
src/<entry>.ts(x)   flat public entries: annotations.ts, annotation-card.ts, annotation-form.ts, testing.tsx
model/              pure values, types, view-model transforms, the *HostPort contract and its React context
behavior/           hooks, the api binding (createFeatureApi), stores, form logic
ui/elements/        leaf presentation: props in, JSX out
ui/blocks/          small compositions of elements
ui/sections/        composed presentation fed by behavior; screens and layouts live here
```

Allowed imports (`UI_LAYER_DEPENDENCIES` in
`packages/architecture-lint/src/frontend-ui-boundaries.ts`):

| from        | may import                                  |
| ----------- | ------------------------------------------- |
| entry file  | any implementation module                   |
| model       | model                                       |
| behavior    | model, behavior                             |
| ui/elements | model, elements                             |
| ui/blocks   | model, elements, blocks                     |
| ui/sections | model, behavior, elements, blocks, sections |

Elements and blocks can never fetch: they cannot import behavior. Sections are where
data meets layout. Nothing imports an entry file from inside the package.

## The public entries are flat, closed and catalogue-declared

`package.json` `exports` lists each entry once:

```json
"./annotations": {
  "langwatch-declaration-source": "./src/annotations.ts",
  "types": "./dist/annotations.d.ts",
  "default": "./src/annotations.ts"
}
```

and the entry file says what a consumer may reach:

```ts
// src/annotations.ts
export const annotationScreens = {
  annotations: () => import("./ui/sections/annotations-screen.tsx"),
} as const satisfies Record<string, AnnotationScreenLoader>;

export { annotationApi } from "./behavior/annotation-api.ts";
export { AnnotationHostPort, AnnotationHostProvider, useAnnotationHost } from "./model/annotation-host.ts";
export { useAnnotationQueues } from "./behavior/use-annotation-queues.ts";
export { default as AnnotationQueueLayout } from "./ui/sections/annotation-queue-layout.tsx";
```

- The export path is the contract. `ui-web-public-entry` accepts a flat `./<id>` when
  `apps/ui/src/features/catalogue.json` declares it: listed under one feature's
  `uses.screens` it is that feature's **screen**; listed under any feature's
  `uses.surfaces` it is a **surface** another feature may mount. `./screens/<id>` and
  `./surfaces/<id>` are the older spelling and still accepted; new packages use the flat
  form. An undeclared flat entry is a violation.
- `ui-screen-closure` walks the whole import graph behind each entry and rejects direct
  browser capabilities, non-literal module specifiers, forbidden presentation imports and
  anything reaching outside the package. `@langwatch/design-system`, `@langwatch/ui-host`
  and any `*-contract` package are always allowed.
- The lazy `import()` of a screen module inside an entry file is how page loaders
  code-split; everywhere else inline `import()` is banned.
- `./testing` exports the stub host and a render harness (`src/testing.tsx`) for the
  package's consumers' tests; production code never imports it.

## Screen versus surface versus page

A **screen** is a whole page the owning feature publishes; several page keys may share
one screen with the view as a prop (`annotations-screen.tsx` takes `{ view }` and serves
inbox, mine, all and one queue). A **surface** is an embeddable piece another feature
mounts: a card, a form body, chips, a picker, a store. A **page** is an address in
`apps/ui`, answered by a route the private feature folder installs (`install.md`).

## Host ports

A screen never reads the session, the project or the router directly. It declares what
it needs as an abstract `*HostPort` class in `model/<f>-host.ts`, published with a
`<F>HostProvider` context and a `use<F>Host()` hook, and the application's private
feature folder implements it in its host component from `useUiCapabilities()`. The port
carries facts the screen needs (`project`, `currentUser`, `hasPermission`,
`isOwnPersonalWorkspace`, `route.params`) and the actions it takes (`navigate`,
`notifySuccess`, `notifyFailure`), never a `pathname`: the view arrives as a prop.
`src/testing.tsx` ships `Stub<F>Host extends <F>HostPort` for consumers' tests.

## Data access: the api-map

```ts
// behavior/annotation-api.ts
export type AnnotationApiMap = {
  annotation: {
    getAll: { query: { input: ProjectScope & { traceIds?: string[] }; output: WireOf<AnnotationWithUser>[] } };
    create: { mutation: { input: AnnotationApiCreateInput; output: WireOf<Annotation> } };
  };
  annotationScore: { getAllActive: { query: { input: ProjectScope; output: WireOf<AnnotationScore>[] } } };
};
export const annotationApi = createFeatureApi<AnnotationApiMap>();
export type RouterOutputs = OutputsFromMap<AnnotationApiMap>;
```

- `createFeatureApi`, `WireOf` and `OutputsFromMap` live in
  `@langwatch/platform-api-client/feature-api`. Types come from the contract, never from
  `AppRouter` (ADR-130) and never `any`.
- The segment names are the tRPC cache key and must equal the namespaces the process
  mounts (`annotation`, `annotationScore` in `apps/api/src/app-trpc/app-trpc.features.ts`).
  A different spelling silently stops sharing a cache with every other call site.
- Hooks in `behavior/use-<thing>.ts` return state and callbacks, never JSX. Mutation
  errors are read with `readHandledError` and rendered from the code-keyed registry;
  `error.message` on the wire is the code slug, never toast it. Map `meta.fieldErrors`
  onto form fields instead of a toast.
- Subscriptions ride the SSE link the shell configures; a feature never opens its own
  EventSource.

## Components and hooks

- `.ts` for hooks, `.tsx` for components. A screen module default-exports its component.
- Children that receive `form` use `useWatch({ control, name })`, never `form.watch()`;
  the React Compiler breaks `register` in children, so use `Controller`.
- Chakra v3 through `@langwatch/design-system`; read `dev/docs/best_practices/react.md`,
  `drawers.md`, `row-actions-overflow-menu.md`, `selection-action-bar.md` and
  `scope-selector-and-badges.md` before building a settings or list surface. Scope
  selection always uses `ScopeChipPicker`.
- Copy: no abbreviations, no internals ("uses the analysis service"), spell out tokens,
  requests, context. Read `dev/docs/best_practices/copywriting.md`.

## Drawers

Drawers are URL-routed singletons from `@langwatch/ui-drawer`: `?drawer.open=<name>`
names the open one, `drawer.<key>` carries serialisable props, a module-scope store
carries the rest, and a stack makes the back button work. A feature that owns drawers
registers them from its private `apps/ui/src/features/<f>/index.ts`
(`uiFeature({ drawers })` or the installation's drawer contribution); a sub-flow navigates
(`openDrawer("target", { onSuccess, onClose: goBack })`), never mounts another drawer
with `useState`, and the target never calls `closeDrawer`, which clears the whole stack.

## Tests

Rendering a component with mocked boundaries is an integration test:
`<name>.integration.test.tsx` under `__tests__/`, with `// @vitest-environment jsdom` in
the docblock and the package's `vitest.setup.ts`. Pure model functions get
`.unit.test.ts` under `model/__tests__/`. Hooks that need a host render inside
`Stub<F>Host`. Every `it` binds a scenario.
