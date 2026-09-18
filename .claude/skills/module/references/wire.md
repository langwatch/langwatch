# Wire a module into the processes

Read `dev/docs/ARCHITECTURE.md` §4 and §5. Wiring is catalogue-driven and the
process root does not grow — a change that needs `main.ts` to grow has found a
gap in the primitives; report the gap, never widen the root.

## Process halves (api, worker, tasks)

1. The module's `index.ts` exports its installer
   (`defineProcessModule("<f>")...` — record §3.2).
2. Add or confirm the module's entry in `modules/catalogue.json`.
3. `pnpm generate:modules` regenerates `@langwatch/installed-modules`; every
   process that boots `processModules` now installs it (record §5). No
   process file changes; a root that needs editing means a gap in the
   primitives — report it, never widen the root.
4. What the module needs arrives through the ruled chain (record §3.3): a
   peer by `*Api` token in `static dependencies`; a deployment fact through
   the module's declared config schema, sliced by `.withConfig` (record §6);
   storage through the one `.withStores(stores)` call — never a per-store
   `with*` call (record §15); an availability decision through a declared
   supply token the process answers with `.provide({...})`. If a requirement
   is not supplied, `boot()` does not compile and `MissingSupply<...>` names
   it.

## Browser halves

The browser boot target is `@langwatch/browser` (`createUi`,
`defineBrowserModule` — record §10). A browser module declares its screens,
drawers, publications, mounts and flags in one file exported at
`./declaration`; browser modules are generated into
`@langwatch/installed-modules` the same way `processModules` are, and
`createUi({ mount }).withModules(browserModules).render()` installs the
whole set before any component renders. Do not deepen an older per-module
"uses" registration in `apps/ui`'s own catalogue — that mechanism is
superseded by the kit law (`references/web-surface.md`) for cross-module
sharing, and by the module's own `./declaration` for everything the module
owns.

## Verify

- `pnpm --filter <the-module-process> typecheck` and its tests.
- `pnpm --filter @langwatch/platform-api typecheck` — a missing supply
  surfaces HERE, as a compile refusal naming the module and requirement.
