# Module-level hot reload for the api process (spike)

Run via `pnpm --filter @langwatch/dev-runtime dev:hot`. Default dev path
(`backend.entrypoint.ts` + `dev-supervisor.mjs --watch`) is untouched.

## Design

`backend.hot.ts` owns one `http.Server` for the process's life, never
rebinds it, and never touches the worker half - only the api's composition
entry (`api.executable.ts`'s `startApiExecutable`, composed by
`app/api-standalone.composition.ts`). Two inner ports alternate: Vite's
`ModuleRunner` (`createServerModuleRunner`, middleware-mode, `server.hmr:
true`) re-imports the composition entry on the *other* port; once the new
`ApiRuntimeBootstrap.start()` resolves, the host swaps its front-proxy
target, then closes the previous lifecycle (`runtime.close()`) - no gap.
Front server: plain `node:http` reverse proxy, app-shape-agnostic.
`ssr.external: true` routes every `node_modules` import (pnpm-linked
workspace packages included) through Node's own `import()` cache, so only
`apps/api/src/**` is invalidated by an edit.

## Measurements
Both paths hit a pre-existing defect on this branch before infra matters
(`modules/api-key/server`, `enterprise/modules/billing/server` re-export
deleted files), so neither reaches a live `/api/health` 200 here. Numbers
are **time to next boot-attempt outcome** at the same import edge, not
readiness - but comparable work, so the delta is real.

| path | pays for | n | median |
| --- | --- | --- | --- |
| today: cold spawn | process spawn + native type-strip of the whole worker+api graph | 5 | 2.57s (2.45-3.67s) |
| hot: module runner | 750ms debounce + Vite re-walking only `apps/api/src/**` | 5 | 0.82s (0.13-0.88s) |

Debounce dominates the hot number - runner work itself is ~50-125ms. Cold
excludes debounce, SIGTERM-wait-SIGKILL and a real DB/Redis/ClickHouse
handshake (land on "today" only), so a healthy boot's gap is larger than
shown. Repro: touch `.../api-key/api-key-rest.mount.ts`, watch `[dev-hot]`.

## What breaks
- Pre-existing: `api-key`/`billing` name deleted files, fail identically
  under plain Node and the runner (concurrent-lane churn), not caused here.
- **Module-scope singleton breaks re-import**: identity's metrics adapter
  registers a `prom-client` `Counter` at import time with no
  re-registration guard, and was *not* externalised (next point), so a
  reload threw "metric already registered".
- **`ssr.external: true` did not fully hold.** Workspace packages showed up
  inside Vite's graph rather than Node's `import()`, likely because they
  are TypeScript-source-only (no `dist`): Vite keeps walking the tree once
  it follows one relative import inside such a package. Needs a built
  `dist` entry per package, or an explicit externalisation list + lint rule.
- **Prisma client survival**: unverified end-to-end (blocked above); its
  construction site is workspace-package source, so per the point above it
  is not guaranteed excluded from Vite's graph without the same fix.
- Workers/schedulers restart wholesale with the composition (in-memory job
  state lost every reload); no upgrade/WebSocket proxying or drain-grace
  parity with `ApiHttpListener`/`installApiSignalHandlers`.

## Unfinished
1. No live 2xx measurement - blocked by pre-existing missing exports.
2. `ssr.external: true` needs a boundary holding for source-only workspace
   packages before Prisma/Redis/ClickHouse survival can be trusted or verified.
