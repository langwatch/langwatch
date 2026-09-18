import { frontDoorThemeConfig } from "@langwatch/auth-browser/auth";
import { createDesignSystem } from "@langwatch/design-system/system";
import { langyThemeConfig } from "@langwatch/langy-browser-kit";

/** The application-composed system: shared foundations plus installed features. */
export const uiDesignSystem = createDesignSystem(langyThemeConfig, frontDoorThemeConfig);
