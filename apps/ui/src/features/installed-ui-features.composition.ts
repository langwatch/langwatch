/**
 * `createUiApplication`, with what this package serves already installed.
 *
 * The structural composition lives in `ui/sections/ui-application`, which may
 * not import a private feature; this wrapper is what closes that gap, and it is
 * what `@langwatch/ui` exports under the name. A caller that wants the bare
 * composition — a test with a registry of its own, or a hostless shell — asks
 * for `composeUiApplication` instead and gets nothing installed.
 */

import type { UiApplication, UiApplicationInstall } from "../ui/sections/ui-application";
import { createUiApplication as composeUiApplication } from "../ui/sections/ui-application";
import { installedUiFeatures, mergeUiFeatureInstalls } from "./installed-ui-features";

export { composeUiApplication };

export function createUiApplication(install: UiApplicationInstall): UiApplication {
  return composeUiApplication({
    ...install,
    features: mergeUiFeatureInstalls(installedUiFeatures, install.features),
  });
}
