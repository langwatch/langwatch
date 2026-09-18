# Publish a browser kit

Read `dev/docs/ARCHITECTURE.md` §3.4 (the kit law) first.

A module's `*-browser` package is **closed**: nothing else ever imports it,
ever. The moment a *different* module needs a hook, store or component this
module owns, that thing moves to a new package, `<name>-browser-kit` —
sharing is declared by moving code, never observed by reaching in. This
replaces the older per-application "surfaces" catalogue: a consumer no longer
declares `uses.surfaces` on itself and reaches into another module's `web`
package; it imports the owner's **kit** package directly, like any other
workspace dependency.

## 1. Decide whether a kit is warranted

The kit law, in order:

1. **A kit exists only where sharing is real — three or more consumers.**
   One consumer is bilateral coupling, not an API: inline or duplicate the
   piece instead of creating a kit for it.
2. **A kit is a leaf.** It may import contracts (any module's),
   `@langwatch/design-system` and `@langwatch/browser-host`. It may not
   import its own module's `*-browser`, any other module's `*-browser`, or
   another kit.
3. **A kit fetches nothing.** No project-scoped queries, no
   `@langwatch/browser-trpc`. Presentational components and pure hooks and
   stores only; each consumer wires its own data (the model-selector ruling:
   the kit takes `options/value/onChange`, each consumer runs its own
   query).
4. **A kit is a package, not a subpath.** A subpath inside `*-browser` is
   invisible to the dependency graph — it cannot break a cycle or be
   budgeted. A separate package makes every cross-module browser edge a
   visible, lintable manifest line.
5. **The published tier is shrink-only.** Once something is in a kit, moving
   it back to being private is the exception, not the norm — don't publish
   speculatively hoping for a second consumer.

If you are not sure three consumers are real, say so in the report and
default to leaving the piece private; a kit created for one consumer is a
finding the next audit will raise.

## 2. Create or extend the kit package

`modules/<owner>/browser-kit/` (`@langwatch/<owner>-browser-kit`), a normal
workspace package with its own `package.json`, `tsconfig.json`,
`vitest.config.ts`. Move the component, hook or store in — do not copy it and
leave the original behind in `*-browser`; the original's importers inside the
owner's own browser package now import from the kit too, so there is exactly
one copy.

```ts
// modules/annotation/browser-kit/src/annotation-form.ts
export * from "./ui/annotation-form.tsx";
```

Keep the layer order inside the kit: a pure hook or a presentational
component only — no `behavior/` that fetches, no api binding. A piece that
needs data takes it as props (`options/value/onChange`), never as a query
result it runs itself.

## 3. Export it

`modules/<owner>/browser-kit/package.json`:

```json
"exports": {
  "./annotation-form": {
    "types": "./dist/annotation-form.d.ts",
    "default": "./src/annotation-form.ts"
  }
}
```

## 4. Consume it

The consuming module's `browser` package adds
`"@langwatch/annotation-browser-kit": "workspace:*"` and imports the flat
entry directly in its own `ui/sections/*` — a normal workspace import, no
catalogue registration step. A consumer that needs session, project or
navigation passes them as props or through its own `*HostApi`; the kit never
reads them itself.

## 5. Tests and gates

A kit component is rendered by its own `.integration.test.tsx` (jsdom
docblock) in the kit package, with the scenario bound. Then:

```bash
pnpm --filter @langwatch/<owner>-browser-kit test && pnpm --filter @langwatch/<owner>-browser-kit typecheck
pnpm --filter @langwatch/<consumer>-browser typecheck
pnpm --filter @langwatch/architecture-enforcer lint
```

`architecture-enforcer` is what checks the kit law itself (closed
`*-browser`, leaf-only imports, no fetching) — a violation there is the
finding, not a judgement call.

## Report

The kit package created or extended, the piece moved into it, the consumers
that now import it directly, and why three consumers made this real sharing
rather than a two-way coupling that should have stayed inline.
