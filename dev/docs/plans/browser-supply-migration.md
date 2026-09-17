# Declared browser supply: decisions and measured migration

2026-09-17, `feat/strict-feature-layout-v0`, working tree. Lane status: **partial**.
The seven design questions are answered. The compiler experiment and all scripts
have run. Five script lint diagnostics remain; the lane's three-attempt rule
stopped implementation. No migration, generated application output, package
installation or Git write was applied. The exact failures are at the end.

## Cost and scope

**(a):(b):(c):(d) = 253:6:9:49 file operations.** That is **268 mechanical,
generated or derived operations (84.5%) to 49 hand operations (15.5%)**.
This measures operations in the ordered worklist, not hours or distinct paths.
The combined migration script proposes **214 distinct files**, and cleanup
handles another **39 feature entries**. Generator refresh and hand integration
can revisit a path already changed by extraction. Lockfile and TypeScript build
reference regeneration are routine generated artefacts outside this source-file
ratio; refresh them through the existing workspace generators at integration.

There is no assignment to hand-convert 39 features. One codemod emits the 41 web
declarations, including web packages with no current app registration. The
remaining hand work is the shared composition mechanism, its tests and the
navigation supply boundary. The 49 paths and reasons are enumerated below.

The design deliberately retains application renderer adapters. Moving the
existing hosts would move **224 files**, with imports of **34 application helper
files**, two direct module implementation imports and four cross-feature host
edges. The module owns route identity, placement, publications, required
renderers and config. The app implements the named renderers from its session,
router and transport hooks. `generate-modules.mjs` derives their registry from
exports, and `withRenderers` requires exactly the declared keys. This amends
ADR-148's proposed deletion of every host folder. It follows the existing
controlled-host boundary without inventing a second hand-maintained install map.

## Seven decisions

1. **Keep `publicAppConfigSchema` in `@langwatch/config/public-app-config`.** It
   is the portable, strict document envelope shared by injector and reader.
   The four shell facts remain `appBaseUrl`, `demoProjectSlug`, `mode` and
   `authProvider`; they do not become a fabricated feature. The current source
   actually has **11 top-level keys**, rather than the ADR's 12. Eight schema
   projections move verbatim into declarations. The legacy `deployment` and
   `observability` slices belong to `saas` and `ops`; the evaluation capability
   slice is consumed by `evaluator` using the existing evaluation contract
   schema. Root integration supplies the existing capability fields from those
   parsed slices. No environment projection or document wire change.
   **Cost:** zero envelope edits; eight of the 41 generated declarations; one
   central projection file deleted in step C1; root config integration and its
   existing test are included in D3/D6.

2. **Compiler and build refusal are primary.** Preserve literal tuples and
   report a flattened record of named problems on the non-callable `render`
   member. The experiment uses 41 real package identities plus the shell,
   **136 central page keys and 44 drawers**, then also compiles all **141** keys
   after including annotation's five native routes. Aliases share one page key;
   each distinct route path is checked. Pathless layouts are not empty paths.
   Duplicate module ids, page keys, route paths, drawer names and publications
   are rejected; missing publications and foreign publishers are named too.
   Widened tuples/strings are refused rather than silently bypassing the check.
   **Cost:** the common supply types and compiler tests in D1, plus **one build
   script edit** in D3. `apps/ui` currently builds with Vite alone; change its
   `build` script to `pnpm typecheck && NODE_ENV=production vite build --configLoader runner`.
   A defensive boot refusal can remain. The experiment is a standalone compiler
   proof, not a claim that the production builder or build script already changed.

3. **Infer drawer props from the renderer; retain the existing value-based URL
   split.** `lazyDrawer` must return the precise lazy component type, preserving
   `ComponentProps` through the already-generic `withHost`. Derive the callable
   name/props union from the supplied renderer registry. Do not write 44 copies
   of component props. Strings, numbers, booleans, nullish values and arrays of
   primitives follow the current `isUrlSerializable`; objects, dates and
   callbacks remain in memory. A union-valued prop can occupy either half, so a
   static per-property URL classification would be false. Treat URL decoding as
   untrusted input at the framework boundary, retain current reload semantics,
   and test primitive-array normalisation and callback lifetime. URL parsing
   cannot be made trustworthy just by `ComponentProps`.
   **Cost:** **three framework files and two tests** in D2, **15 generated drawer
   registries**; **zero manual drawer-component edits**. Runtime erasure belongs
   inside the mount boundary, with no public `ComponentType<any>` escape.

