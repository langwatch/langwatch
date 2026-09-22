# ADR-148: The browser installs what its web modules declared

**Date:** 2026-09-17

**Status:** Accepted; implementation pending

**Behavioural contract:**
[A browser cannot boot without what its web modules declared](../../../specs/ui/declared-browser-supply.feature)

**Related:** [ADR-147: the process supply is checked by the
compiler](./147-compiler-checked-process-supply.md) (**this ADR is its browser
half**; ADR-147 scoped `apps/ui` out and said why),
[declarative process composition (the architecture record, §8; ADR-144 on this branch is trace search)](../ARCHITECTURE.md),
[ADR-098: product-scoped navigation](./098-product-scoped-navigation.md),
[ADR-104: runtime environment configuration](./104-runtime-environment-configuration.md),
[ADR-086: runtime-configurable CDN base](./086-cdn-asset-base.md),
[ADR-101: feature package surfaces](./101-feature-package-surfaces.md)

## Context

ADR-147 moved the server supply to the compiler and stated that `apps/ui`
"is NOT on this shape and is out of scope", because its generated web list is
empty and what runs is `collectWebInstallations` over a hand-listed array merged
with a legacy set, where a `WebInstallation` is an imperative `install(ui)`
rather than a declaration. This ADR is that drive. It is not a transcription of
ADR-147: the browser has no process, no stores, no secrets, a document that
carries its configuration at runtime, lazy routes and a React tree.

Measured on this branch.

