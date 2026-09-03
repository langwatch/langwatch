# Install and composition review: platform-api-*, runtime-composition, enterprise-web, apps/ui features

**Written:** 2026-09-03 on `feat/strict-feature-layout-v0`, read-only. **Status:** decision doc plus an executable work list. Nothing here has been applied. Measurements are `grep -rl` file counts excluding `node_modules`, `__tests__` and the package's own source unless stated.

## The direct answer

> did i not ask for platform-api-* packages to be removed? do we need them still? can it not be handled by the api app itself?

- **`platform-api-contract`: delete now.** Its only importer is `packages/features/workflow/web/src/behavior/workflow-api.tsx`, which is dead code shadowed by a `.ts` twin (details in §2). Nothing needs to move into `workflow/contract`; the three zod schemas it holds are already declared on the server side.
- **`platform-api-client`: cannot reach zero, can reach one file.** `apps/api` already owns the only thing that matters, the router TYPE (`apps/api/src/app-trpc/app-trpc.types.ts`, exported as `@langwatch/platform-api/app-trpc/types`, `import type` only). What `apps/api` cannot own is the one browser VALUE built from it, `createTRPCReact<AppRouter>()`: it is React, and the frontend-boundary test refuses React in the api's value graph. `apps/ui` cannot own it either, because 34 feature web packages import it and a package may not depend on an application. So `trpcReact` stays as the sole content of the package. Everything else in it is either apps/ui-only glue that belongs in `apps/ui/src/behavior` (`sseSubscriptionLink`), dead (`asFeatureApiClient`, 0 consumers), or the api-map machinery the fan-out lane deletes (`createFeatureApi`, `FeatureApiMap`, `ProcedureShape`, `RouterFromMap`, `FeatureApiClient`, `useInvalidateProcedure`, `trpcQueryKey`).
- **`runtime-composition`: prune to `ResourceScope`.** 40 of 906 lines are used. `RuntimeBoot`, `CapabilityRegistry`, `FeatureRuntimeBuilder` have zero process consumers; one gateway adapter wraps a worker in a `FeatureDefinition` that no process ever builds.
- **`enterprise-web`: delete.** 21 lines, one value-echo test, zero importers outside the lint's own role table.
- **apps/ui features: keep the folder shape, delete the two layers that only forward.** 36 host adapters are 4,375 lines in which 353 of 375 methods are `return this.readings.x` or `this.actions.x(...)`. 36 route files and 35 `withXHost` HOCs repeat one skeleton. `installed-ui-features.ts`, `installed-ui-drawers.ts` and `catalogue.json` are the composition root and the lint's input; they stay.

One thing to record: `trpcReact` typed off `ApiApplication["trpc"]` is exactly the "whole-router inference" ADR-111 §"Portable browser contracts" calls a migration seam to be removed. It landed anyway (`98651085d8`), it is the right call now that `apps/api` owns the root, and the ADR needs the amendment in step A1.6.

## 1. Inventory and verdicts

