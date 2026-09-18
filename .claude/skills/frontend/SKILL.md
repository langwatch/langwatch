---
name: frontend
description: "Everything on the browser side of a LangWatch module: createUi and the shell, a module's browser-half layer order (model/behavior/ui), capabilities vs components (browser-host vs design-system/kits), the kit law for sharing across modules, building a new browser module end to end (defineBrowserModule, screens, drawers, publications, the module's *HostApi, the derived tRPC client), drawers as routed singletons, and frontend testing (colocated __tests__, jsdom docblock, component tests as integration level). Use whenever someone is building a screen, drawer, or shell chrome; writing or extending a module's browser/ package; asking how a screen reads session/navigation without importing the router or browser-host directly; publishing a component or hook for another module; deciding whether a browser-kit package is warranted; or writing/reviewing a component test."
user-invocable: true
argument-hint: "<question or frontend task>"
---

# The frontend

Read `dev/docs/ARCHITECTURE.md` first — this skill is a pointer into it, plus
the procedure. `@langwatch/browser` is the browser runtime **and** the
browser-half vocabulary: `createUi`, the browser supply, `render`,
`defineBrowserModule`. `apps/ui` is only `src/{main.tsx, shell/, styles/}` —
everything else lives in a module's `browser/` package. Full shape: record
§2, §10.

## `createUi` and the shell

```ts
const ui = await createUi({ mount: "root" })
  .withModules(browserModules)   // generated from the catalogue
  .render();
mountShell(ui);                  // shell/: providers + router over declarations
```

