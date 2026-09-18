# What a web module looks like under the two tiers

A worked example, long enough to answer the questions that come up while writing
one. The measurements behind it are in
[web-package-coupling.md](./web-package-coupling.md); the decision it serves is
[ADR-148](../adr/148-declared-browser-supply.md).

## The naming, and why it is not a new word

The peer-importable tier is `surfaces/`. Not `shared/`, not `public/`: the
repository already says "surface" for a thing a package publishes for others -
ADR-101 is called feature package surfaces, `catalogue.json` declares
`uses.surfaces`, and **86 of the 171** peer-imported entries are under
`surfaces/` today. Adopting it renames nothing that is already right.

The other tier needs no name at all. **Anything not under `surfaces/` is the
application's**, which makes the rule one line and makes publishing a deliberate
act: you add a `surfaces/` entry, and that shows up in review.

## The package

```jsonc
// modules/trace/browser/package.json
{
  "name": "@langwatch/trace-browser",
  "exports": {
    // the declaration: what apps/ui installs. Never imported by a peer.
    ".": "./src/trace.web.ts",

    // application-only entries. The default tier - no namespace, no ceremony.
    "./trace-host":            "./src/ui/sections/trace-host.tsx",
    "./trace-routes":          "./src/ui/sections/trace-routes.tsx",

    // the published tier. Every entry here is an API another module may import,
    // and every one of them was a deliberate decision.
    "./surfaces/trace-id-peek":     "./src/surfaces/trace-id-peek.tsx",
    "./surfaces/sse-subscription":  "./src/surfaces/sse-subscription.ts",
    "./surfaces/trace-filters":     "./src/surfaces/trace-filters/index.ts",

    "./testing":               "./src/testing/index.ts"
  }
}
```

Three rules hold that file, and all three are mechanical:

1. **A peer may import `./surfaces/*` and nothing else.** Importing
   `@langwatch/trace-browser/trace-host` from another module is an error; from
   `apps/ui` it is fine. This is `private-runtime-export` pointed at the browser.
2. **The published set is shrink-only.** A counter carries today's number, and a
   check refuses a commit that raises it. Growing the API is then a conversation,
   not a side effect of an import somebody added.
3. **A name the design system already has may not be published.** `copy-icon`
   and `format-money` exist in `@langwatch/design-system` *and* in feature
   packages today, and `experiment` imports the feature copies. The rule reads
   the design system's exports and refuses the duplicate at the point it is
   declared.

## The declaration

```ts
// modules/trace/browser/src/trace.web.ts
import { defineWebModule } from "@langwatch/ui-composition";

import { traceApi } from "./model/trace-api.ts";
import { traceScreens } from "./ui/trace-screens.ts";
import { traceDrawers } from "./ui/trace-drawers.ts";
import { TraceStreamProvider } from "./model/trace-stream.provider.tsx";

export const traceWeb = defineWebModule("trace")
  .withApi(traceApi)
  .withScreens(traceScreens)
  .withDrawers(traceDrawers)
  // the provider its own published surfaces need, mounted once, by installation
  .withProvider(TraceStreamProvider);
```

## The part that makes a shared component usable: the provider is already there

A consumer should import one thing and render it. It should not be handed a
component and then told to go and mount a provider for it - that is how
`langy-store` and `langy-context` came to be imported by three modules each as
bare state.

So a surface that needs state does not export the state. The **module's own
declaration** mounts the provider at installation, and the surface reads it:

```tsx
// modules/trace/browser/src/surfaces/trace-id-peek.tsx
import { useTraceStream } from "../model/trace-stream.provider.tsx";   // private

export function TraceIdPeek({ traceId }: { traceId: string }) {
  const stream = useTraceStream();          // the provider is already mounted:
  ...                                       // trace's web module installed it
}
```

```tsx
// modules/experiment/browser/src/ui/sections/experiment-run-row.tsx
import { TraceIdPeek } from "@langwatch/trace-browser/surfaces/trace-id-peek";

export function ExperimentRunRow({ run }: { run: Run }) {
  return <TraceIdPeek traceId={run.traceId} />;   // one import line, no wiring
}
```

One import, no provider, no store. And the guarantee behind it is the same one
the server side already makes: the surface works because its owning module is
installed. A build that installs `experiment` and not `trace` fails at compile
time, naming the peer - which is exactly the check
[ADR-147](../adr/147-compiler-checked-process-supply.md) makes for the server,
and the reason `provide` exists for the case where you deliberately stand in.

## What moves to the design system

A component with no domain in it does not belong to a feature module, and the
cross-import list is full of them: `markdown`, `hoverable-big-text`, `copy-icon`,
`format-money`, `emoji-picker-modal`, `keyboard-key`, `isolated-error-boundary`,
`next-link`, `redacted-field`, `format-milliseconds`. `workflow-web` publishes
several and is imported for them by `evaluator`, `experiment` and `langy`; none
of those imports is about workflows.

