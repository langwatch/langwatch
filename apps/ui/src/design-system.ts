import { createDesignSystem } from "@langwatch/design-system/system";
import { langyThemeConfig } from "@langwatch/langy-browser-kit";

import type { UiRootCapabilities } from "./shell/ui-root-capabilities";

/** The application-composed system: shared foundations plus installed features. */
export function composeUiDesignSystem({
  frontDoorTheme,
}: Pick<UiRootCapabilities, "frontDoorTheme">) {
  return createDesignSystem(langyThemeConfig, frontDoorTheme.frontDoorThemeConfig);
}