4. **Use `packages/ui-composition`.** It owns declaration types, the supply
   state machine, publication resolution and render orchestration. It consumes
   the existing `ui-host`, `ui-drawer` and transport boundaries; `ui-host` does
   not acquire a dependency on installation. Web declarations use the explicit
   flat `./declaration` export, never an `index.ts` probe.
   **Cost:** **12 new framework files** in D1, **41 generated package manifest
   edits**, one changed generator, two enforcer files in D5. The enforcer edit
   belongs to the coordinator; see the exact request below.

5. **Placement and wrapper instances are separate.** Screens carry `within`
   and `shell`; their `routes` carry an explicit `layouts` chain. Each pathless
   layout occurrence receives an instance key. The current Langy page is used
   twice, so those instances remain distinct even though its loader key is one.
   Annotation's five paths inherit the _measured_ `webRouteParent: "project"`
   anchor's chain. Delete the anchor after materialising the declared graph.
   Product identity does not imply a Langy wrapper. Keep route aliases,
   permissions, host wrappers and lazy loaders exactly as supplied today.
   **Cost:** route metadata in the **41 declarations and one shell declaration**,
   **40 loader files mechanically narrowed**, one route materialiser in D3 and
   its integration coverage in D6. The 29 redirects remain app-owned.
   Prefix compatibility, including unknown paths and retired `/admin` addresses,
   is an acceptance condition for the derivation, not permission to change
   landing memory; see C1.

6. **Derive navigation commands; retain the 19 shell actions.** The measured
   lists contain **41 navigation commands, 19 project links, 17 section links
   and 33 settings items**. All 110 destinations resolve mechanically to a
   screen and route-alias index. Copy labels, icons, keywords, flags, ordering,
   active aliases and gate predicates. The 19 actions remain in navigation,
   where the command dispatcher already lives; type their targets against the
   installed graph supplied to the navigation host. An ordinary module command
   remains restricted to its own declared targets. This explicit shell action
   exception amends decision 3, rather than relocating 19 action handlers.
   Products, group order and group policy stay in navigation.
   **Cost:** **30 generated metadata files**, **five registry/projection files**
   in C1 and **13 measured consumers plus their host contract** in D4.
   The settings extraction matches the existing function for all **128** gate
   combinations. A screen can have several menu placements: Gateway's Model
   Providers link must not reclassify the settings screen as a Gateway screen.

7. **Identity and published addresses are different key spaces.** Module ids
   remain the catalogue's unique keys for `install` and `provide`, with one
   canonical API per id. A hook-provider map is a published browser surface,
   not another claim on that id. The publisher owns the surface address;
   arbitrary numbers of consumers can mount it. Resolve a mount against the
   installed publication union and reject absence at compile/build time.
   `defineWebModule(id)` obtains the package prefix from the generated catalogue;
   its publication keys must belong to that prefix. Duplicate publication is
   rejected both within a publisher and across the final tuple. The generator
   additionally asserts that each declaration's `id` equals its catalogue id.
   **Cost:** **94 publications and their mounts across the 41 declarations**;
   no organization/project API consolidation and no public API surgery.

   The three named cases become:

   - `annotation` mounts organization's existing
     `@langwatch/organization-web/surfaces/personal-workspace-features`.
     Organization publishes it once with `personalWorkspaceFeaturesApi.Provider`.
   - `personal-workspace` belongs to `user`. It mounts coding-agent's existing
     `@langwatch/coding-agent-web/surfaces/activity`, which coding-agent publishes
     with `codingAgentApi.Provider`. The script follows the existing user
     forwarding export to its publisher. That export need not be removed.
   - `@langwatch/project-web` is present **once** as a binding name, alongside
     the distinct `@langwatch/project-web/project-settings`. The declaration
     publishes the existing `/home` and `/project-settings` surface addresses
     under the **one project id**. Both host contracts and procedure maps remain.

   The requested grep returns 39 lines, each with count `1`; no name is repeated.
   The previous blocked plan's claim about two identical project binding names
   and the consequent consolidation prerequisite were incorrect.

