# Install and composition review: platform-api-*, runtime-composition, enterprise-web, apps/ui features

**Written:** 2026-09-03. **Audited:** 2026-09-03 against the working tree.
**Status:** sections A and B landed in `268eb2ed83`. What is left is the
api-map lane (§5), which is blocked on the tRPC flatten's steps C and D.

## Landed — `268eb2ed83` "Fold the UI host adapters and retire the platform-api glue packages"

- **`platform-api-contract` deleted**, with the dead workflow transport:
  `workflow/web/src/behavior/workflow-api.tsx`,
  `model/trpc-transport.ts` and `model/sse-link.ts` are gone and the
  `./utils/workflow-api` export points at the live `.ts` twin.
- **`platform-api-client` pruned to what only it can hold.**
  `asFeatureApiClient` is deleted (zero consumers anywhere), and
  `sse-subscription-link.ts` moved to
  `apps/ui/src/behavior/ui-sse-subscription-link.ts`.
- **`runtime-composition` pruned to `ResourceScope`** — `src/` is
  `index.ts` + `resource-scope.ts`. The gateway `FeatureDefinition` wrapper and
  `GatewayRealtimeSessionReconciliationWorker` were deleted with it, which
  settled the worker-lane question in §5 ("should this run at all") as _no_.
- **`enterprise-web` deleted**, with the lint's `"web"` composition role;
  `packages/enterprise/composition/` is `api` + `worker`.
- **apps/ui: the fold and the page helper.** All 36
  `behavior/*host.adapter.ts` files are gone (the finder returns zero), every
  provider builds a typed object literal, `apps/ui/src/ui/sections/ui-page.tsx`
  is the one page helper, `installed-ui-page-keys.ts` is deleted and
  `mergeUiFeatureInstalls` is gone from `installed-ui-features.ts`.
- `catalogue.json` unchanged, as the review asked.

## Open — the api-map lane

The one section this review deliberately handed elsewhere, and the only one
still outstanding. Blocked on `trpc-flatten-review.md` steps C and D: until
`AppRouter` carries a real type, a web package cannot type its hooks off it.

Current measurements:

- **39** `createFeatureApi<` sites across `packages/features/*/web`
  (`grep -rl "createFeatureApi<" packages`), each to be replaced by
  `export const xApi = trpcReact;` the way
  `secret/web/src/behavior/secret-api.ts` already does (`98651085d8` is the
  reference).
- `packages/platform-api-client/src/` still holds `feature-api.ts`,
  `trpc-query-key.ts` and `use-invalidate-procedure.ts` beside
  `app-router-client.ts`. When the maps go: delete `feature-api.ts` and
  `use-invalidate-procedure.ts` (its two consumers,
  `trace/web/src/ui/sections/internal/use-rename-trace.ts` and
  `analytics/web/src/behavior/analytics-api.ts`, switch to
  `trpcReact.useUtils()`), and `git mv src/trpc-query-key.ts
apps/ui/src/behavior/ui-trpc-query-key.ts` with its test (consumers:
  `ui-rpc.ts`, `ui-session-queries.ts`, `ui-organization-facts.ts`). The
  package is then `app-router-client.ts` alone.
- In apps/ui: with one `trpcReact` instance, the 36 `uiFeatureApi(...)`
  bindings, `UiFeatureInstall.apis`, the `apis` array in
  `installed-ui-features.ts` and the `reduceRight` at
  `ui-feature-shell.tsx` collapse to one `trpcReact.Provider` mount; each
  `features/<f>/index.ts` shrinks to its loaders (and drawers) export; the
  37-name literal in `installed-ui-features.unit.test.ts` deletes.
- `dev/docs/best_practices/feature-web-data-access.md` is rewritten around
  `trpcReact` at that point, closing its §"Drift" and §"Follow-ups".

## Open — the speculative host seam that is left

`UiApplicationInstall.pages.loaders` and `mergeUiPageLoaders`
(`apps/ui/src/behavior/ui-feature-loaders.ts:40`, used by
`ui/sections/ui-application.tsx` and re-exported from `src/index.ts:40`) are
the same shape `mergeUiFeatureInstalls` was, and `ui.entrypoint.tsx` passes
`loaders: {}`. Deleting them changes the global `ui/sections` layer and its
tests (`ui-application.unit.test.tsx`, `ui-feature-loaders.unit.test.ts`).
Small, independent, worth doing now that the merge it mirrored is gone.

## Resume point

Do nothing here until step D of `trpc-flatten-review.md` lands. Then the
api-map lane is one fan-out over the 39 sites plus the three
`platform-api-client` file moves above, and `mergeUiPageLoaders` is a small
change that can go at any time.
