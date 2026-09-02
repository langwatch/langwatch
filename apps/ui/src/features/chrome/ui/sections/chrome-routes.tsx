/**
 * Which page key the chrome layout route answers.
 *
 * A LAYOUT key, not a page key: the route table entry that names it carries
 * children and no path, so React Router keeps it mounted while the pages below
 * it swap — which is what makes one navigation host, one workspace read and one
 * header serve every project-scoped address.
 *
 * Loaded lazily like every other key, so the chrome's own code stays out of the
 * bundle a signed-out reader downloads for the front door.
 */

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";

const appChromeLayout: UiPageLoader = () => import("./ui-app-chrome");

export const chromePageLoaders: UiPageLoaderRegistry = {
  "features/chrome/UiAppChrome": appChromeLayout,
};
