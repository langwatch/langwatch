# Publish a web surface

Read `.claude/skills/architecture-guide/references/web.md` first.

A **screen** is a whole page, and only the module of the same id may consume it
(`ui-screen-owner`). A **surface** is any other public piece (a picker, a panel, a
store, a chart, a host provider) that a _different_ module may mount. Everything else
in a web package is private.

## 1. Decide the id and where the code lives

The id is lower-kebab and names what the consumer mounts, not where the file sits:
`annotation-card`, `annotation-chips`, `annotation-form`, `annotation-scores`. The export path
is the contract; the module behind it is a flat entry file `src/<id>.ts` that names what
the consumer may reach (the older `surfaces/<id>/index.ts` barrel is still accepted).

`modules/annotation/web/src/annotation-card.ts` is the entry idiom:

```ts
export * from "./ui/blocks/annotation-card.tsx";
```

and `annotations.ts` in the same package shows an entry that publishes a screen loader,
the api binding, the host port and a few hooks together.

## 2. Export it

`modules/<owner>/web/package.json`:

```json
"./annotation-card": {
  "langwatch-declaration-source": "./src/annotation-card.ts",
  "types": "./dist/annotation-card.d.ts",
  "default": "./src/annotation-card.ts"
}
```

`ui-web-public-entry` allows a flat `./<id>` only when the catalogue declares it (step 3),
plus the older `./screens/<id>` and `./surfaces/<id>`; the id must match
`[a-z][a-z0-9]*(-[a-z0-9]+)*`. `ui-screen-closure` then walks the whole import
graph behind each export and rejects direct browser capabilities, non-literal module
specifiers, forbidden presentation imports and anything reaching outside the package.
`@langwatch/design-system` and any `*-contract` package are always allowed.

Keep the layer order behind the surface: an element or block may not import behavior; a
section may. A surface that needs data composes a section.

## 3. Declare the use

`apps/ui/src/features/catalogue.json`, on the **consuming** module:

```json
{
  "id": "trace",
  "root": "trace",
  "uses": {
    "screens": ["@langwatch/trace-web/screens/traces"],
    "surfaces": ["@langwatch/annotation-web/annotation-form"]
  }
}
```

- The specifier must be exact and must be an exported entry, or
  `ui-web-capability-declaration` fires on the catalogue file.
- Importing a surface a module has not declared fires the same rule on the importing
  file. Every consumer declares its own use.
- A web package new to the application also goes in `governedWebPackages`, or
  `ui-web-package-governance` refuses the import.
- Only a named frontend module may import a screen or surface
  (`ui-web-capability-owner`); a global layer under `apps/ui/src/ui` or
  `apps/ui/src/behavior` may not.

## 4. Mount it

The consuming module imports the surface inside its own
`apps/ui/src/features/<consumer>/ui/sections/*`, or a section of its own web package if
the composition belongs to the package rather than the application. A surface that needs
session, project or navigation takes them as props or through the consumer's host port;
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
