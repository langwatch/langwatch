import { createDesignSystem } from "@langwatch/design-system/system";
import { langyThemeConfig } from "../model/langy-theme";

/** The application-composed system: shared foundations plus installed features. */
export const uiDesignSystem = createDesignSystem(langyThemeConfig);
