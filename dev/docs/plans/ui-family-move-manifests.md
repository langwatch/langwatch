# UI page-family move manifests

**Landed.** Every page family is out of `platform/app`, and `platform/` itself
is deleted (`faaa9ec333`). This file was the per-family dispatch record — 82
route keys across seventeen moves, each with its closure survey, its host-port
seam and its recorded judgment calls. That record is git history now; what
follows is what a reader still needs.

## What the programme produced

- **`apps/ui` is the browser composition root.** It owns the route table as
  data, the page-loader registry, the provider nestings and
  `createUiApplication`. The loader-merge point, the browser transport in
  `src/behavior/`, the session/scope/permission/feedback/navigation
  capabilities and the `catalogue.json` + governed-export gates all landed as
  `b3ae7e8489`, `80f1d1cc3f` and `1a759888de`; the design-system promotions as
  `4ffabc1735`; the destination relayouts as `0958e06039`, `0559f563df` and
  `648ed49987`.
- **Governance was the reference family** (`1a759888de`) and every later move
  copied its shape: screens into the feature's web package, served by apps/ui's
  own feature declaration in `installed-ui-features.ts`, guarded by
  `ui-page-guard` (flags before permissions, nothing refused in flight), fed
  through the package's one host port.
- **The host adapters that shape produced are themselves gone** —
  `268eb2ed83` folded all 36 into their providers as typed object literals and
  replaced the 38 route files' skeleton with one `uiPage()` helper. See
  `install-composition-review-2026-09-03.md`.

## The drawer registry mechanism (current shape, keep)

Every moved family recorded the same open line: a screen asks its host to open
a drawer, the host writes `?drawer.open=<name>`, and nothing opened, because
the mount lived in `platform/app`'s `DashboardLayout` and read a registry of
that application's own modules. Closed on 2026-09-03, and it cost neither of
the two prices earlier entries floated (one `platform/app` insertion, or moving
forty-five drawer components) — what had to move was the registry MECHANISM,
not the drawers nailed to it:

- `@langwatch/ui-drawer` owns the address vocabulary, the navigation stack, the
  complex-prop/flow-callback stores, the lazy registry and `CurrentDrawer` —
  moved whole out of `hooks/useDrawer.ts`, `components/drawerRegistry.ts` and
  `components/CurrentDrawer.tsx`.
- The registry is installed the way page loaders are: a feature publishes
  `{ key: lazyDrawer(...) }` and `installed-ui-drawers.ts` spreads them in.
- `apps/ui/src/features/chrome/ui/sections/ui-app-chrome.tsx` mounts
  `CurrentDrawer` once, above the outlet and outside the shell branch — a
  drawer is addressed by the query string and renders through a portal.

Every name any screen, command-bar entry, host adapter or outbound email
addresses resolves in `installed-ui-drawers.ts`, with four decisions rather
than gaps: `traceV2Details` / `traceDetails` are mounted directly
(`UiTraceDrawerMount`, below `CurrentDrawer`) because their URL-to-store sync
must outlive the `?drawer.open=` parameter; `dashboardName`, `seriesFilters`
and `opsGroupDetail` stay local overlays on their own screens' query keys,
kept because nothing outside those screens links to them.

## Residuals the moves left behind

Small, named, and none of them blocking:

- **`accountMenu()` and `plan().pricingModel`** are still `null` / absent on
  the navigation shell's host port.
- **The home draws no Crisp bubble entry**, for the reason `supportChat()`
  gives at its own declaration.
- **`@langwatch/project-web` publishes two screens with two host ports** —
  `/[project]` and `/settings` — mounted by two frontend features (`home` and
  `project`), which is why its name appears twice in the transport list.
  Intentional, recorded so nobody reads it as duplication.
- **The `./install` export per web package** (loaders + drawers as one object,
  folding `installed-ui-drawers.ts` into the list) is option J in
  `composition-simplification-options.md`. It needs the governed-package fork
  decision and is much smaller after the api-map lane.
