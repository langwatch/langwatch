/**
 * The application chrome, as this package serves it.
 *
 * WHAT IT IS. One layout route above the two project-scoped groups of the route
 * table. It mounts the navigation host once and draws a header — the mark, the
 * project switcher, the way into settings — around every page THIS package
 * serves. A page `platform/app` still serves keeps its own `DashboardLayout`
 * and gets the bare outlet, so no address ends up with two headers; the branch
 * that decides goes away with the last legacy loader.
 *
 * WHY IT IS HERE AND NOT IN A PACKAGE, the same argument the settings chrome
 * already makes for itself: it is host chrome shared by every family, so no one
 * family's web package can own it, and a package may not import this one. What
 * IS a package's — the switcher control, the product registry, the landing
 * rules — lives in `@langwatch/navigation-web`, and this composes it.
 *
 * ## THE DRAWER GAP IS NOT CLOSED, AND THIS IS WHY
 *
 * Every moved family records the same line: `openPlatformDrawer` writes
 * `?drawer.open=<name>` and nothing opens, because no `CurrentDrawer` is mounted
 * above a screen served from here. This layout route is where that mount
 * belongs, and it is empty for a reason that is structural rather than
 * unfinished work:
 *
 * - `platform/app/src/components/drawerRegistry.ts` names FORTY-FIVE components
 *   by module path, every one of them a `platform/app` module. A registry that
 *   moved here would have nothing to point at: this package does not depend on
 *   `@langwatch/web` and, by ADR-004, must not.
 * - A registry that STAYS there has to be handed over, and the only place that
 *   could happen is `runtime/ui/legacy-ui-shell.adapter.tsx` — a `platform/app`
 *   file, which is deletes-only for the duration of this migration. Adding a
 *   `drawers:` field to the install it passes is an insertion.
 * - `hooks/useDrawer.ts`, which owns the address vocabulary and the complex-prop
 *   stores those drawers read, has 246 importers in `platform/app`. Moving it
 *   moves the gap rather than closing it.
 *
 * So the drawer half needs one `platform/app` insertion or forty-five moved
 * components, and neither is available here. The mount point is this file's
 * layout route when it is.
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
 */
export { UiProductSwitcher } from "./ui/blocks/ui-product-switcher";
export { UiProjectSwitcher, projectSwitchHref } from "./ui/blocks/ui-project-switcher";
