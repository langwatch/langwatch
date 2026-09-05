# The browser host lives in ui-host

Status: design frozen 2026-09-05. Closes most of the cross-feature web
imports (`langwatch(package-boundaries)`), which after the server class work
are the largest lint bucket left.

## Today

```
apps/ui/src/behavior/ui-capabilities.ts ── UiNavigationPort, UiRoutePort, UiFeedbackPort,
                                            UiDocumentTitlePort, UiSessionPort, UiCapabilities context
              ▲ only apps/ui may import it
              │
packages/features/workflow/web/src/behavior/studio-host/{next-router,toaster,errors,link}.ts
              ▲ over WorkflowHostPort, which throws unless the workflow routes mounted it
              │
   experiment, evaluator, prompt, dataset, scenario, model-provider, analytics … (93 imports)
   + 7 per-feature copies of next-router.ts, 4 of errors.tsx, each over its own throwing host port
```

The scope hook already took this path (commit 01ae68a6bb, 54ab1e73df):
one port in `@langwatch/ui-host`, published once by the shell, degrading when
absent. The router, toaster, error presenter and link shims are the same
shape and get the same treatment.

## End shape

```
packages/ui-host/src/capabilities.ts ── the ports and the context (moved from apps/ui, unchanged API)
packages/ui-host/src/use-router.ts   ── useRouter(): the Next-compat reading over UiRoutePort + UiNavigationPort
packages/ui-host/src/toaster.ts      ── toaster over UiFeedbackPort (no rendering; the shell renders)
packages/ui-host/src/errors.ts       ── showErrorToast, explainAnyError over UiFeedbackPort + handled-error presentation
packages/ui-host/src/link.tsx        ── Link over UiNavigationPort

apps/ui/src/behavior/ui-capabilities.ts ── deleted; apps/ui imports @langwatch/ui-host/capabilities
apps/ui/src/ui/sections/ui-feature-shell.tsx ── unchanged in shape: still mounts the one UiCapabilityContextProvider

features/*/web ── import the four from @langwatch/ui-host; their local copies and the workflow studio-host copies are deleted
```

- `@langwatch/ui-host` may depend on `@langwatch/handled-error` and React;
  never on a feature package or on apps/ui.
- The per-feature copies differ in query/param merge precedence (trace merges
  `{...params, ...query}`, scenario and langy the reverse). The canonical
  `useRouter` reads both off `UiRoutePort.reading()` and exposes them as
  separate fields plus the merged `query` with params winning, which is what
  Next gave the original callers. Any call site that relied on query winning
  is listed in the lane report and fixed at the call site.
- `toaster` in ui-host renders nothing: it forwards to `UiFeedbackPort`. The
  design-system toaster stays the one component that draws toasts, mounted
  by the shell.

## Outside this design

- `@langwatch/workflow-web/studio-host/api` (79 importers): workflow's typed
  tRPC hook called from other features' screens. Whether those screens get
  their own procedures on their feature's api map, or the boundary rule
  admits a web feature's public hooks, is a product ruling; left for Alex.
- `components/ui/drawer` and `dialog` (49 importers): studio-flavoured
  supersets of the design-system primitives. They move to design-system as
  `./studio-drawer` and `./studio-dialog`, not replacing the existing ones.
- `model/prisma-types` (12) moves to `@langwatch/workflow-contract`;
  `utils/constants` (6) splits to the contracts that own each constant.
