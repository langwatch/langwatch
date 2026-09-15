/**
 * Which page key the chrome layout route answers.
 */

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";

const appChromeLayout: UiPageLoader = () => import("./ui-app-chrome");

export const chromePageLoaders: UiPageLoaderRegistry = {
  "features/chrome/UiAppChrome": appChromeLayout,
};
