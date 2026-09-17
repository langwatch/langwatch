# Wire a module into the processes

Rewritten 2026-09-17; the earlier per-process composition recipe
(`installApi<F>`, `apps/api/src/features/<f>/<f>.composition.ts`) is deleted
along with those directories. Wiring is now catalogue-driven and the
composition root does not grow.

## Server halves (api, worker, tasks)

1. The module's `index.ts` exports its installer
   (`defineServerModule("<f>")...`) - see `architecture-guide`.
2. Add or confirm the module's entry in `modules/catalogue.json`.
3. `pnpm generate:modules` regenerates `@langwatch/installed-modules/server`;
   every process that boots `serverModules` now installs it. No process file
   changes; a root that needs editing means a gap in the primitives - report
   it, never widen the root.
4. What the module needs arrives through the ruled chain: config as a slice
   keyed by module name (declare a config schema in the contract), storage
   through the closed vocabulary (`relational`, `analytical`, `keyvalue`, ...),
   peers by `*Api` token in `static dependencies`. If a requirement is not
   supplied, `boot()` does not compile and `MissingSupply<...>` names it.

## Web halves

The browser boot target is `@langwatch/ui-kernel` (`createUi`,
`defineWebModule`); web modules are generated into
`@langwatch/installed-modules` the same way. Do not deepen the older
`uiFeature`/`WebInstallation` generations.

## Verify

- `pnpm --filter <the-module-server> typecheck` and its tests.
- `pnpm --filter @langwatch/platform-api typecheck` - a missing supply
  surfaces HERE, as a compile refusal naming the module and requirement.