`createUi` reads the injected public config from a DOM meta tag by default,
validated against every installed browser module's declaration **before a
component renders**. `uiBundle()` is the built app as a deployment artefact —
served by the api process, hashed assets with immutable caching, `index.html`
for unmatched non-API routes **after** every declared route, with the config
meta tag injected at serve time (the browser's only channel to its config).
One tRPC client for the whole browser; it calls no REST.

## A module's browser half (record §3.4)

Layer order, one direction only: flat public entries (`src/<id>.ts`) →
`model/` (pure values, the `*HostApi` contract) → `behavior/` (hooks, the api
binding, stores) → `ui/elements` → `ui/blocks` → `ui/sections` (data meets
layout). Elements and blocks never import `behavior/` and never fetch. A
screen declares a `*HostApi` (`model/<name>-host.ts`) the **shell**
implements from `@langwatch/browser-host` capabilities — a screen component
never imports `browser-host` or a router itself. The whole half is declared
once, exported at `./declaration`, with `defineBrowserModule` (screens,
drawers, publications, mounts, flags); the generated `browserModules` list
installs it, the same way `processModules` are generated for the backend — no
hand-written file in `apps/ui` names either list.

The tRPC client is derived from the contract's declarations via
`browser-trpc` (`ContractApiMap<typeof <name>Trpc>`) — never hand-written,
never `AppRouter` (ADR-130). A procedure another module owns and this package
still calls is the one hand-written exception, in a `BorrowedProcedures` type
that says so until that module's own contract declares it.

## Drawers are routed singletons, not local state

Drawers are URL-routed singletons with a navigation stack, opened through the
host capability and registered through the declaration — never mounted with
`useState`/`useDisclosure` from inside another drawer. A sub-flow navigates
(`openDrawer("target", { onSuccess, onClose: goBack })`); pass `onClose`,
never let the target call `closeDrawer` directly (it clears the whole stack);
keep the caller's draft in a store that survives its own unmount. Full detail:
`dev/docs/ARCHITECTURE.md` §10 and `dev/docs/best_practices/drawers.md`.

## Capabilities versus components

`browser-host` is capabilities only — session, navigation, storage, feature
flags, toasts, slots, drawers — the browser analogue of a process's closed
members; it carries no component. Components live in `design-system` or in a
kit. Read the `design-system` skill and the relevant
`dev/docs/best_practices/*.md` pattern doc before building any non-trivial
screen, list, drawer or settings page — extend the existing pattern rather
than inventing a new one.

## The kit law (record §3.4) — when a different module needs a piece of yours

A module's `*-browser` package is **closed**: nothing else ever imports it,
ever. The moment a *different* module needs a hook, store or component this
module owns, that thing **moves** (never copies) to a new package,
`<name>-browser-kit` — sharing is declared by moving code, never observed by
reaching in.

1. **A kit exists only where sharing is real — three or more consumers.** One
   consumer is bilateral coupling, not an API: inline or duplicate it
   instead.
2. **A kit is a leaf.** It may import contracts (any module's),
   `design-system`, `browser-host`. It may not import its own module's
   `*-browser`, any other `*-browser`, or another kit.
3. **A kit fetches nothing.** No project-scoped queries, no `browser-trpc`.
   Presentational components and pure hooks/stores only; each consumer wires
   its own data (the model-selector ruling: the kit takes
   `options/value/onChange`, each consumer runs its own query).
4. **A kit is a package, not a subpath** — a subpath is invisible to the
   dependency graph and cannot be budgeted or break a cycle.
5. **The published tier is shrink-only.** Don't publish speculatively hoping
   for a second consumer; if unsure three consumers are real, leave the piece
   private and say so.

To publish: create `modules/<owner>/browser-kit/` as a normal workspace
package (`@langwatch/<owner>-browser-kit`), move the piece in (delete the
original, repoint the owner's own importers to the kit too — exactly one
copy), export a flat entry in `package.json` `exports`, and have the consumer
add the workspace dependency and import it directly — no catalogue
registration step, no "surfaces" declaration (that mechanism is superseded).
`architecture-enforcer lint` is what checks the kit law itself (closed
`*-browser`, leaf-only imports, no fetching) — a violation there is the
finding, not a judgement call.

## Creating a new browser module, end to end

**Copy `modules/annotation`**'s browser package as the shape reference. This
assumes the module's **contract** already exists (see the `backend` skill's
"Creating a new process module" for the shared contract steps — a
browser-only module still needs a contract package if it owns any config or
schema, even with zero process operations).

```
src/<name>s.ts              flat entry: screens map, re-exported *Api token
src/declaration.ts          export default defineBrowserModule("<name>")…
src/model/<name>-host.ts    abstract <Name>HostApi + React context
src/behavior/<name>-api.ts  createModuleApi<<Name>ApiMap>() over browser-trpc
src/behavior/use-<name>s.ts hooks over the api binding
src/ui/elements/…  ui/blocks/…  ui/sections/<name>s-screen.tsx
src/testing.tsx             Stub<Name>Host + render harness
```

```ts
// declaration.ts — the one file the generated browserModules list installs
export default defineBrowserModule("<name>")
  .withScreens({ <name>s: () => import("./ui/sections/<name>s-screen.tsx") })
  .withDrawers({ ... })         // if any
  .withPublications({ ... })    // if another module reads a slot from this one
  .withMounts({ ... })          // shell mount points
  .withFlags({ ... });          // feature-flag gates, if any
```

`pnpm generate:modules` regenerates the app's `browserModules` list from the
catalogue afterward. A module with no browser package simply has no
`browser/` directory — that is a valid, complete module, not a stub needing
an apology.

## The middle: how a frontend change is tested

**Colocated `__tests__/`, beside the code — never a root `tests/` directory
next to `src/`** (record §13). Component tests are `.integration.test.tsx` —
this is a test **level** (renders a component, mocks its boundaries), not a
datastore marker — with `// @vitest-environment jsdom` as the file's first
docblock line; the package's own `vitest.config.ts` declares no global
`environment`, so every jsdom file states it itself. Render inside the
module's `Stub<Name>Host` (from `testing.tsx`) rather than a hand-rolled
provider tree. Describe blocks nest `given`/`when`; `it` titles are
action-based. Bind the covering scenario with
`/** @scenario "<exact title>" */` immediately before the `it`/`test` call —
an untagged or unannotated scenario enforces nothing
(`check-feature-parity`'s `✗ THIS RUN FAILS: ...` banner is the thing to
read, not a per-file tick). Mutation failures are read with
`readHandledError` and rendered from the code-keyed presentation registry —
never toast `error.message`; assert on `code` in tests, never on prose (record
§12).

---

The record (`dev/docs/ARCHITECTURE.md`) is the authority; this skill only
points into it. Where the tree and this skill disagree during the renames in
flight, record §16 maps old spellings to the target ones — trust the table,
not what is on disk.
