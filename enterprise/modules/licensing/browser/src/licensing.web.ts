/**
 * What a browser installs when it installs licensing: the License settings
 * screen, and the resource-limits surface billing and organization mount
 * today. Always installed, so nothing here gates itself by tier.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const licensingWeb = defineWebModule("licensing")
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/license": {
      path: "/settings/license",
      within: "settings",
      label: "License",
      load: () => import("./ui/sections/license.screen.tsx"),
    },
  })
  /** What another module may mount. billing and organization both do today. */
  .publishSurfaces({
    "surfaces/resource-limits": {
      load: () => import("./ui/sections/resource-limits/index.ts"),
    },
  });
