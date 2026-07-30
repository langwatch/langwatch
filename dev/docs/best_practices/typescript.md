# TypeScript

- **Exhaustive switches**: Always include `never` check in default case
- **Zod for shared types**: Define once, `infer` the TS type
- **Single export per file**: Thin files, single responsibility
- **Colocate interfaces**: Only extract to `types.ts` when shared across files
- **Service wrappers**: Use `get` keyword for repository passthrough, not `bind`
- **Named parameters over positional**: For functions with 2+ parameters, prefer object destructuring. Makes call sites self-documenting and parameter order irrelevant.

  ```typescript
  // Bad: positional parameters
  runScenario(scenarioId, target, setId)

  // Good: named parameters via object destructuring
  runScenario({ scenarioId, target, setId })
  ```

## Compiled schema validation: build-time in the bundle, runtime in workers

`zod-compiler` (ADR-099) compiles exported zod schemas into generated
validation code. Which path a given process takes depends entirely on whether
that process is bundled:

- **The Vite-built browser/SSR bundle** (`langwatch/vite.config.ts`) runs the
  `zod-compiler/vite` plugin, so `schemas` wrapped in `compile()` compile at
  build time. Configured with `schemas: "explicit"` and a narrow `include`, so
  the plugin only executes files that literally import `compile()` — never a
  blanket scan of every zod-importing file.
- **Workers, and everything else started with `tsx`** (`start:workers`,
  `start:app`, scripts) never pass through a bundler, so no build plugin can
  ever apply there. `compileSchema` (`packages/event-sourcing/src/schema/compiled.ts`)
  falls back to zod-compiler's runtime `compile()`, which is the only path
  those processes get.

The seam is `compileSchema`, not a direct `zod-compiler` import: call sites
never need to know which backend is live. It must keep compiling **lazily on
first use and memoising** — this codebase has already lost a worker's cold
start to a boot-time module-load cost once (the OTel plugin's 14–28s load),
and eager compilation at import time would reintroduce that class of bug in
every process, bundled or not.
