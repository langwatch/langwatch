/**
 * What a browser installs when it installs licensing: the License settings
 * screen, the usage-against-limit row billing and organization borrow, and the
 * reader that opens the upgrade modal on any licence refusal. Always installed.
 */

import { defineBrowserModule } from "@langwatch/browser";

import { reportLicenseFailure } from "./ui/sections/license-error-interceptor/index.ts";

export const licensingWeb = defineBrowserModule("licensing")
  // specs/licensing/license-failure-modal.feature
  .withFailureInterceptors([reportLicenseFailure])
  .withHosts({
    requires: ["LicensingHostApi"],
    mounts: {
      LicensingHostApi: { load: () => import("./behavior/licensing-host-mount.tsx") },
    },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/license": {
      path: "/settings/license",
      within: "settings",
      label: "License",
      load: () => import("./ui/sections/license.screen.tsx"),
    },
    "pages/settings/connect": {
      path: "/settings/connect",
      within: "settings",
      label: "Connect",
      load: () => import("./ui/sections/connect.screen.tsx"),
    },
  })
  /** The usage row billing and organization both draw (§3.4 rule 7). */
  .withCapabilities({
    resourceLimitRow: {
      load: async () => ({
        default: (await import("./ui/sections/resource-limits/lent-resource-limit-row.tsx"))
          .LentResourceLimitRow,
      }),
    },
  });
