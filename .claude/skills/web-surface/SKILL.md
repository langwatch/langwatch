---
name: web-surface
description: "Publish a piece of one feature's web package for another feature to mount: a surfaces/<id> export, its catalogue declaration in apps/ui/src/features/catalogue.json uses.surfaces, and the closure and layer rules that decide what may sit behind it. Covers surface versus screen, why the export path is the contract, governedWebPackages, and the ui-web-public-entry / ui-screen-closure / ui-web-capability-declaration rules. Use when someone says 'reuse this component in another feature', 'share this store', 'mount X inside Y's page', 'export it from the web package', or a lint finding says a web package may only be imported through an explicit screens/* or surfaces/* entry."
user-invocable: true
argument-hint: "<owning feature> <surface id> [consuming feature]"
---

# Publish a web surface

Read `.claude/skills/architecture-guide/references/web.md` first.

A **screen** is a whole page, and only the feature of the same id may consume it
(`ui-screen-owner`). A **surface** is any other public piece — a picker, a panel, a
store, a chart, a host provider — that a _different_ feature may mount. Everything else
in a web package is private.

## 1. Decide the id and where the code lives

The id is lower-kebab and names what the consumer mounts, not where the file sits:
`trace-filters`, `annotation-form`, `department-picker`, `dataset-table`. The export path
is the contract; the module behind it can be a `surfaces/<id>/index.ts` barrel or an
existing `ui/sections/*.tsx` or `behavior/*.ts` module.

`packages/features/trace/web/src/surfaces/trace-filters/index.ts` is the barrel idiom:

```ts
export * from "../../behavior/filter.store";
export * from "../../model/url-state";
```

## 2. Export it

`packages/features/<owner>/web/package.json`:

```json
"./surfaces/trace-view-state": {
  "types": "./src/surfaces/trace-view-state/index.ts",
  "default": "./src/surfaces/trace-view-state/index.ts"
}
```

`ui-web-public-entry` allows only `./screens/<id>` and `./surfaces/<id>` here — the id
must match `[a-z][a-z0-9]*(-[a-z0-9]+)*`. `ui-screen-closure` then walks the whole import
graph behind each export and rejects direct browser capabilities, non-literal module
specifiers, forbidden presentation imports and anything reaching outside the package.
`@langwatch/design-system` and any `*-contract` package are always allowed.

Keep the layer order behind the surface: an element or block may not import behavior; a
section may. A surface that needs data composes a section.

## 3. Declare the use

`apps/ui/src/features/catalogue.json`, on the **consuming** feature:

```json
{
  "id": "trace",
  "root": "trace",
  "uses": {
    "screens": ["@langwatch/trace-web/screens/trace"],
    "surfaces": ["@langwatch/annotation-web/surfaces/annotation-form"]
  }
}
```

- The specifier must be exact and must be an exported entry, or
  `ui-web-capability-declaration` fires on the catalogue file.
- Importing a surface a feature has not declared fires the same rule on the importing
  file. Every consumer declares its own use.
- A web package new to the application also goes in `governedWebPackages`, or
  `ui-web-package-governance` refuses the import.
- Only a named frontend feature may import a screen or surface
  (`ui-web-capability-owner`); a global layer under `apps/ui/src/ui` or
  `apps/ui/src/behavior` may not.

## 4. Mount it

The consuming feature imports the surface inside its own
`apps/ui/src/features/<consumer>/ui/sections/*`, or a section of its own web package if
the composition belongs to the package rather than the application. A surface that needs
session, project or navigation takes them as props or through the consumer's host port —
it never reads them itself.

## 5. Tests and gates

A surface is rendered by its own `.integration.test.tsx` (jsdom docblock) in the owning
package, with the scenario bound. Then:

```bash
pnpm --filter @langwatch/<owner>-web test && pnpm --filter @langwatch/<owner>-web typecheck
pnpm --filter @langwatch/ui typecheck
pnpm --filter @langwatch/architecture-lint lint
```

and the rest of `.claude/skills/architecture-guide/references/gates.md`.

## Report

The export path added, the consumers that declared it, the closure the export pulled in,
and any module that had to move layer to keep the closure clean.