| Package or layer | What it is | Consumers | Can `apps/api` or the feature own it? | Verdict |
| --- | --- | --- | --- | --- |
| `packages/platform-api-contract` (78 src lines) | `WorkflowApiRouter`: a hand-typed `TRPCBuiltRouter` for 3 workflow procedures, self-described "temporary" | 1 file: `workflow/web/src/behavior/workflow-api.tsx` (dead, see §2) + a stale comment in `trace/contract/src/trace-explorer.contract.ts:11` | Already does: the procedures are mounted by `@langwatch/workflow-server` on the real root | **Delete** (no move) |
| `packages/platform-api-client/src/app-router-client.ts` | `trpcReact = createTRPCReact<AppRouter>()` | 2 today (`apps/ui/src/behavior/ui-feature-transport.ts`, `secret/web`); 34 web packages after the api-map lane | Type: yes, `apps/api` already owns it. Value: no, React cannot live in a Node app and packages cannot import `apps/ui` | **Keep** as the package's only file |
| `platform-api-client/src/feature-api.ts` | `createFeatureApi`, `FeatureApiMap`, `ProcedureShape`, `RouterFromMap`, `FeatureApiClient`, `asFeatureApiClient` | `createFeatureApi` 36 packages; `RouterFromMap` 2; `FeatureApiClient` 1 (+1 test); `asFeatureApiClient` **0** | Superseded by `trpcReact` | **Delete `asFeatureApiClient` now; rest deleted by the api-map lane** |
| `platform-api-client/src/sse-subscription-link.ts` (250 lines + 1 test) | The SSE tRPC link | 1: `apps/ui/src/behavior/ui-feature-transport.ts` | `apps/ui` owns the transport; this is its link | **Move to `apps/ui/src/behavior/ui-sse-subscription-link.ts`** |
| `platform-api-client/src/trpc-query-key.ts`, `use-invalidate-procedure.ts` | Path-string cache keys; the invalidation escape hatch for undeclared procedures | `trpcQueryKey`: 3 apps/ui files + 1 test; `useInvalidateProcedure`: `trace/web` (1) | `useInvalidateProcedure` exists only because maps are partial; `trpcReact.useUtils()` replaces it. `trpcQueryKey` stays needed by `apps/ui/src/behavior/ui-rpc.ts` (by-name dispatch) | **Leave for the api-map lane**: delete the hook, move `trpcQueryKey` to `apps/ui/src/behavior/ui-trpc-query-key.ts` |
| `packages/runtime-composition` (906 lines) | `ResourceScope` (40), `Capability`/`CapabilityRegistry` (77), `FeatureDefinition`/`FeatureRuntimeBuilder` (193), `RuntimeBoot` (123) | `ResourceScope`: 39 files across api, worker, gateway test. `Capability`+`FeatureDefinition`: 1 file, `gateway/server/src/adapters/gateway-realtime-session-reconciliation.adapter.ts`, which no process imports. `RuntimeBoot`, `CapabilityRegistry`: **0** | The apps compose by hand (`api-production.composition.ts`); the registry was never adopted | **Prune to `ResourceScope`**; delete the gateway `FeatureDefinition` wrapper |
| `packages/enterprise/composition/web` (`@langwatch/enterprise-web`, 21 lines) | `EnterpriseWebComposition.create()` holding an `EnterpriseCatalogue` and an optional license status | **0** importers. Named only in `architecture-lint/src/workspace.ts:34` and the boundaries test fixture | Nothing to own: browser enterprise screens are mounted by `apps/ui/src/features/{billing,governance,licensing,scim}` directly | **Delete**, with the lint's `"web"` composition role |
| `apps/ui/src/features/*/behavior/*host.adapter.ts` (36 files, 4,375 lines) | `class UiXHost extends XHostPort` over a `{readings, actions}` pair | The sibling host provider, and 12 tests in `apps/ui/tests` | The provider already holds every value; the port is an all-abstract class with no private members, so an object literal satisfies it | **Fold into the provider**; move the 22 methods with real logic to plain functions in `behavior/` |
| `apps/ui/src/features/*/ui/sections/*host-provider.tsx` (36 files, 4,641 lines) | Reads capabilities and queries, builds the host, exports a `withXHost` HOC (35 identical 8-line copies) | The sibling routes file | Keep: this is where the application's reads live | **Keep the component, delete the HOC** (the page helper wraps) |
| `apps/ui/src/features/*/ui/sections/*-routes.tsx` (38 files, 2,393 lines) | `FALLBACKS` (33 copies) + `withUiPageGuard` (44) + layout + host, per key | `installed-ui-features.ts`; route tests | Keep the per-feature table | **One `uiPage()` helper**, all files or none (option I) |
| `apps/ui/src/features/installed-ui-features.ts` (168) | The loader registry and the 36 api bindings; `mergeUiFeatureInstalls` | `installed-ui-features.composition.ts`, `installed-ui-page-keys.ts`, `apps/ui/src/index.ts`, 2 tests | It is the composition root | **Keep the lists; delete `mergeUiFeatureInstalls`** (no host ever passes `features`; `ui.entrypoint.tsx:101` passes none). `apis` deletes with the api-map lane |
| `apps/ui/src/features/installed-ui-page-keys.ts` (23) | `isUiInstalledPage`: "is this page served here or by platform/app" | 1: `chrome/ui/sections/ui-app-chrome.tsx:95`, 3 tests mock it | platform/app is deleted; every routed key is installed | **Delete**; `servedHere = page !== void 0` |
| `apps/ui/src/features/installed-ui-drawers.ts` (94) | The drawer registry, the trace-drawer rewrite, preloader | chrome, screens, 2 tests | Composition root | **Keep** |
| `apps/ui/src/features/catalogue.json` (452) | `governedWebPackages` allowlist + 40 feature roots with declared `uses` | `architecture-lint/src/frontend-ui-boundaries.ts` (both directions checked: declared root must exist, every root must be declared, every `@langwatch/*-web` import must be in `uses`) | Lint input | **Keep** |

