---
name: frontend
description: "Everything on the browser side of a LangWatch module: createUi and the shell, a module's browser-half layer order (model/behavior/ui), host services vs components (browser-host vs design-system), where shared code goes now that kits are gone (record §3.4), building a new browser module end to end (defineBrowserModule, screens, drawers, lends, the module's *HostApi, the derived tRPC client), drawers as routed singletons, and frontend testing (colocated __tests__, jsdom docblock, component tests as integration level). Use whenever someone is building a screen, drawer, or shell chrome; writing or extending a module's browser/ package; asking how a screen reads host services (tokens, its own `*HostApi`); sharing a component, hook or data with another module (design system, contract, `<name>-client`); or writing/reviewing a component test."
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
  .withModules(browserModules) // generated from the catalogue
  .render();
mountShell(ui); // shell/: providers + router over declarations
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
package that outgrows one `ui/sections/` folder does not invent a layer, it
nests: `features/<name>/` repeats `model/behavior/ui` inside itself, and a
feature that is one component is a section, not a feature — behaviour lives
in the feature that owns it, not a package-wide `behavior/` bucket every
feature reaches into. A screen reads host services directly, typed by
tokens: `useLent`, `openDrawer`, `useReleaseFlag` (§3.4, §10.1). A `*HostApi`
(`model/<name>-host.ts`) keeps only the module's own host needs, which the
**shell** implements from `@langwatch/browser-host`; an unmounted `*HostApi` is
refused by `createUi` at install, by name, before any component renders. The
whole half is declared once, with `defineBrowserModule` (screens, drawers,
publications, host mounts), and the package's
`exports` map lists that declaration and nothing else — `surfaces/` and
`screens/` are deleted browser folders (record §15). A module capability the
composition root needs (not a screen) travels through the same declaration's
`.withCapabilities(...)` entry, never a side-door export. The generated `browserModules`
list installs the declaration, the same way `processModules` are generated
for the backend — no hand-written file in `apps/ui` names either list.

The tRPC client is derived from the contract's declarations by
`createModuleApi` (`@langwatch/api/web`) and lives in the module's
`<name>-client` package — never hand-written, never `AppRouter` (ADR-130). A procedure another module owns and this package
still calls is the one hand-written exception, in a `BorrowedProcedures` type
that says so until that module's own contract declares it.

## Drawers are routed singletons, not local state

Drawers are URL-routed singletons with a navigation stack, opened through the
host service and registered through the declaration — never mounted with
`useState`/`useDisclosure` from inside another drawer. A sub-flow navigates
(`openDrawer(Token, { onSuccess, onClose: goBack })`, the token declared once by
the drawer's owner, §10.1; `navigateToDrawer` is the address door); pass `onClose`,
never let the target call `closeDrawer` directly (it clears the whole stack);
keep the caller's draft in a store that survives its own unmount. Full detail:
`dev/docs/ARCHITECTURE.md` §10 and §10.1.

## Host services versus components

`browser-host` holds host services only (session, navigation, storage,
toasts, drawers); it carries no component. Components live in `design-system`. Read the
`design-system` skill and the relevant
`dev/docs/best_practices/*.md` pattern doc before building any non-trivial
screen, list, drawer or settings page — extend the existing pattern rather
than inventing a new one.

The reverse direction — a module's own capability implementation that the
**composition root** needs, e.g. `apps/ui/src/main.tsx` — is not a side-door
export (§3.4 shuts that): it travels through the declaration's `.withCapabilities(...)`.

## No kits (record §3.4) — when a different module needs a piece of yours

A module's `*-browser` package is **closed**: nothing else imports it, ever.
There are no kits and no shared browser packages. Where the piece goes:

| The piece is                        | It goes to                                                      |
| ----------------------------------- | --------------------------------------------------------------- |
| repeated inside one module          | stays in that module                                            |
| a component repeated across modules | `design-system`, taking props or a query result, never fetching |
| pure domain logic                   | the owner's contract                                            |
| a framework hook                    | `browser-host`                                                  |
| another module's data               | that module's `<name>-client` (`modules/<name>/client`)         |
| client state                        | the one global UI store, namespaced per module (§10.2)          |

A `<name>-client` holds the hooks `createModuleApi` derives from its own
contract and at most a few thin convenience hooks, never a component. It
imports only its contract and `@langwatch/api/web`, never another client; a hook
combining two modules lives in the screen that needs it. A component that
fetches a peer's data or reads a `*HostApi` is lent by its owner's token and the
consumer renders what it is handed. `architecture-enforcer lint` checks the
boundaries; a violation there is the finding, not a judgement call.

## Creating a new browser module, end to end

**Copy `modules/annotation`**'s browser package as the shape reference
(`modules/annotation/browser/src/annotation.web.ts` is the declaration). This
assumes the module's **contract** already exists (see the `backend` skill's
"Creating a new process module" for the shared contract steps — a
browser-only module still needs a contract package if it owns any config or
schema, even with zero process operations).

```
src/<name>.web.ts           the declaration: defineBrowserModule("<name>")…
src/model/<name>-host.ts    abstract <Name>HostApi + React context (own host needs only)
src/behavior/use-<name>s.ts hooks over the module's <name>-client
src/ui/elements/…  ui/blocks/…  ui/sections/<name>s-screen.tsx
src/testing.tsx             Stub<Name>Host + render harness
```

```ts
// <name>.web.ts — the one file the generated browserModules list installs,
// and the exports map's only entry (./declaration)
export const <name>Web = defineBrowserModule("<name>")
  .withScreens({
    "pages/[project]/<name>s": {
      path: "/:project/<name>s", within: "project", label: "<Name>s",
      requires: "<name>s:view",   // the router guards it (§10)
      load: () => import("./ui/sections/<name>s-screen.tsx"),
    },
  })
  .drawer(<Name>DrawerToken, { load: ... })  // if any; the token is the owner's (§10.1)
  .withHosts({ requires: [...], mounts: [...] })  // *HostApi names read/provided —
                                // an unmounted one is refused by createUi at install
  .withCapabilities({ ... });   // if the composition root needs an impl this module owns
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
