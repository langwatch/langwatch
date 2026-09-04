# One install surface for the browser application

Status: design frozen 2026-09-05, applied by a single lane. Closes the "UI
loader lines" counter of `strict-layout-end-goal`: one registration line per
feature, no twin registries.

## Today

Each `apps/ui/src/features/<x>/index.ts` exports up to three values —
`<x>ApiBinding`, `<x>PageLoaders`, `<x>Drawers` — and two root files spread
them by hand:

```
features/<x>/index.ts ──┬─ <x>ApiBinding ──┐
                        ├─ <x>PageLoaders ─┼─► installed-ui-features.ts   (131 lines, 3 per feature)
                        └─ <x>Drawers ─────┼─► installed-ui-drawers.ts    (94 lines, 1 per feature + rules)
                                           │
                            44 features × up to 3 hand-written lines, in two places
```

Forgetting one of the three lines is silent: the page 404s, the drawer does
not open, the hooks throw "no client". Eighteen family manifests recorded
exactly that class of gap.

## End shape

```
features/<x>/index.ts ── export const <x>Feature = uiFeature({ ... }) ──┐
                                                                        │ one line each
installed-ui-features.ts ── const features = [agentFeature, …, workflowFeature]
                            export const installedUiFeatures = installUiFeatures({ features, capabilities, session })
                            export const installedUiDrawers  = installedUiFeatures.drawers
                            export const useUiDrawer / preloadUiDrawer / usePreloadUiDrawer   (moved here)
```

### The feature value

`apps/ui/src/behavior/ui-feature.ts` owns the type and the two functions.
`uiFeatureApi` in `ui-feature-transport.ts` folds into `uiFeature` and is
deleted; its 37 importers move (no re-export).

```ts
export type UiFeature = {
  readonly name: string;                    // "@langwatch/dataset-web"
  readonly api?: UiFeatureApiBinding;       // absent for authorize, chrome, drawers-less shells
  readonly loaders: UiPageLoaderRegistry;   // {} allowed, never undefined
  readonly drawers: UiDrawerRegistry;       // {} allowed
};

export function uiFeature<TClient, const D extends UiDrawerRegistry>(input: {
  name: string;
  api?: { Provider: ComponentType<{ client: TClient; queryClient: QueryClient; children: ReactNode }> };
  loaders?: UiPageLoaderRegistry;
  drawers?: D;
}): UiFeature & { readonly drawers: D };
```

`uiFeature` is the one place allowed to erase the client Provider type, as
`uiFeatureApi` is today.

### The install

```ts
export function installUiFeatures<const F extends readonly UiFeature[]>(input: {
  features: F;
  capabilities?: UiCapabilityInstall;
  session?: UiSessionSource;
  transport?: UiFeatureApiTransport;
}): UiFeatureInstall & { readonly drawers: UnionToIntersection<F[number]["drawers"]> };
```

- Loaders merge into one registry. A page key served by two features throws
  at composition (`Error`, not handled: it is a programming fault) naming
  both features. Today the spread silently lets the later one win.
- Drawers merge the same way with the same duplicate refusal, and the
  merged type keeps every key so `useDrawer<typeof installedUiDrawers>` stays
  checked at every call site.
- `apis` is `features.flatMap((f) => f.api ? [f.api] : [])`, in list order.

### Per-feature file

```ts
/** Datasets: two screens, four overlays and the spreadsheet editor, all in `@langwatch/dataset-web`. */
export const datasetFeature = uiFeature({
  name: "@langwatch/dataset-web",
  api: datasetApi,
  loaders: datasetPageLoaders,
  drawers: {
    selectDataset: lazyDrawer({ factory: () => import("./ui/sections/dataset-drawers"), key: "SelectDatasetDrawer" }),
  },
});
```

The `<x>Feature` export is the only value a feature index exports. Loader
tables stay in their `ui/sections/<x>-routes.ts` and are imported, not
re-exported. `automationsAllPageLoaders` becomes `automationsPageLoaders`.

### Files

| File | Change |
|---|---|
| `apps/ui/src/behavior/ui-feature.ts` | new: `UiFeature`, `uiFeature`, `installUiFeatures` |
| `apps/ui/src/behavior/ui-feature-transport.ts` | `uiFeatureApi` removed |
| `apps/ui/src/features/*/index.ts` (44) | one `<x>Feature` export each |
| `apps/ui/src/features/installed-ui-features.ts` | the list, the install, the drawer rules and hooks |
| `apps/ui/src/features/installed-ui-drawers.ts` | deleted; 11 importers move to `installed-ui-features` |
| `apps/ui/src/features/drawers/index.ts` | re-pointed |
| `apps/ui/tests/installed-ui-drawers.*.test.*` | re-pointed |

### Guard

`specs/ui/ui-feature-install.feature`, scenarios tagged `@unit`, bound by
`apps/ui/tests/ui-feature-install.unit.test.ts`:

- every directory under `apps/ui/src/features` with an `index.ts` exports
  exactly one `*Feature` value and it appears in the installed list (a new
  feature cannot be half-registered);
- two features serving the same page key are refused by name;
- two features serving the same drawer name are refused by name;
- a feature without `api` contributes no Provider and its pages still load.

## Counter

"UI loader lines" is retired once this lands; its replacement is
`features not installed = 0`, read from the guard test.