For example, the declaration vocabulary is:

```ts
const organizationWeb = defineWebModule("organization").publishSurfaces({
  "@langwatch/organization-web/surfaces/personal-workspace-features": {
    provider: personalWorkspaceFeaturesApi.Provider,
    load: () => import("./behavior/personal-workspace-features-api.ts"),
  },
});
const annotationWeb = defineWebModule("annotation").mountSurfaces([
  "@langwatch/organization-web/surfaces/personal-workspace-features",
] as const);
```

Mounting does not install a second identity. The provider set is resolved from
mounts and deduplicated by published address; migration metadata retains the
old installation order. The generated module list remains free to sort ids.

## Ordered migration worklist

| Step | Kind | File operations | Deliverable and ordering                                                                                                                                                                                                                   |
| ---- | ---- | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1   | (d)  |              12 | Implement the shared builder, typed renderer supply and publication graph below. Use the experiment's diagnostic form.                                                                                                                     |
| D2   | (d)  |               5 | Preserve drawer component props through the existing framework and test URL/memory behaviour.                                                                                                                                              |
| D5   | (d)  |               2 | Coordinator admits the exact declaration entry and binds its guard test.                                                                                                                                                                   |
| A1   | (a)  |             214 | Run `browser-supply-migration.mjs`; it composes declaration, navigation and flag plans in memory before writing. No per-feature typing.                                                                                                    |
| B1   | (b)  |               6 | `generate-modules.mjs` plus its five final output paths. Web imports use `/declaration`, dependencies include web packages, a typed pairing assertion and owner map are generated, renderer lists derive from exported adapter registries. |
| D3   | (d)  |               6 | Switch root supply and make the normal UI build typecheck first. Supply pages, drawers, slots, seat copy and interceptors from generated registries.                                                                                       |
| D4   | (d)  |              14 | Thread the declared navigation catalogue through its existing controlled host and 13 actual consumers.                                                                                                                                     |
| C1   | (c)  |               9 | Replace the five navigation data registries, central route table and config projection with derived values; delete the two obsolete installation mechanisms after callers move.                                                            |
| D6   | (d)  |               6 | Register customer-safe refusal codes/copy and verify root/config/layout/compiler behaviour.                                                                                                                                                |
| D7   | (d)  |               4 | Retire legacy installation types at the existing application/transport boundaries.                                                                                                                                                         |
| A2   | (a)  |              39 | Run `browser-supply-cleanup.mjs` in the same atomic root cutover. Removes 40 declarations, deletes 32 empty entries, retains seven entries with independent exports.                                                                       |

Apply A1, B1, D3, C1 and A2 as one reviewed integration slice after the framework
and enforcer support exist. The scripts are dry-run by default. `--write` is
implemented, but was never invoked. The migration script requires the new
composition package; cleanup also refuses while the root still uses the legacy
collectors. Those guards are prerequisites, not a replacement for review,
package checks and an atomic cutover. After applying, refresh workspace dependencies
and build references with the existing generators before running package checks.

B1 outputs `modules/server-modules.generated.ts`, `modules/web-modules.generated.ts`,
`modules/server-module-members.generated.ts`, `modules/package.json` and
`apps/ui/src/features/browser-renderers.generated.ts`. The current real tree
still generates zero web installations. Its proposed pairing assertion names
38 missing web halves and would deliberately fail an installed-modules
check if written before A1. Only the text was generated in this lane; the
current checked-out generated files were not changed.

C1's nine existing files are:

- `modules/navigation/web/src/model/command-catalogue.ts`
- `modules/navigation/web/src/model/project-nav-items.ts`
- `modules/navigation/web/src/model/section-nav-items.ts`
- `modules/navigation/web/src/model/settings-menu.ts`
- `modules/navigation/web/src/model/products.ts`
- `apps/ui/src/model/ui-route-table.ts`
- `apps/ui/src/behavior/ui-feature-config.ts`
- `apps/ui/src/behavior/ui-feature.ts`
- `apps/ui/src/behavior/ui-web-installation.ts`