## 2. Findings that change the plan

**`workflow-api.tsx` is dead, and its package export is live.** `packages/features/workflow/web/src/behavior/` holds both `workflow-api.ts` (511 lines, the `WorkflowApiMap` + `createFeatureApi` instance every in-package hook imports as `../workflow-api`, which resolves to `.ts` first) and `workflow-api.tsx` (28 lines: a second `createTRPCReact<WorkflowApiRouter>()` instance plus a `WorkflowApiProvider` that nothing mounts). `package.json:273` exports `./utils/workflow-api` pointing at the **`.tsx`**, and `packages/features/scenario/web` imports `workflowApi` through that subpath in `behavior/agents/use-workflow-target-agent-data.ts:7` and `ui/sections/agents/agent-workflow-editor-drawer.tsx:40`. Those two files therefore call hooks on a tRPC instance whose Provider is never mounted. Repointing the export to `./src/behavior/workflow-api.ts` puts them on the instance `apps/ui` mounts (`workflowApiBinding`). With the `.tsx` gone, `model/trpc-transport.ts` (78 lines, reads `process.env.BASE_HOST` from a web package, builds a WebSocket client and a `loggerLink`) and `model/sse-link.ts` (235 lines, a second copy of the SSE link) have no importer either. That is 341 lines of a second browser transport inside a feature package, which ADR-101 forbids outright.

**The gateway reconciliation worker is not wired.** `createGatewayRealtimeSessionReconciliationFeature` and `GatewayRealtimeSessionReconciliationWorker` are imported by nothing under `apps/`. The `FeatureDefinition` wrapper adds nothing the service does not already expose (`create(infrastructure)` + `start()` returning a handle with `stop()`); the worker composition that eventually mounts it wants exactly those two calls and a `resources.own(...)`. Wiring it is a worker-lane decision and is listed in §5, not here.

**The adapter layer forwards.** Per-file classification (methods / trivial forwarders): topic 3/3, scim 4/4, notification 4/4, authz 5/5, auth 3/3, data-privacy 5/5, github 6/6, annotation-scores 7/7, licensing 7/7, secret 5/5, project 9/9, data-retention 9/9, analytics 8/7, home 11/11, billing 10/10, ops 10/10, governance 12/11, workflows 9/8, monitor 9/8, annotation 11/10, dataset 10/8, traces 12/11, evaluator 8/7, simulations 12/11, langy 14/12, agent 10/10 (+`openAgentEditor`), automations 14/14, authorize 11/10, model-provider 8/8, onboarding 14/13, gateway 15/13, personal-workspace 20/18, organization 19/19, prompt 13/11, navigation 31/29, api-key 17/17 (+`copyToClipboard`, `recordLeadSourceIfAbsent`, `openPlatformDrawer`). Twenty-two methods compose something; every one of them composes from `readings`/`actions` values, so each becomes a plain function taking those values.

**Two tests are pure value echo.** `apps/ui/tests/dataset-host.adapter.unit.test.ts` ("answers with the project, targets and address it was handed", "passes each notice straight through") and the forwarding halves of `authz-host.adapter.unit.test.ts` assert constants back at themselves. They delete with the classes. The tests that exercise logic (agent drawer address, api-key clipboard and lead source, governance organization lookup, gateway, model-provider, prompt, personal-workspace, automation, data-governance, annotation) re-target the extracted functions.

**`installed-ui-features.unit.test.ts:510` echoes a 37-name literal.** It pins the `apis` order by hand. It goes with `apis` in the api-map lane; do not extend it.

## 3. Target shape

```
BEFORE                                                AFTER

packages/platform-api-contract  ─── WorkflowApiRouter ──▶ (deleted)
packages/platform-api-client                          packages/platform-api-client
  app-router-client.ts   trpcReact                      app-router-client.ts   trpcReact   ◀── the whole package
  feature-api.ts         createFeatureApi, maps, cast   (feature-api.ts, trpc-query-key.ts,
  sse-subscription-link.ts                               use-invalidate-procedure.ts: deleted
  trpc-query-key.ts                                      by the api-map lane)
  use-invalidate-procedure.ts
                                                      apps/ui/src/behavior/
                                                        ui-sse-subscription-link.ts   (moved)
                                                        ui-trpc-query-key.ts          (api-map lane)

packages/runtime-composition                          packages/runtime-composition
  resource-scope.ts  capability.ts                      resource-scope.ts             ◀── the whole package
  feature-runtime.ts runtime-boot.ts

packages/enterprise/composition/{api,worker,web}      packages/enterprise/composition/{api,worker}

apps/ui/src/features/<f>/                             apps/ui/src/features/<f>/
  index.ts             binding + loaders                index.ts             loaders (+ drawers)
  behavior/<f>-host.adapter.ts   class UiXHost          behavior/<f>-*.ts    only the functions that compute
  ui/sections/<f>-host-provider.tsx  reads + HOC        ui/sections/<f>-host.tsx   reads → object literal
  ui/sections/<f>-routes.tsx     FALLBACKS+guard+…      ui/sections/<f>-routes.tsx  uiPage({...}) per key
```