```diff
- import { Markdown } from "@langwatch/workflow-browser/markdown";
- import { CopyIcon } from "@langwatch/model-provider-browser/copy-icon";
+ import { Markdown } from "@langwatch/design-system/markdown";
+ import { CopyIcon } from "@langwatch/design-system/copy-icon";
```

That is a codemod, not a migration: the specifier changes and nothing else does.
It removes a large share of the cross-module edges outright, because the edge was
never about the feature - it was about where a button happened to live.

## Decided: the genuinely shared things move to a package of their own

Subpath exports are fine in every technical respect - ESM resolves them, Vite
bundles them, tree-shaking is unaffected - and they still do not solve the
problem that matters. A subpath is invisible to the dependency graph: if
`experiment-web` imports `trace-web/surfaces/x` while `trace-web` imports
`experiment-web/surfaces/y`, that is a package cycle whatever the subpaths are
called, and there are **nine such pairs today**. A separate package that depends
on nothing breaks them, and the package manager enforces the boundary instead of
a lint rule having to.

The cost turned out to be small, which is what decided it. The shared set is 14
entries, and they are nearly dependency-free leaves:
`authz/surfaces/scope-picker` imports **nothing** external,
`prompt/surfaces/variables` imports **nothing**, and
`model-provider/surfaces/model-selector` reaches only for React, Chakra, two
*contract* packages and the design system. None of them depends on its owner's
web package, so extracting them drags no feature along.

### Where it lives: `modules/<name>/web-kit`, and it is not a module

`@langwatch/trace-browser-kit`, beside `contract`, `server` and `web`. The obvious
objection is that a kit is not installed, so it is not a module - and that is
true, and it is already true of half the directory. `modules/<name>/` holds
`adrs/`, `contract/`, `feature.json`, `specs/`, `server/` and `web/`, and only
the last two are installed. A contract is imported and never installed; it
appears nowhere in a composition root. The directory groups a **domain**, not an
installation unit.

So a kit sits there for the same reason a contract does. It needs its domain -
a model selector has to know what a model provider is, which is exactly why it
belongs to `model-provider` rather than to a generic widget bin - and it is a
library rather than a thing the process installs. Both of those are already
normal here.

Two rules keep it from spreading. **A kit exists only where something is
genuinely shared**: measured, 27 modules publish something a peer imports, but
only **9** publish anything with three or more consumers, so there are about
seven kits and not twenty-seven. And **a kit may not import its own module's
`web` package** - that is what keeps it a leaf and what breaks the cycles, and
it costs nothing today because none of the fourteen does.

### The fourteen do not all go to the same place

They are not one kind of thing, and routing them by kind is most of the work:

| what it is | entries | where it goes |
| --- | --- | --- |
| domain-aware shared components | `scope-picker`, `model-selector`, `period-selector`, `llm-model-display`, `trace-id-peek`, `provider-icons`, `workflow-icons` | the new shared web package |
| a shared hook | `trace/surfaces/sse-subscription` | the new shared web package |
| types | `experiment/workbench-types`, `prompt/surfaces/variables` | the owning **contract** package - they are not components and a contract is already framework-free |
| an api client, published **twice** | `workflow-web/workflow-api` **and** `api-client-web/workflow-api` | `@langwatch/browser-trpc`, which already exists and already has it - the workflow-web copy is a duplicate nobody noticed |
| cross-module **state** | `langy/surfaces/langy-store`, `langy/surfaces/langy-context` | neither. Three modules read langy's store directly, and a shared package holding live state re-creates the cycle at one remove. This is the one genuine decision left, and it is about who owns the state rather than where the file sits |

Domain-*free* primitives are a separate matter and do not go to the new package
at all - they go to `@langwatch/design-system`, which already holds that role and
already exports `copy-icon` and `format-money` that feature packages currently
shadow.

So the new package holds eight things, the contracts take two, `api-client-web`
takes one it already had, and two are a decision. That is the whole of it.

## The sizes, so nobody plans this by feel

| | |
| --- | --- |
| entries only `apps/*` imports | **73** - already correct, no change |
| entries a peer imports | **174** |
| ...of those, used by **one** peer | **125** - coupling, not API |
| ...used by three or more | **14** - the genuinely shared set |
| entries nothing imports at all | **29** - delete |
| peer entries already under `surfaces/` | **86** of 171 |
| `surfaces/` entries only the app imports | **17** - move out of the tier |

So the published API a lane has to design is **14 entries**, not 174. The other
158 are each one of three cheap answers: move it to its single consumer, move it
to the design system, or record it as debt on the shrink-only baseline.