The five navigation files currently total **1,431 lines**; the plan does not
claim to delete every line. Delete their item arrays, 33 independent settings
hrefs and 15 manually maintained classification prefixes. Keep product/group
policy, existing 19 actions and reusable types/helpers. The common projection
in D1 derives item order, addresses, active aliases and settings gates from the
110 moved contributions. Address classification must preserve the old static
family-prefix behaviour, wildcard fall-through and redirect-source behaviour;
a route match alone does not preserve unknown-address landing memory. The
`within` value for the global catch-all remains `llm-ops`. Add those differential
cases in D6 before deleting the old prefix implementation.

The flag script retains each host-backed reader's implementation and adds a
module-local closed flag type at its call and host signature. Its **eight
non-literal arguments** remain explicit compiler obligations. In D5, the browser
boundary must also require the scoped flag type on reader calls; otherwise a
future direct call to a broadly typed hook could bypass the declaration. This
is a guard requirement, not a claim that inserting `satisfies` bans future
unscoped imports. Unread `release_langy_promo_enabled` is reported, not deleted.

## The 49 hand files

These implement new runtime/type behaviour or connect new data to an existing
React/transport lifetime. There is no existing implementation for a codemod to
relocate. Source-only rewriting cannot decide the correct host/context lifetime,
error mapping or URL decoder behaviour. This is a bounded shared-framework
packet; it contains no repetitive web-declaration editing.

**D1, 12 new files under `packages/ui-composition/`:** `package.json`,
`tsconfig.json`, `tsconfig.build.json`, `src/index.ts`, `src/web-module.ts`,
`src/ui-supply.ts`, `src/ui-supply.types.ts`, `src/ui-render.tsx`,
`src/ui-surfaces.tsx`, `src/ui-navigation.ts`,
`tests/ui-supply.compiler.unit.test.ts`, `tests/ui-supply.integration.test.tsx`.
The handwritten part is the fluent type state, exact supplies, typed publication
ownership, provider lifecycle and navigation projection. Literal data comes
from A1. Import no runtime-composition implementation.

**D2, five files under `packages/ui-drawer/src/`:**
`model/drawer-registry.ts`, `behavior/use-drawer.ts`,
`ui/sections/current-drawer.tsx`,
`model/__tests__/drawer-registry.types.unit.test.ts`,
`behavior/__tests__/drawer-props.unit.test.ts`.
A prop-type rewrite alone cannot implement trustworthy URL input or prove that
callbacks retain their existing lifetime; these tests must exercise those paths.

**D3, six files under `apps/ui/`:** `package.json`, `src/ui.entrypoint.tsx`,
`src/features/installed-ui-features.ts`,
`src/features/installed-ui-features.composition.ts`,
`src/ui/sections/ui-route-objects.tsx`,
`src/features/navigation/ui/sections/navigation-host.tsx`.
They establish the React root, supplies, matching/layout semantics and the build
gate. Replace the two environment reads with the injected `mode` here.

**D4, 14 files under `modules/navigation/web/src/`:**
`model/navigation-host.ts`, `behavior/use-command-feature-flags.ts`,
`behavior/use-filtered-commands.ts`, `behavior/use-navigation-shell-state.ts`,
`behavior/use-navigation-tracking.ts`, `behavior/use-settings-menu.ts`,
`model/resolve-settings-back-target.ts`, `model/resolve-shell-route.ts`,
`ui/sections/main-menu.tsx`, `ui/sections/product-sidebar.tsx`,
`model/__tests__/command-catalogue.unit.test.ts`,
`model/__tests__/products.unit.test.ts`,
`model/__tests__/project-nav-items.unit.test.ts`,
`model/__tests__/settings-menu.unit.test.ts`.
The 13 consumers were measured from their imported symbols, not every import of
these model files. Types, actions and product-policy imports stay compatible.
The semantic work is placing the supplied catalogue at the host and passing it
through pure resolver functions without introducing a global mutable registry.

**D5, two files under `packages/architecture-enforcer/`:**
`src/policies/frontend/frontend-ui-boundaries.ts` and
`tests/web-declaration-entry.unit.test.ts` (new).
Guard the exact owning declaration export, package-id correspondence and scoped
flag calls. Shared ownership requires coordinator application.

