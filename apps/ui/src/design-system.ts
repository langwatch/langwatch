import { createDesignSystem } from "@langwatch/design-system/system";

import type { UiRootCapabilities } from "./shell/ui-root-capabilities";
import { langyThemeConfig } from "./shell/ui/elements/langy/langy-theme.ts";

/** The application-composed system: shared foundations plus installed features. */
export function composeUiDesignSystem({
  frontDoorTheme,
}: Pick<UiRootCapabilities, "frontDoorTheme">) {
  return createDesignSystem(langyThemeConfig, frontDoorTheme.frontDoorThemeConfig);
}