The page helper, in full. It is the only new code this plan adds.

```ts
// apps/ui/src/ui/sections/ui-page.tsx
export type UiPageInstall = {
  screen: () => Promise<{ default: ComponentType }>;
  host?: ComponentType<{ children: ReactNode }>;
  settingsLayout?: boolean;
  permission?: string;
  flags?: readonly string[];
};

export function uiPage({ screen, host, settingsLayout = false, permission, flags }: UiPageInstall): UiPageLoader {
  return async () => {
    const module = await screen();
    const guarded = withUiPageGuard({ permission, flags, fallbacks: UI_PAGE_FALLBACKS })(module.default);
    const framed = settingsLayout ? withUiSettingsLayout(guarded) : guarded;
    return { default: host ? withHost(host, framed) : framed };
  };
}
```

Wrapping order is the one every route file documents today: host outermost, settings chrome, guard innermost. `UI_PAGE_FALLBACKS` is the one copy of the `{ loading: UiPageLoading, notFound: UiPageNotFound, forbidden: UiPageForbidden }` object, declared next to the helper. `withHost(Host, Page)` is the current `withXHost` body once, with `displayName` set from both names. A feature-specific decorator (`withDocumentTitle`, `withTokenFromAddress`, `withReturnToRedirect`, the ops `resource` prop) wraps inside `screen`: `screen: async () => ({ default: withDocumentTitle(TITLE, (await authorizeScreens.cliAuth()).default) })`. Screens whose default export takes props (the 33 `module.default as ComponentType` casts) are cast in the same place, once per screen rather than once per key.

A host, after the fold. The class, the `Readings`/`Actions` pair and `static create` are gone; the port is satisfied structurally.

```tsx
// apps/ui/src/features/secret/ui/sections/secret-host.tsx
export function SecretHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const activeScope = session.activeScope();
  const host = useMemo<SecretHostPort>(
    () => ({
      scope: () => ({ projectId: activeScope.projectId ?? void 0, projectName: void 0 }),
      hasPermission: (permission) => session.hasPermission(permission),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
      projectSwitcher: () => <UiProjectSwitcher />,
    }),
    [activeScope.projectId, session, feedback],
  );
  return <SecretHostProvider value={host}>{children}</SecretHostProvider>;
}
```

The 37 `abstract class XHostPort` declarations in the web packages have no private or protected members (checked), so no web package changes.

## 4. Work list, in order

Each step is independent of the ones after it unless it says otherwise. Do a whole step or none of it. No re-exports, no shims, no `as unknown as`, no comment that narrates the change. Every removed export gets its importers repointed, never a forwarding line.

### A. Package deletions and prunes

**A1. `platform-api-contract` and the dead workflow transport.**
1. `packages/features/workflow/web/package.json`: change `"./utils/workflow-api"` (lines 273-276) to point `types` and `default` at `./src/behavior/workflow-api.ts`. Remove `"@langwatch/platform-api-contract"`. Then grep `from "@trpc/` in `packages/features/workflow/web/src` excluding `__tests__`: `behavior/trpc-error.ts` and `behavior/optimization_studio/use-get-dataset-data.ts` still import `@trpc/client`, so `@trpc/client` stays; remove `@trpc/server` and `@trpc/react-query` only if nothing outside the files deleted below imports them (`workflow-api.ts` imports from `@langwatch/platform-api-client`, not `@trpc/react-query`; verify).
2. `git rm packages/features/workflow/web/src/behavior/workflow-api.tsx packages/features/workflow/web/src/model/trpc-transport.ts packages/features/workflow/web/src/model/sse-link.ts`. `packages/features/workflow/web/src/model/sse/` (`errors.ts`, `fetch-sse.ts`) is imported by `ui/sections/optimization_studio/use-post-event.tsx`, not by `sse-link.ts`; leave it.
3. `git rm -r packages/platform-api-contract`.
4. `packages/platform-api-client/package.json`: remove `"@langwatch/platform-api-contract"` (declared, never imported).
5. `packages/features/trace/contract/src/trace-explorer.contract.ts:8-12`: the docblock names `@langwatch/platform-api-contract`; rewrite the sentence to say the web package types its hooks against the router `apps/api` exports.
6. `dev/docs/adr/111-physical-application-workspaces.md:258-270`: replace the temporary-contract paragraph with one sentence: the package was deleted on 2026-09-03 after its last legacy procedure moved; the browser types its client from `@langwatch/platform-api/app-trpc/types`, which supersedes the "whole-router inference is a migration seam" clause.
7. `pnpm install` from the root (lockfile), then `pnpm --filter @langwatch/workflow-web test` and `pnpm --filter @langwatch/scenario-web test`.