**D6, six files:** `packages/handled-error/src/app-codes.ts`,
`packages/handled-error/src/presentation.ts`,
`apps/ui/tests/installed-ui-features.unit.test.ts`,
`apps/ui/src/behavior/__tests__/ui-feature-config.unit.test.ts`,
`apps/ui/tests/declared-browser-supply.integration.test.tsx` (new),
`apps/ui/tests/declared-browser-supply.compiler.unit.test.ts` (new).
Preserve existing coverage; exercise provider/mount deduplication, anonymous
routes, alias paths, layout-instance identity, missing supplies, flag reads,
config refusals and a build that fails before boot. Do not bind the Gherkin tags
to this lane's standalone proof; production composition is still unimplemented.

**D7, four files under `apps/ui/src/`:** `ui/sections/ui-application.tsx`,
`ui/sections/ui-feature-shell.tsx`, `behavior/ui-feature-transport.ts`,
`behavior/ui-rpc.ts`. Remove the old installation-shaped types while retaining
one transport and QueryClient. Type changes across that lifetime boundary need
implementation review; a token replacement does not establish compatibility.

## Real dry-run output

`node dev/scripts/codemods/browser-supply-tree.mjs`:

```text
41 web packages; 39 uiFeature calls; 44 drawers; 141 distinct page keys; 144 route occurrences
```

`node dev/scripts/codemods/browser-supply-declarations.mjs`:

```text
agent: 1 page keys; 1 drawers; 5 publications; 3 mounts
analytics: 9 page keys; 0 drawers; 2 publications; 1 mounts
annotation: 6 page keys; 1 drawers; 5 publications; 10 mounts
api-key: 4 page keys; 0 drawers; 1 publications; 1 mounts
auth: 8 page keys; 0 drawers; 1 publications; 1 mounts
authz: 2 page keys; 0 drawers; 1 publications; 1 mounts
automation: 6 page keys; 3 drawers; 1 publications; 1 mounts
coding-agent: 0 page keys; 0 drawers; 1 publications; 0 mounts
data-privacy: 1 page keys; 0 drawers; 1 publications; 1 mounts
data-retention: 1 page keys; 0 drawers; 1 publications; 1 mounts
dataset: 2 page keys; 1 drawers; 4 publications; 2 mounts
evaluator: 3 page keys; 3 drawers; 3 publications; 2 mounts
experiment: 5 page keys; 2 drawers; 0 publications; 0 mounts
feature-flag: 0 page keys; 0 drawers; 0 publications; 0 mounts
gateway: 10 page keys; 1 drawers; 1 publications; 1 mounts
github: 1 page keys; 0 drawers; 1 publications; 1 mounts
langy: 1 page keys; 0 drawers; 4 publications; 2 mounts
model-provider: 2 page keys; 3 drawers; 2 publications; 3 mounts
monitor: 1 page keys; 0 drawers; 1 publications; 1 mounts
navigation: 4 page keys; 0 drawers; 2 publications; 6 mounts
notification: 1 page keys; 0 drawers; 1 publications; 1 mounts
onboarding: 5 page keys; 0 drawers; 1 publications; 1 mounts
ops: 19 page keys; 1 drawers; 1 publications; 1 mounts
organization: 5 page keys; 2 drawers; 3 publications; 1 mounts
presence: 0 page keys; 0 drawers; 0 publications; 0 mounts
project: 2 page keys; 2 drawers; 2 publications; 3 mounts
prompt: 1 page keys; 1 drawers; 5 publications; 2 mounts
scenario: 3 page keys; 13 drawers; 4 publications; 25 mounts
secret: 1 page keys; 0 drawers; 1 publications; 1 mounts
share: 0 page keys; 0 drawers; 0 publications; 0 mounts
suite: 0 page keys; 0 drawers; 6 publications; 0 mounts
topic: 1 page keys; 0 drawers; 1 publications; 1 mounts
trace: 2 page keys; 2 drawers; 10 publications; 4 mounts
user: 10 page keys; 0 drawers; 1 publications; 3 mounts
workflow: 3 page keys; 8 drawers; 10 publications; 5 mounts
billing: 3 page keys; 0 drawers; 3 publications; 3 mounts
governance: 15 page keys; 0 drawers; 1 publications; 1 mounts
licensing: 1 page keys; 0 drawers; 5 publications; 5 mounts
managed-provider: 0 page keys; 0 drawers; 1 publications; 0 mounts
saas: 0 page keys; 0 drawers; 0 publications; 0 mounts
scim: 1 page keys; 0 drawers; 1 publications; 1 mounts
would write 143 files: 41 declarations, 41 manifests, 15 drawer registries, 1 renderer registry, 1 shell declaration, 40 loader files narrowed, 4 slot files narrowed
37 provider bindings; 94 published addresses; 8 config projections; 0 host implementations moved
prerequisite: ui-composition builder + typed renderer supply; root integration is a separate atomic step
```

