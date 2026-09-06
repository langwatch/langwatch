# The browser install surface

How `apps/ui` installs a feature, where a browser host port lives, and how a
core screen renders an enterprise block without importing one.

Frozen 2026-09-05. Written out of three plan documents that are now retired.
The open product ruling is in `dev/docs/plans/strict-feature-layout.md`
section 4 item 23.

## One feature, one line

A feature index exports exactly one value. The browser application lists it.

```
features/<x>/index.ts ── export const <x>Feature = uiFeature({ ... })
                                     │ one line each
installed-ui-features.ts ── const features = [agentFeature, …, workflowFeature]
                            export const installedUiFeatures =
                              installUiFeatures({ features, capabilities, session })
```

Before this, each index exported up to three values and two root files spread
them by hand. Forgetting one line was silent: the page answered 404, the drawer
did not open, or the hooks threw "no client". Eighteen family manifests recorded
that same class of gap.

`apps/ui/src/behavior/ui-feature.ts` owns the type and the two functions.

```ts
export type UiFeature = {
  readonly name: string;                    // "@langwatch/dataset-web"
  readonly api?: UiFeatureApiBinding;       // absent for a shell with no transport
  readonly loaders: UiPageLoaderRegistry;   // {} allowed, never undefined
  readonly drawers: UiDrawerRegistry;       // {} allowed
};
```

Rules that the install enforces:

- Loaders merge into one registry. A page key served by two features throws at
  composition and names both features. This is a programming fault, so it is a
  plain `Error`, not a `HandledError`.
- Drawers merge the same way with the same refusal. The merged type keeps every
  key, so `useDrawer<typeof installedUiDrawers>` stays checked at every call
  site.
- `uiFeature` is the one place allowed to erase the client provider type.
- A loader table stays in its `ui/sections/<x>-routes.ts` and is imported, never
  re-exported.

The guard is `specs/ui/ui-feature-install.feature`, bound by
`apps/ui/tests/ui-feature-install.unit.test.ts`. It asserts that every directory
with an `index.ts` exports exactly one `*Feature` value and appears in the
installed list, that a duplicate page key is refused by name, that a duplicate
drawer name is refused by name, and that a feature without `api` still loads its
pages. The counter it replaces is "features not installed = 0".

## A web surface is a door, not a second implementation

A package's public entry is `src/surfaces/<id>/index.ts`, exported as
`./surfaces/<id>`.

```
src/surfaces/<id>/index.ts   the door
        │  may reach
        ├─ src/surfaces/<id>/**   its own directory
        ├─ src/model/**           shared model
        ├─ src/behavior/**        shared behavior
        └─ src/ui/**              shared presentation

  nothing else: features/, screens/, internal/, queries/, routes/,
  state/, stores/ and transport/ all still fail
```

Private code still may not import a surface. The browser-capability ban, the
portable-import checks and the refusal to reach another package's surface all
apply through the full closure.

Before this, a component used both inside its own package and by another feature
had exactly one legal home: hoisted as a `.tsx` into `model/`, which is the
wrong layer for presentation.

## The browser host lives in `@langwatch/ui-host`

A feature web package never names the browser application. It reads a port.

```
packages/ui-host/src/capabilities.ts  the ports and the context
packages/ui-host/src/use-router.ts    a Next-compatible reading over
                                      UiRoutePort and UiNavigationPort
packages/ui-host/src/toaster.ts       forwards to UiFeedbackPort, renders nothing
packages/ui-host/src/errors.ts        showErrorToast and explainAnyError
packages/ui-host/src/link.tsx         Link over UiNavigationPort
```

- `@langwatch/ui-host` may depend on `@langwatch/handled-error` and React. It
  never depends on a feature package or on `apps/ui`.
- The shell mounts one `UiCapabilityContextProvider`. A port that is absent
  degrades; it does not throw.
- The canonical `useRouter` exposes params and query as separate fields, plus a
  merged `query` with params winning, which is what the original callers had.
  A call site that relied on query winning is fixed at the call site.
- The design-system toaster stays the one component that draws a toast.

## A core screen asks for a block by name

A core screen must not import an enterprise package. It asks the composition for
a block, and renders its own fallback when nothing came back. Only `apps/ui`,
the one package that may name both halves, decides what comes back.

```
 packages/features/*/web         packages/ui-host           apps/ui
 ───────────────────────         ──────────────             ───────
 <UiSlot name="contactSales" />  UiSlotsPort                billing-slots.ts
 useUiSeatTypeCopy()        ──►   filled(name)         ◄──  licensing-slots.ts
        │                         seatTypeCopy()            model-provider-slots.tsx
        ▼                         CORE_SEAT_TYPE_COPY              │
  nothing filled the slot ──► render the fallback. Never a throw.
```

- `UiSlotProps` types each slot by the props the core feature passes, not by the
  enterprise component's own signature. The fill adapts.
- Copy is data, not a component. `UiSeatTypeCopy` is a record, and
  `CORE_SEAT_TYPE_COPY` is the core default.
- `UiSlotsPort` is an abstract class with both members defaulted. An absent port
  and an unfilled slot read the same way, so degrading is the base behaviour.
- `slots` on `UiCapabilities` is optional and the import is `import type`.
  Capabilities must not gain a runtime edge to a module that imports it back.
- A fill lives in the `apps/ui` feature directory that owns the words, and
  declares its exact surface in `apps/ui/src/features/catalogue.json`.

The core default holds the real words on purpose. A core test renders the form
with no shell above it, so it reads the core default and asserts the canonical
sentence. The running application still reads the enterprise copy, because
`apps/ui` fills the slot. Two records with the same words is the recorded cost.
The alternative is a core package that cannot explain its own form without an
enterprise dependency.
