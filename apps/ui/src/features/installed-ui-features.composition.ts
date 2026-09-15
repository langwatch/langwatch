/**
 * `createUiApplication`, with what this package serves already installed.
 * `ui/sections/ui-application` may not import a private feature, so this
 * closes the gap; `composeUiApplication` stays bare for its own registry.
 */

import type { UiApplication, UiApplicationInstall } from "../ui/sections/ui-application";
import { createUiApplication as composeUiApplication } from "../ui/sections/ui-application";
import { installedUiFeatures } from "./installed-ui-features";

export { composeUiApplication };

export function createUiApplication(
  install: Omit<UiApplicationInstall, "features">,
): UiApplication {
  return composeUiApplication({
    ...install,
    features: {
      ...installedUiFeatures,
      // The one reading of the build every screen shares. Read here because
      // this is the composition root; a feature package may not read it.
      capabilities: {
        ...installedUiFeatures.capabilities,
        deployment: { isDevelopment: import.meta.env.DEV },
      },
    },
  });
}