`node dev/scripts/codemods/browser-supply-navigation.mjs`:

```text
command: 41 entries
project: 19 entries
gatewayNavItems: 9 entries
governanceNavItems: 8 entries
settings-organization: 7 entries
settings-access: 6 entries
settings-ai-members: 3 entries
settings-data-controls: 3 entries
settings-project: 3 entries
settings-ops: 5 entries
settings-backoffice: 6 entries
would write 110 navigation contributions across 30 module files; unmatched addresses: 0
settings equivalence: 128 gate combinations passed; 19 action commands stay in navigation
cutover derives the four item registries from these declarations; product/group policy stays in navigation
```

`node dev/scripts/codemods/browser-supply-flags.mjs`:

```text
analytics: 1 declared flags
automation: 1 declared flags
evaluator: 1 declared flags
experiment: 2 declared flags
langy: 3 declared flags
model-provider: 1 declared flags
navigation: 4 declared flags
onboarding: 1 declared flags
organization: 1 declared flags
project: 2 declared flags
scenario: 1 declared flags
trace: 1 declared flags
governance: 1 declared flags
would write 41 files: 13 flag tuples; 28 reader/host files; 24 reads (8 non-literal arguments retained and type-checked)
unread in web packages: release_langy_promo_enabled
```

The flag script's phrase "type-checked" describes the emitted `satisfies`
obligations. This lane parsed the generated edits; it did **not** typecheck all
28 target module files against the future builder.

`node dev/scripts/codemods/browser-supply-migration.mjs`:

```text
would write 214 unique files (101 new, 113 existing)
41 module declarations; 141 page keys; 44 drawers; 37 providers; 8 config projections
110 navigation contributions; 128 settings equivalence cases; 24 flag reads narrowed
all proposed TypeScript parses; no production files written without --write
```

`node dev/scripts/codemods/browser-supply-cleanup.mjs`:

```text
would remove 40 old install declarations across 39 feature entries
32 empty entries deleted; 7 entries retain independent exports; host adapters stay as named renderer supply
prerequisite: root cutover and its tests; never run this alongside the old installed-ui-features list
```

`node dev/scripts/generate-modules.mjs --dry-run`:

```text
Would generate modules/server-modules.generated.ts (105 lines)
Would generate modules/web-modules.generated.ts (55 lines)
Would generate modules/server-module-members.generated.ts (62 lines)
Would generate modules/package.json (75 lines)
```

`node dev/scripts/codemods/browser-supply-verify.mjs` creates a disposable fixture
from the real tree and the proposed outputs, runs the real generator, compares
all renderer keys, then removes the fixture:

```text
current tree: generator outputs parse; missing 38 web halves are named in the proposed pairing assertion
fixture: 41 declaration exports discovered without index.ts; 141 renderer keys; 44 drawer keys; no duplicates
negative fixture: a source without its matching declaration export is not installed
PASS: 214 proposed files validated; production tree not written
```

## Compiler output, verbatim

`node dev/scripts/codemods/browser-supply-compiler.mjs` uses the installed
TypeScript 7 `tsc` executable, strict mode, a temporary project containing only
the specimen and its types, and no ambient package types. Its positive fixture
also mounts one publication from two different modules. The generated catalogue
maps ids to real package names. No expected-error directives or assertions hide
the failing calls. Native `tsc` returns exit **1** for the refusals.

