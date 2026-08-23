import { createDesignSystem } from "@langwatch/design-system/system";
import { langyThemeConfig } from "~/features/langy/langyTheme";

/** The application-composed system: shared foundations plus installed features. */
export const system = createDesignSystem(langyThemeConfig);
