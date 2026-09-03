/**
 * The application chrome: one layout route drawing the whole shell
 * (`@langwatch/navigation-web`'s) above every page this package serves —
 * host chrome shared by every family, so no feature web package may own it.
 */

import { chromePageLoaders } from "./ui/sections/chrome-routes";

export { chromePageLoaders };

/**
 * The two switchers, and nothing else from the layout module — `ui-app-chrome`
 * is reached only through its lazy loader, so a static export of it would
 * drag the chrome into the signed-out front door's bundle.
 */
export { UiProductSwitcher } from "./ui/blocks/ui-product-switcher";
export { UiProjectSwitcher } from "./ui/blocks/ui-project-switcher";
