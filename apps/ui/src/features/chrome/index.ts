/**
 * The application chrome, as this package serves it.
 *
 * WHAT IT IS. One layout route above the two project-scoped groups of the route
 * table. It mounts the navigation host once and draws the WHOLE SHELL — the top
 * bar with both switchers, the product sidebar, the content card and the page
 * body inside it — around every page THIS package serves. A page `platform/app`
 * still serves keeps its own `DashboardLayout` and gets the bare outlet, so no
 * address ends up with two of everything; the branch that decides goes away
 * with the last legacy loader.
 *
 * THE SHELL ITSELF IS `@langwatch/navigation-web`'s. It moved there whole out
 * of `platform/app`'s `components/DashboardLayout`, `MainMenu`,
 * `PersonalSidebar`, `components/sidebar/**`, `AppHeaderUserMenu`,
 * `DashboardPageBody` and the ten `features/navigation/shell/*` modules. What
 * stays here is the composition: which page keys this half serves, the host
 * port that answers for the workspace, and the drawer mount.
 *
 * WHY IT IS HERE AND NOT IN A PACKAGE, the same argument the settings chrome
 * already makes for itself: it is host chrome shared by every family, so no one
 * family's web package can own it, and a package may not import this one. What
 * IS a package's — the switcher control, the product registry, the landing
 * rules — lives in `@langwatch/navigation-web`, and this composes it.
 *
 * ## THE DRAWER GAP IS CLOSED, AND NEITHER OF THE TWO PRICES WAS PAID
 *
 * Every moved family recorded the same line: `openPlatformDrawer` writes
 * `?drawer.open=<name>` and nothing opens, because no `CurrentDrawer` was
 * mounted above a screen served from here. This section used to say the mount
 * cost one `platform/app` insertion or forty-five moved components. It cost
 * neither, because the choice was false: what had to move was not the forty-five
 * DRAWERS, it was the registry MECHANISM they were nailed to.
 *
 * - `@langwatch/ui-drawer` now owns the address vocabulary, the navigation
 *   stack, the complex-prop and flow-callback stores, the lazy registry and
 *   `CurrentDrawer` — moved whole out of `hooks/useDrawer.ts`,
 *   `components/drawerRegistry.ts` and `components/CurrentDrawer.tsx`. It names
 *   no drawer at all, so nothing in it points at `platform/app`.
 * - The registry is INSTALLED, the way page loaders already are: a feature
 *   publishes `{ key: lazyDrawer(...) }` and `installed-ui-drawers.ts` spreads
 *   them. No host has to hand anything over, so no `platform/app` file is
 *   edited.
 * - `ui-app-chrome` mounts the host once, above the outlet and OUTSIDE the
 *   header branch — a drawer is addressed by the query string and renders
 *   through a portal, so it opens over a legacy page too.
 *
 * WHAT IS STILL OPEN is per drawer rather than structural: a drawer opens as
 * soon as its component lives in its family's package with that package's
 * transport and host port behind it. The ones that do are registered; the ones
 * whose component is still a `platform/app` module, or whose closure drives
 * `@langwatch/workflow-web`'s studio drawer navigator instead of this one, are
 * recorded drawer by drawer in the family manifests.
 */

import { chromePageLoaders } from "./ui/sections/chrome-routes";

export { chromePageLoaders };

/**
 * The two switchers, and nothing else from the layout module.
 *
 * `ui-app-chrome` is reached ONLY through its lazy loader. It asks
 * `installed-ui-page-keys`, which reads the registry that composes this file, so
 * a static export from here would put the layout inside that cycle at module
 * initialisation and drag the chrome into the bundle a signed-out reader
 * downloads for the front door. The switcher blocks have no such reach.
 *
 * They are still exported because they are handed ACROSS seams: a screen's own
 * host port carries the project switcher as a `ReactNode`, so the screen
 * decides where in its header it goes. The shell draws its own.
 */
export { UiProductSwitcher } from "./ui/blocks/ui-product-switcher";
export { UiProjectSwitcher } from "./ui/blocks/ui-project-switcher";