```text
real tree: 41 module ids + shell; 136 page keys; 44 drawers; 136 paths
valid-real-scale: exit 0; 298 ms
valid-including-native-routes: exit 0; 202 ms
duplicate-path: exit 1; 232 ms
duplicate-path.ts(4,32): error TS2349: This expression is not callable.
  Type '{ readonly "duplicate route path \"/settings\"": never; }' has no call signatures.
duplicate-drawer: exit 1; 235 ms
duplicate-drawer.ts(4,32): error TS2349: This expression is not callable.
  Type '{ readonly "duplicate drawer name \"createProject\"": never; }' has no call signatures.
duplicate-id: exit 1; 280 ms
duplicate-id.ts(4,32): error TS2349: This expression is not callable.
  Type '{ readonly "duplicate module id \"project\"": never; }' has no call signatures.
duplicate-publication: exit 1; 219 ms
duplicate-publication.ts(4,32): error TS2349: This expression is not callable.
  Type '{ readonly "duplicate surface publication \"@langwatch/organization-web/surfaces/personal-workspace-features\"": never; }' has no call signatures.
foreign-publisher: exit 1; 231 ms
foreign-publisher.ts(4,32): error TS2349: This expression is not callable.
  Type '{ readonly "module \"user\" cannot publish \"@langwatch/project-web/pretend\"": never; }' has no call signatures.
unpublished-mount: exit 1; 227 ms
unpublished-mount.ts(4,32): error TS2349: This expression is not callable.
  Type '{ readonly "unpublished surface \"@langwatch/organization-web/not-published\"": never; }' has no call signatures.
PASS: 2 positive compilations; 6 named compile-time refusals; no application executed
```

The named-property record is on the attempted `render()` call, so the output
contains the offending name rather than a forty-way intersection. The final
builder must combine these problems with missing supplies before exposing a
callable render member. The normal `build` script must execute its typecheck;
Vite transpilation on its own would bypass the guarantee.

## Exact enforcer request

In `packages/architecture-enforcer/src/policies/frontend/frontend-ui-boundaries.ts`,
add this helper immediately before `lintWebPublicExports`:

```ts
function isWebDeclarationExport(pkg: WebPackage, exportPath: string, target: string): boolean {
  return exportPath === "./declaration" && target === `./src/${pkg.feature}.web.ts`;
}
```

In that function's export loop, immediately after the test-only-export guard, add:

```ts
if (isWebDeclarationExport(pkg, exportPath, target)) continue;
```

In `lintWebPrivateStructure`, change the second `flatPublicEntries` filter to:

```ts
.filter(([exportPath, target]) =>
  isWebDeclarationExport(pkg, exportPath, target) ||
  capabilityForSpecifier(webPackages, `${pkg.name}/${exportPath.slice(2)}`, catalogue),
)
```

These three edits admit the owner file as a closed entry. They do not classify
it as a screen/surface or permit feature code to import declaration entries.
`apps/ui` imports `@langwatch/installed-modules/web`; the generator alone imports
the declaration entries. Add fixtures that accept the correct owner target,
reject another module's target and reject undeclared arbitrary root entries.
The additional id/source and scoped-flag guards are D5 implementation work,
not part of the three-line export exception.

## Current check failures and next action

All eight `.mjs` entry points above ran against the real tree in dry-run or
read-only mode. The fixture verifies syntax and catalogue/renderer structure,
not production runtime behaviour or future module typechecks. No app typecheck
was run because no consumed generated output changed. Oxfmt passed on the script
sources. The final scoped Oxc command failed with these five diagnostics:

```text
browser-supply-flags.mjs:53:1: rewriteFlagSource cognitive complexity 19 (max 15)
browser-supply-tree.mjs:38:5: condition-shape: 3 calls and 3 logical operators
browser-supply-tree.mjs:50:10: condition-shape: 3 calls and 3 logical operators
browser-supply-declarations.mjs:22:8: declarationPlan cognitive complexity 28 (max 15)
browser-supply-navigation.mjs:125:1: collectNavigationItems cognitive complexity 18 (max 15)
```

The continuation is small: extract the flag-signature loop, split the two AST
kind tests into guards, lift `product`/`screenDefinitions` from `declarationPlan`,
and extract the per-registry navigation scan. Re-run the combined migration,
compiler and fixture scripts, then the scoped Oxc check. Review the renderer
adapter amendment before scheduling D1; do not resurrect the false API
consolidation prerequisite. The scripts are not ready to apply while these
checks and the future framework/integration prerequisites remain outstanding.
