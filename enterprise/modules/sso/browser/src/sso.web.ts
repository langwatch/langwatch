/**
 * What a browser installs when it installs sso: the setup journey, and the
 * host its sections read session and scope through. Always installed —
 * entitlement refuses per organization, a route never does.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const ssoWeb = defineWebModule("sso")
  .withHosts({
    requires: ["SsoHostApi"],
    mounts: { SsoHostApi: { load: () => import("./behavior/sso-host-mount.tsx") } },
  })
  .withScreens({
    // Upstream's address, kept: the journey is a route rather than a mode, so
    // reloading halfway through resumes where the aggregate says it is.
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes, as scim's screen is.
    "pages/settings/authentication/provider": {
      path: "/settings/authentication/provider",
      within: "settings",
      label: "Identity provider",
      load: () => import("./ui/sections/sso-setup.screen.tsx"),
    },
  })
  // How people sign in, drawn on organization's Authentication overview.
  .withCapabilities({
    authenticationOverviewCard: { load: () => import("./ui/sections/sso-overview-card.tsx") },
  });