**A2. `platform-api-client`: delete the dead cast, move the SSE link.**
1. `git mv packages/platform-api-client/src/sse-subscription-link.ts apps/ui/src/behavior/ui-sse-subscription-link.ts` and `git mv packages/platform-api-client/tests/sse-subscription-link.unit.test.ts apps/ui/tests/ui-sse-subscription-link.unit.test.ts`; fix the test's import path. Keep the exported names (`sseSubscriptionLink`, `classifySseFrame`, `SseEventSourceConstructor`, the two constants, the option/handler types).
2. `apps/ui/src/behavior/ui-feature-transport.ts:43-49`: import `sseSubscriptionLink` and `SseEventSourceConstructor` from `./ui-sse-subscription-link`. Check `apps/ui/tests/ui-feature-transport-subscriptions.unit.test.ts` for a `classifySseFrame` or constants import and repoint it.
3. `packages/platform-api-client/src/feature-api.ts`: delete `asFeatureApiClient` (the function and its docblock, lines 116-140). Delete its `index.ts` line.
4. `packages/platform-api-client/src/index.ts`: remove the whole `./sse-subscription-link` export block.
5. `apps/ui/package.json` declares `@trpc/client` but not `@trpc/server`; the moved file imports `@trpc/server/observable`, so add `"@trpc/server": "11.18.0"` to `apps/ui` dependencies (pinned like the other two).
6. `dev/docs/best_practices/feature-web-data-access.md`: §"The mounting, once, in the shell" (lines 134-165) describes `asFeatureApiClient`; rewrite to the actual shell (`ui-feature-shell.tsx:114-118`: one untyped client passed to every binding's Provider, no cast). Lines 56-131 describe the map pattern; leave that to the api-map lane, but add a one-paragraph "Where this is going" at the top of §"Where a browser component gets its typed client" saying the shared `trpcReact` (see `secret/web/src/behavior/secret-api.ts`) replaces the maps and the doc will be rewritten when the fan-out lands.
7. `pnpm --filter @langwatch/platform-api-client test:unit`, `pnpm --filter @langwatch/ui test tests/ui-sse-subscription-link.unit.test.ts tests/ui-feature-transport.unit.test.ts tests/ui-feature-transport-subscriptions.unit.test.ts`.

**A3. `runtime-composition` to `ResourceScope`.**
1. `git rm packages/runtime-composition/src/capability.ts src/feature-runtime.ts src/runtime-boot.ts tests/feature-runtime.unit.test.ts tests/runtime-boot.unit.test.ts` (paths under the package).
2. `src/index.ts` becomes the single line `export { type ResourceCloser, ResourceScope } from "./resource-scope";`.
3. `package.json` description: "Ordered ownership of process resources, closed once in reverse order." `README.md`: three sentences saying what `ResourceScope` does and who uses it; drop the capability-graph paragraphs and the ADR-102 framing.
4. Gateway: `git rm packages/features/gateway/server/src/adapters/gateway-realtime-session-reconciliation.adapter.ts`. In `adapters/realtime-session-reconciliation.adapter.ts` delete the two export statements that name it (lines 7-11). In `adapters/__tests__/realtime-session-reconciliation.worker.unit.test.ts` delete the `FeatureRuntimeBuilder, ResourceScope` import, the `createGatewayRealtimeSessionReconciliationFeature` / `GatewayRealtimeSessionReconciliationInfrastructure` imports, and the last test ("does not schedule a timer until the worker feature is built", lines 117-144). If that was the only test proving `start()` does not poll before being called, replace it with one that calls `GatewayRealtimeSessionReconciliationWorker.create(...)`, asserts `expireStaleSessions` was not called, then `start().stop()`. Remove `@langwatch/runtime-composition` from `packages/features/gateway/server/package.json`.
5. `specs/dependencies/runtime-composition.feature`: scenarios at lines 10, 18, 25, 32, 39, 45 describe the capability registry and are bound to the deleted tests; delete those six scenarios. Keep "Combined shutdown drains work before closing shared clients" (bound in `resource-scope.unit.test.ts`) and the configuration scenarios. Run `check-feature-parity.ts` against the file afterwards; it must not report a scenario bound to a test that no longer exists.
6. `dev/docs/adr/102-runtime-composition-roots.md`: add an "Amendment 2026-09-03" section of at most six lines: the capability registry, feature definitions and `RuntimeBoot` were never adopted by either process (both compose by hand in `*-production.composition.ts`) and were deleted; `ResourceScope` is what remains of the package.
7. `pnpm --filter @langwatch/runtime-composition test`, `pnpm --filter @langwatch/gateway-server test`.

**A4. `enterprise-web`.**
1. `git rm -r packages/enterprise/composition/web`.
2. `packages/architecture-lint/src/types.ts:5`: `EnterpriseCompositionRole = "api" | "worker"`.
3. `packages/architecture-lint/src/workspace.ts:34`: delete the `web` entry.
4. `packages/architecture-lint/src/manifests.ts:29-55` and `src/application-boundaries.ts:227-247`: delete the `role === "web"` / `applicationRole === "ui"` branches. After the deletion `compatibleEnterprise*Target` is `contract || (enterprise && feature && kind === "server")` and `matchingEnterpriseComposition` is `importer.applicationRole === target.enterpriseCompositionRole` with the application-kind guard kept. The `allowed` strings at `manifests.ts:173-175` and `application-boundaries.ts:316-318` lose their ternary.
5. `packages/architecture-lint/tests/application-workspace-boundaries.test.ts`: remove the `web` key at line 79, the `enterpriseComposition("web", …)` and `application("ui", { dependencies: { "@langwatch/enterprise-web" } })` fixture lines around 250-262, and any assertion that expected the ui→web pairing.
6. Docs: `packages/architecture-lint/adrs/001-feature-package-boundaries.md:118`, `dev/docs/adr/111-physical-application-workspaces.md:179,211`, `dev/docs/adr/101-feature-package-surfaces.md:359` name the package; edit each to two compositions (api, worker) and state that browser enterprise screens are mounted by `apps/ui`'s own feature folders.
7. `pnpm install`, `pnpm --filter @langwatch/architecture-lint test`.

### B. apps/ui: the fold and the page helper

Do B1 before B2; B2 is all 38 route files in one change. B3 and B4 are independent.

**B1. Fold the 36 host adapters into their providers.**

For each `apps/ui/src/features/<f>/behavior/<f>-host.adapter.ts` (list in §2; `traces`, `simulations`, `langy` use `behavior/host.adapter.ts`):

1. In the sibling `ui/sections/<f>-host-provider.tsx`, replace `UiXHost.create({ …readings }, { …actions })` with an object literal typed `useMemo<XHostPort>(() => ({ … }), deps)`. Each `readings.k` becomes `k: () => value`; each `actions.k` becomes the arrow it already was. Import `XHostPort` (type) from the same `@langwatch/<f>-web/screens/<x>` entry the adapter imported it from.
2. Each method that is not a forwarder (the 22 in §2) becomes an exported function in `behavior/<f>-<what-it-does>.ts` taking named parameters, for example `openAgentEditor({ query, drawer, agentId, setQuery })`, `copyToClipboard({ text, succeeded, writeClipboard, onSucceeded, onFailed })`, `recordLeadSourceIfAbsent({ storage, source })`, `resolveGovernanceOrganization({ graph, organizationId })`. The provider's literal calls it. Constants the adapter exported (`SECRET_PAGE_PERMISSION`, `OPS_VIEW_PERMISSION`, `DRAWER_OPEN_PARAM` ×5, `ATTRIBUTION_STORAGE_PREFIX`, `LEAD_SOURCE_FIELD`, `DRAWER_AGENT_ID_PARAM`, …) move to the routes file if only the routes file reads them, otherwise to the new `behavior/` module. The five `DRAWER_OPEN_PARAM` copies become one: `apps/ui/src/features/drawers/model/ui-drawer-address.tsx` exports `DRAWER_OPEN_PARAM = "drawer.open"`, and the five features import it through `features/drawers/index.ts` (a `ui/sections` module may compose another private feature's entry; `behavior/` may not, so the constant is consumed in the provider, which is `ui/sections`).
3. Delete the adapter file, its `Readings`/`Actions` types and the `UiXHost` class. `git rm`.
4. Tests in `apps/ui/tests/*host.adapter*.test.*` (12 files): re-target the logic assertions at the extracted functions (rename the file to the function's module, e.g. `agent-drawer-address.unit.test.ts`); delete the forwarding assertions and delete `dataset-host.adapter.unit.test.ts` outright. `annotation-host.adapter.integration.test.tsx` mounts the provider; it stays and only its imports change.
5. Rename `ui/sections/<f>-host-provider.tsx` to `ui/sections/<f>-host.tsx` and export the component (`SecretHost`), not the HOC; the HOC is deleted in B2, so B1 and B2 land together or B1 keeps the HOC until B2. Prefer landing both in one change.

Verification: `pnpm --filter @langwatch/ui test` (whole suite; the page-policy integration tests mount every loader and are the real net), `pnpm --filter @langwatch/architecture-lint test` (the `ui-feature-dependency-direction` and `ui-feature-layout` policies check the new files).

**B2. One page helper for all 38 route files.**

1. Add `apps/ui/src/ui/sections/ui-page.tsx` exactly as in §3, plus `withHost`. `UI_PAGE_FALLBACKS` lives there; delete the 33 `FALLBACKS` copies.
2. Rewrite every `apps/ui/src/features/*/ui/sections/*-routes.tsx` as a `UiPageLoaderRegistry` of `uiPage({...})` calls. Keep every page key string byte-identical (`apps/ui/tests/fixtures/ui-route-transcript.ts` is the parity bar). Keep each key's `permission`, `flags`, layout and host exactly as the file has them now; the `return { default: … }` census in this review's notes is: 18 keys use `withUiSettingsLayout`, `withAuthzHost` keys guard inside the layout (helper order already does this), `chrome-routes.tsx` and the two `authorize` keys take no guard and no layout (`uiPage({ screen, host })` with no permission yields an always-open guard, which is the same behaviour; if you prefer no guard component at all when neither `permission` nor `flags` is given, make `uiPage` skip `withUiPageGuard` in that case and say so in its docblock).
3. `ops-routes.tsx`: `opsPage(name)` and `backofficePage(resource)` become two-line wrappers around `uiPage` whose `screen` binds the resource prop. `automations-routes.tsx` (tabs), `personal-workspace-routes.tsx` (144 lines, two hosts) follow the same rule: local wrapper over `uiPage`, no second helper.
4. Delete the 35 `withXHost` HOCs from the host files (B1 step 5).
5. Move each routes file's docblock content that records POLICY (which grant, why no grant) into a one-line comment on the key it describes; drop the paragraphs about wrapping order, which the helper now states once.
6. Tests: `gateway-routes.unit.test.ts`, `governance-routes.unit.test.ts`, `personal-workspace-routes.unit.test.ts` compare keys with the table and stay unchanged. The `*-page-policy.integration.test.tsx` files mount loaders and stay unchanged. Add `apps/ui/tests/ui-page.unit.test.tsx`: given a screen, a host and `settingsLayout`, the mounted tree is host › settings layout › guard › screen (assert by `displayName` chain or by rendering with a refusing session and checking the settings frame still renders around the forbidden fallback, which is the property the route docblocks defend).

Verification: `pnpm --filter @langwatch/ui test`. Expected net: route files 2,393 → about 1,000 lines; HOCs −280; fallbacks −165.

**B3. Delete the host-install merge and the page-key probe.**
1. `apps/ui/src/features/installed-ui-features.ts`: delete `mergeUiFeatureInstalls` (line 155 to end of file, with its docblock). `installed-ui-features.composition.ts`: `createUiApplication(install)` passes `features: installedUiFeatures`; its parameter type no longer carries `features`. `apps/ui/src/index.ts:140`: stop exporting `mergeUiFeatureInstalls` (grep `mergeUiFeatureInstalls` across `apps packages`; expected consumers are the two tests only). `apps/ui/tests/installed-ui-features.unit.test.ts:567-600` ("when a host brings an install of its own") deletes; `ui-application-installed.unit.test.tsx` has no merge case (checked).
2. `git rm apps/ui/src/features/installed-ui-page-keys.ts`. `apps/ui/src/features/chrome/ui/sections/ui-app-chrome.tsx:65,95`: drop the import; `const servedHere = page !== void 0;`. The three tests that `vi.mock` the module (`chrome-drawer.integration.test.tsx:127`, `chrome-layout.integration.test.tsx:121`, `trace-drawer-mount.integration.test.tsx:91`) lose the mock; any case named for a page "not served here" deletes, since the branch no longer exists.
3. `pnpm --filter @langwatch/ui test`.

**B4. `catalogue.json`.** No change. It is read by `frontend-ui-boundaries.ts` in three directions and the entries are checked against real imports. Leave it.

### C. Order and gates

```
A1 ─┐
A2 ─┼─ independent, any order, one PR each or one PR together
A3 ─┤
A4 ─┘
B1+B2 ─ one change (the HOC deletion joins them)
B3 ─ independent of B
```

After each step, the packages touched for the root session's typecheck: A1 `@langwatch/workflow-web`, `@langwatch/scenario-web`, `@langwatch/trace-contract`, `@langwatch/platform-api-client`; A2 `@langwatch/platform-api-client`, `@langwatch/ui`; A3 `@langwatch/runtime-composition`, `@langwatch/gateway-server`; A4 `@langwatch/architecture-lint`; B `@langwatch/ui`.

## 5. Left deliberately for other lanes

**Flatten lane (`apps/api/src/app-trpc`, agent ac05ff3b26ffa6578).** Nothing in this doc touches it. The `AppRouter` type at `app-trpc.types.ts` already carries the `PinPresent` repair for the optional `agents`/`secrets` namespaces; when the groups flatten and `ApiApplication.create` stops spreading optional namespaces, that mapped type should delete and `AppRouter = ApiApplication["trpc"]` become the whole file.

**api-map lane (after the flatten).** 36 `createFeatureApi<XApiMap>()` sites (list: `grep -rl "createFeatureApi<" packages --include='*.ts' --include='*.tsx'`), each replaced by `export const xApi = trpcReact;` as `secret/web/src/behavior/secret-api.ts` does; the `*ApiMap` types delete (about 10,000 lines per the options doc); `workflow/web/src/behavior/studio-host/api.ts` derives `RouterInputs`/`RouterOutputs` from the map and switches to `inferRouterInputs<AppRouter>` via the client type. Then, in `platform-api-client`: delete `feature-api.ts` and `use-invalidate-procedure.ts` (`trace/web/src/ui/sections/internal/use-rename-trace.ts` switches to `trpcReact.useUtils().tracesV2.list.invalidate()`); `git mv src/trpc-query-key.ts apps/ui/src/behavior/ui-trpc-query-key.ts` with its test (consumers: `ui-rpc.ts`, `ui-session-queries.ts`, `ui-organization-facts.ts`). The package is then `app-router-client.ts` alone. In apps/ui: with one `trpcReact` instance, the 36 `uiFeatureApi(...)` bindings, `UiFeatureInstall.apis`, the `apis` array in `installed-ui-features.ts` and the `reduceRight` at `ui-feature-shell.tsx:114` collapse to one `trpcReact.Provider` mount; each `features/<f>/index.ts` shrinks to its loaders (and drawers) export; `installed-ui-features.unit.test.ts:510` deletes. `feature-web-data-access.md` is rewritten around `trpcReact` at that point (its §"Drift" and §"Follow-ups" are then closed).

**Worker lane.** Decide whether `GatewayRealtimeSessionReconciliationWorker` should run at all. If yes: `apps/worker/src/app/worker-gateway-*.composition.ts` calls `GatewayRealtimeSessionReconciliationWorker.create(infrastructure).start()` and `resources.own("gateway realtime-session reconciliation", () => handle.stop())`. If no: delete the service and its test with the adapter in A3.

**Not touched, noted.** `UiApplicationInstall.pages.loaders` and `mergeUiPageLoaders` (`ui-application.tsx:91-94`) are the same speculative host seam as `mergeUiFeatureInstalls`: `ui.entrypoint.tsx` passes `loaders: {}`. Deleting them changes the global `ui/sections` layer and its tests (`ui-application.unit.test.tsx`, `ui-feature-loaders.unit.test.ts`); same shape as B3, worth a separate small change once B3 is in.

## 6. Verification commands

```
pnpm --filter @langwatch/workflow-web test
pnpm --filter @langwatch/scenario-web test
pnpm --filter @langwatch/platform-api-client test:unit
pnpm --filter @langwatch/runtime-composition test
pnpm --filter @langwatch/gateway-server test
pnpm --filter @langwatch/architecture-lint test
pnpm --filter @langwatch/ui test
pnpm lint
```

No typecheck from the integrating agent; the root session runs it and forwards errors for the packages listed in §4C.