|                                                       |                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| installed entries in `installed-ui-features.ts`       | **40**, from **39** feature directories                                                 |
| ...declared with `uiFeature({...})`                   | **39**                                                                                  |
| ...declared as a `WebInstallation` with `install(ui)` | **1** (`annotation`)                                                                    |
| page-loader registries declared                       | **38**                                                                                  |
| drawers declared                                      | **44**, across **15** features                                                          |
| api bindings mounted, in install order                | **37** (35 from `uiFeature`, 2 from `annotation`'s `install`)                           |
| failure interceptors                                  | **2** (`licensing`, `model-provider`)                                                   |
| slot fills                                            | **4** packages, filling **4** of the **7** declared slot names, plus the seat-type copy |
| modules mounting React Router routes                  | **1**                                                                                   |
| distinct page keys in `ui-route-table.ts`             | **136**, of which 2 are pathless layouts                                                |
| ...pinned by `installed-ui-features.unit.test.ts`     | **128**, so **6 real page keys are unpinned**                                           |
| retired-address redirect descriptors                  | **29**                                                                                  |

The generated catalogue path is unwired, and it cannot wire itself.
`modules/catalogue.json` carries **54** features. **41** have a
`web/package.json`. **0** have `web/src/<id>.web.ts`, which is what
`dev/scripts/generate-modules.mjs` looks for, so `webModules` is `[]` and stays
`[]`. The generator also requires `web/src/index.ts`; **16** web packages have
one, and `annotation-web` - the one module already converted - is not among them,
because `ui-web-public-entry` makes a web package's entries flat and closed and
there is no `./index` entry to add. **The `index.ts` probe is the wrong probe for
the web half.**

The halves do not agree about what is installed. `serverModules` installs **49**.
**38** modules carry both halves on disk, **12** are server-only, **3** are
web-only (`navigation`, `onboarding`, `saas`) and **1** carries neither
(`audit-log`). Today every one of those 38 runs its server half and installs no
web half at all, and nothing says so.

Four contributions are not contributions. Navigation, the command bar, the
settings menu and the product catalogue are hand-listed inside one module's
`model/` folder - roughly **1,600 lines across 7 files** in
`@langwatch/navigation-browser` - naming addresses owned by about twenty other
modules: `command-catalogue.ts` (715 lines, 60 commands: 41 navigation,
19 actions), `settings-menu.ts` (360 lines, 7 group builders, ~31 entries),
`section-nav-items.ts` (166 lines), `products.ts` (132 lines, 4 products) and
`project-nav-items.ts` (19 entries). Where a page sits is not declared at all: it
is recovered from the address by `productFromPathname`, a list of 3 product
prefixes and 12 non-product prefixes with `llm-ops` as the fall-through, serving
134 page keys, and `isSettingsShellRoute` is a `startsWith` on `/settings` and
`/ops`. `specs/ui/ui-page-composition.feature` already records this as a path
test rather than a per-page opt-in.

Nothing is typed across those seams. `CommandDrawerName = string` and
`Command.path?: string`, so a command may name a drawer or an address that does
not exist. `UiDrawerComponent = ComponentType<any>`, so a drawer's props are
untyped, and `UiFeatureInstallResult` composes drawers through
`UnionToIntersection`, which **intersects** a duplicated key rather than
refusing it - the refusal comes from `mergeUniquely` at boot, so the type says
yes and the runtime says no. `useFeatureFlag(flag: FrontendFeatureFlag)` lets any
of the **13** browser-visible flags be read by any package; they are read across
**14** web packages plus `apps/ui`, `release_ui_ai_governance_enabled` in five
places, and `release_langy_promo_enabled` in none.

Configuration arrives in the document, not the environment. `apps/api`'s static
handler injects `publicAppConfigSchema` - a `z.strictObject` of 12 keys - into
the `index.html` it reads off its own disk, so the injector and the reader are
one image. `parseUiFeatureConfig` then hand-projects **8** slices onto the 8
`*WebConfigSchema` declarations that exist; **4** of the 12 keys (`appBaseUrl`,
`demoProjectSlug`, `mode`, `authProvider`) belong to no module. ADR-147's
measured failure - a hand-written map nobody adds a line to - is latent here, not
yet live. Two `import.meta.env.DEV` reads remain, both in files the
`environment-boundaries` rule permits (`ui.entrypoint.tsx`,
`installed-ui-features.composition.ts`), and no web package reads the
environment. That must stay true.

## Decision

A module declares its web half the way it declares its server half, the browser
supplies what no module can know, and `render()` is callable only when nothing is
outstanding.

```ts
await createUi({ document, mount: "root" })
  .withModules(webModules)
  .withInjectedConfig(readPublicAppConfig)
  .withTransport(browserUiTransport)
  .withSession(useBrowserUiSession)
  .withFacilities((f) =>
    f
      .withFeedback(BrowserUiFeedback.create())
      .withStorage(new BrowserUiStorage())
      .withDocumentTitle(BrowserUiDocumentTitle.create())
      .withAnalytics(browserUiAnalytics),
  )
  .withShell((s) =>
    s
      .withToaster(UiErrorToaster)
      .withGraphicsQuality(GraphicsQualityProvider)
      .withBootRefusal(UiBootRefusalScreen),
  )
  .render();
```

A test composition is the same chain with a jsdom `document` and
`withInjectedConfig(() => stubPublicAppConfig)`. That one call is the whole
difference between the browser and its harness, which is the test of the next
point.

1. **The declaration replaces `install(ui)`.** `modules/<id>/web/src/<id>.web.ts`
   exports `defineWebModule("<id>")`, the sibling of `defineServerModule`, over
   the same closed `FEATURE_NAMES` union of 54 ids. The contribution kinds are
   the ones `apps/ui` already mounts, and no others: **screens**, **drawers**,
   **surfaces** (slot fills and seat copy), **commands**, **an api binding**, **a
   failure interceptor**, **a config slice** and **the flags it may read**.

   ```ts
   export const annotationWeb = defineWebModule("annotation")
     .withApi(annotationApi)
     .withScreens(annotationScreens)
     .withDrawers(annotationDrawers)
     .withCommands(annotationCommands);
   ```

2. **A screen declares where it sits.** `within` is the placement, taken from the
   navigation module's closed catalogue of products and settings groups, and a
   `label` with an `icon` is what earns a menu entry. A page with neither is
   reachable and unlisted, which is what a detail page is.

   ```ts
   export const annotationScreens = webScreens("annotation", {
     "pages/[project]/annotations": {
       path: "/:project/annotations",
       within: product("llm-ops"),
       needs: permission("annotations:view"),
       load: () => import("./ui/sections/annotations-screen.tsx"),
     },
     "pages/settings/annotation-scores": {
       path: "/settings/annotation-scores",
       within: settings("project"),
       label: "Annotation Scores",
       icon: Sparkles,
       load: () => import("./ui/sections/annotation-scores-screen.tsx"),
     },
   });
   ```

   `productFromPathname`'s 15 prefixes and `isSettingsShellRoute`'s two
   `startsWith` calls are then derived from the declarations rather than kept by
   hand, and `settings-menu.ts`'s seven group builders become a projection.
   Navigation keeps the **shape** - which products exist, which settings groups
   exist, in what order, behind what gates - and stops keeping the **items**.

3. **A command may only open something its own module declared.** `screen(...)`
   and `drawer(...)` are keyed by this module's own registries, so
   `CommandDrawerName = string` and `Command.path?: string` both go.

   ```ts
   export const annotationCommands = webCommands(annotationScreens, annotationDrawers, {
     "annotation.inbox": { opens: screen("pages/[project]/annotations"), keywords: ["queue"] },
     "annotation.score": { opens: drawer("annotationScoreEditor"), label: "Score this trace" },
   });
   ```

4. **A module declares the flags it may read, and reads no others.**
   `webFlags([...])` takes a `const` tuple the way `reads()` does, and the hook it
   returns narrows to it; `useFeatureFlag` stops being reachable from a web
   package. The union of every declared tuple, checked against
   `FRONTEND_FEATURE_FLAGS`, names a flag nothing reads - today,
   `release_langy_promo_enabled`.

5. **A module's config slice travels with a projection.** `withConfig(schema,
project)` where `project: (config: PublicAppConfig) => Input<schema>`, so the
   projection lives in the module's own package and compiles there.
   `parseUiFeatureConfig`'s hand-written map is deleted.

6. **Both halves install together.** A module carrying a server half and a web
   half on disk and appearing in only one generated list fails
   `pnpm --filter @langwatch/installed-modules typecheck`, naming the id. The
   generator is the only thing that knows what exists on disk, so it emits the
   pairing assertion beside the lists. Today that would name all 38.

7. **The browser's supply vocabulary is its own.** Not stores, channels and
   facilities: the **document** (the injected configuration and the mount point),
   the **transport** (one tRPC client with the SSE link, one QueryClient), the
   **session**, and **facilities** (feedback, storage, document title, analytics).
   There are no secrets and no encryption, because a browser holds nothing it may
   not show.

8. **What is checked when, stated exactly.**

   Compile-time, by `pnpm typecheck`:
   a module installed into one process and not the other; a screen placed in a
   product or settings group that does not exist; a command opening a screen key
   or drawer name the module did not declare; a flag read that was not declared;
   a config slice with no projection, or a projection naming a field
   `PublicAppConfig` does not carry; `render()` called with a supply outstanding.

   **Not compile-time, and this ADR does not claim it**: that the document
   carries the configuration at all - it is a string in a meta tag read at
   runtime; that a value in it satisfies a module's schema; that a lazy chunk
   loads.

   Boot-time, before the first render, each a named refusal with customer-safe
   copy: `browser_config_missing` (no meta tag, or it does not decode),
   `browser_config_refused` (a slice failed its module's schema - names the
   module, never the value), `browser_page_unclaimed`, `browser_page_claimed_twice`
   and `browser_drawer_claimed_twice`. Each needs an entry in `APP_ERROR_CODES`
   and copy in `packages/handled-error/src/presentation.ts`, which is exhaustive
   over that list. Today all five land on `UiBootPageError` in `ui.entrypoint.tsx`,
   whose own comment says the words have not been harvested.

9. **`publicAppConfigSchema` stays strict, and that is a deliberate divergence
   from ADR-147.** The server drops an unknown key and logs it, because a config
   may carry a key a newer module added. The browser's config is written and read
   by one image: `apps/api` injects it into the `index.html` it reads off its own
   disk, and ADR-086 keeps every build's chunks reachable, so the reader and the
   injector never disagree across a rolling deploy. An unknown key there is a
   version skew between the api and ui images in one deployment, which is a
   deployment fault a refusal should name rather than absorb.

10. **The browser never reads the environment, and the chain is how that stays
    true.** `isDevelopment` is derived from the injected `mode`, the way
    `configureDocsRuntime` already derives it, and the two remaining
    `import.meta.env.DEV` reads go. No supply in the chain is an environment read.

## Consequences

`collectWebInstallations`, `WebInstallation`, `WebInstallContext`,
`installUiFeatures`, `uiFeature`, `uiApiBinding`, `UiFeatureInstall` and
`installed-ui-features.composition.ts` are deleted. `installed-ui-features.ts`
becomes the chain, and during the transition it is
`.withModules([...webModules, ...legacyUiFeatures])` where `legacyUiFeatures` is
the shrinking hand-list. That list is declared shrink-only with a counter a check
asserts never grows; at zero, the file and both collectors delete together.

The generator's probe changes from `web/src/index.ts` to
`web/src/<id>.web.ts` plus a matching entry in the package's `exports`. That
entry has to be legal under `ui-web-public-entry`, which today accepts only what
`apps/ui/src/features/catalogue.json` declares under `uses.screens` or
`uses.surfaces`; a declaration entry is neither. Resolving that is the first
lane's work and it blocks every other.

`apps/ui/src/features/<f>/` stops being 39 private adapter folders. A host
component that implements a `*HostApi` from `useUiCapabilities()` is the same
code wherever it lives, and once the module declares its own screens with their
placement it can carry its own host. What survives in `apps/ui` is the chain,
the route table's 29 retired-address redirects, the two pathless layouts and the
application's own shell pieces.

Six page keys are currently unpinned by the install test - four governance pages
and two personal-workspace settings pages. Under this decision the route table is
generated from the declarations, so the pin is the declaration and that gap
closes by construction rather than by someone adding six lines.

Deliberately not included. **No `role`**: there is one browser. **No stores, no
secrets, no encryption, no eventing.** **No server rendering**: `render()` mounts
a React root, it is not a two-phase boot. **No per-module QueryClient**: the
shell already falls back to the host's cache and that stays one cache. **No
runtime module loading**: the installed set is the build's. **No navigation
redesign**: ADR-098's product model stands unchanged, and this ADR moves only who
declares an entry. **The 29 redirect descriptors stay in `apps/ui`**: a retired
address belongs to the application, not to the module that used to own it.

Open questions, none of them papered over.

1. **Who owns `publicAppConfigSchema`.** Four of its twelve keys belong to no
   module. Assembling it from the installed modules' contract schemas closes the
   loop, but the server projection reads the environment and that move belongs to
   a configuration lane, not this one.
2. **Whether duplicate route paths and drawer names are refused by the compiler
   or at boot.** A mapped type over a heterogeneous tuple can do it; ADR-147's own
   note about `Simplify` says the readability of the error is the deliverable.
   Measure the error text before choosing.
3. **Typing drawer props.** `UiDrawerComponent` is `ComponentType<any>` and
   `openDrawer` takes `Record<string, unknown>`, split at runtime by
   `isUrlSerializable` into URL props and in-memory props. Typing it touches 44
   drawers and has to say which half a prop lands in. Unresolved.
4. **Where the builder lives.** `packages/ui-composition` is free;
   `@langwatch/browser-host` already has 28 dependents but putting `defineWebModule`
   there puts the installation mechanism in the package that supplies the
   capabilities the installation consumes.
5. **What happens to the single route anchor.** `webRouteParent: "project"` has
   exactly one anchor, and it is the Langy project layout route, so every
   web-installed route currently splices under Langy. Whether Langy's per-project
   mount is a placement or a wrapper is not decided.
6. **Whether commands move at all.** 41 of the 60 commands are navigation
   commands whose whole content is a path and keywords, so they derive from the
   screen declaration. The other 19 are actions, and whether they stay in
   `navigation-web` or move to the modules that own the actions is not measured.
7. **Whether a module may declare another module's api binding.** Two of the 37
   bindings are exactly that - `annotation` mounts
   `@langwatch/organization-browser/surfaces/personal-workspace-features`, and
   `personal-workspace` mounts `@langwatch/coding-agent-browser` - and
   `@langwatch/project-browser` appears twice under two host ports. This is the
   browser's `ActivatedLicenseSource`: one id must mean one API before `provide`
   by id is sound. It has to be resolved before the pairing assertion in
   decision 6 can be trusted.

This ADR is Proposed rather than Accepted because of questions 1, 2 and 7. It is
ready for a lane on the generator probe and the declaration shape, which is what
blocks everything else, and `dev/docs/adr/README.md` needs its row added.

## Amendment (2026-09-17)

This amendment supersedes the seven open questions and the earlier amendment's
public-API consolidation prerequisite. The previous reading conflated module
identity with a package/surface specifier. The corrected decisions and measured
migration are in [the browser supply plan](../plans/browser-supply-migration.md).
The decision is Accepted; the production builder and migration are not implemented.
The lane's scripts are partial pending five scoped lint fixes recorded in the plan.

### Identity, publication and mounting

There are two key spaces. A module id is the unique identity used by `install`
and `provide`, naming one module and one canonical API. A surface address names
something that module published, including an existing browser hook Provider.
Mounting a published Provider is not declaring another API under the mounter's
id. Any number of modules may mount the same address. No organization/project
public API consolidation is required.

A declaration publishes a typed record with `publishSurfaces`, whose keys are
restricted to the owner's package prefix from the generated catalogue, and names
its mounts with `mountSurfaces`. The final installed tuple checks that every
mount has a publisher and every publication occurs once. Repeated mounts are
valid; the provider set is deduplicated by address and retains the existing
installation order. Generated entries also assert the owning catalogue id.

- Organization publishes
  `@langwatch/organization-browser/surfaces/personal-workspace-features`; annotation
  mounts it. Its existing provider and public exports remain.
- Coding-agent publishes `@langwatch/coding-agent-browser/surfaces/activity`; user,
  whose application adapter is named personal-workspace, mounts it. The codemod
  follows the existing forwarding export to its publisher without deleting it.
- The claim that `@langwatch/project-browser` appears twice as a binding name was
  false. It appears once; `@langwatch/project-browser/project-settings` is a different
  name. Project publishes its existing `/home` and `/project-settings` surfaces
  under its one id. Their two host contracts and hook maps remain separate.

The requested name-count command returns no duplicated name. The extraction
finds 37 provider bindings and 94 distinct published surface addresses. These
are surface quantities, not counts of module APIs.

### Compiler and build refusal

Duplicate module ids, page keys, route paths, drawer names and publications are
compile/build errors. An unpublished mount or a foreign publisher is also a
compile/build error. Boot checks are secondary. This replaces the choice in
question 2 and extends decision 8's compile-time list.

The real-scale experiment is
`dev/scripts/codemods/browser-supply-compiler.mjs`, backed by
`browser-supply.types.ts`. It compiles 136 central page keys and 44 drawers,
then all 141 page keys including annotation's five native routes. The positive
case includes two consumers mounting one publication. Six negative compilations
name the offending path, drawer, id or surface in a flattened record on the
non-callable `render` member. The plan quotes the final `tsc` diagnostics
verbatim. There is no forty-way intersection and no application execution.

The normal UI build must run its typecheck before Vite. The existing build
script does not do that yet; its exact change is a root integration requirement.
This ADR does not equate a successful standalone experiment with a production
build gate already installed.

### Config, drawers and framework ownership

`publicAppConfigSchema` remains the strict portable document envelope in
`@langwatch/config/public-app-config`. Its four shell facts remain shell facts.
The current source has 11 top-level keys; the context's count of 12 was wrong.
Eight existing schema projections move verbatim into web declarations. The
server environment projection stays at the server's config boundary. The
browser's configuration arrives through the document and its `mode` replaces
the two development environment reads.

Drawer props are inferred from their precise lazy renderer component through
`ComponentProps` and the generic host wrapper. No 44 handwritten prop schemas
are introduced. Preserve the existing value-based URL/in-memory split: a union
can produce values on either side, so a static per-key partition is not sound.
The shared drawer boundary owns URL decoding and its tests, while callbacks
retain their current memory lifetime.

The builder lives in `packages/ui-composition`, depending on the existing host,
drawer and transport boundaries. Its declaration entry is the exact
`./declaration` export targeting `src/<id>.web.ts`; it requires no `index.ts`.
The generator has that probe change, emits web dependencies and a typed pairing
assertion, and can run with `--dry-run`. The exact enforcer exception is in the
plan and handoff for the coordinator; that shared file was not changed here.

### Declarative identity with supplied renderers

The declaration owns a screen's key, paths, placement and wrapper chain. The
application supplies a typed renderer for that key, implemented using the
existing controlled host, session, router and transport hooks. `withRenderers`
requires every declared renderer and rejects extra or widened keys. The renderer
registry is generated from exports, not maintained as another handwritten map.
The same treatment applies to drawers, slot renderers and failure interceptors.

This replaces the consequence that every application host folder disappears.
Inspection found 224 host-side files with 34 application helper dependencies,
two direct implementation imports and four cross-feature host edges. Moving
those wrappers does not establish declared supply and would create a much larger
framework extraction. Keeping the application adapters is an intentional final
boundary, not a compatibility list waiting for 39 manual migrations. The script
removes all 40 old install declarations from the 39 adapter entries; seven
entries retain independent exports and 32 become deletable.

Placement is independent of wrappers. Preserve the two instances of the Langy
layout with explicit instance identities; annotation's five routes inherit the
current project's measured anchor chain. Delete the single implicit anchor once
the declared graph is materialised. Product placement never implicitly places a
screen below Langy. Redirects remain application-owned.

### Navigation and flags

Move metadata for 41 navigation commands, 19 project links, 17 section links and
33 settings items onto their owning screens. The total is 110 contributions in
30 module metadata files. All destinations resolve, and extracted settings
predicates reproduce the old menu over all 128 gate combinations. Preserve
order, aliases, icons, labels, keywords and visibility. Products and settings
group policy stay in navigation. Multiple menu placements can point to the same
screen without changing its product identity.

Keep the other 19 commands as shell actions in navigation, with targets checked
against the installed graph supplied to its host. This is an explicit exception
to decision 3 for shell actions; ordinary module commands remain local to their
own declared targets. The navigation adapter passes the supplied catalogue
through pure model functions; it does not install a global mutable registry.
Preserve prefix-based classification of unknown and retired addresses when
replacing the 15 manual prefixes with a declaration-derived classifier.

The flag codemod derives 13 closed module tuples and narrows 24 reader calls in
28 reader/host files, retaining the host-backed implementations. Eight dynamic
arguments remain visible type obligations. A boundary guard must require the
scoped flag type so later broad hook calls cannot bypass it. The unused browser
flag is reported and kept. This makes decision 4's closed read set enforceable
without rewriting each reader's behaviour.

The plan records **253 codemod, six generator, nine derivation and 49 hand file
operations**, including the exact shared-framework and integration paths. Every
script has real dry-run output there. No module/application migration was applied
in this lane, and no production scenario tags were changed.
