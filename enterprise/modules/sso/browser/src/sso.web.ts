/**
 * What a browser installs when it installs sso: the setup journey, and the
 * host its sections read session and scope through. Always installed —
 * entitlement refuses per organization, a route never does.
 */

import { defineBrowserModule } from "@langwatch/browser";
import { SsoReplacementImportToken } from "@langwatch/enterprise-sso-contract";
import { AuthenticationOverviewCardToken } from "@langwatch/organization-client";

export const ssoWeb = defineBrowserModule("sso")
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
      requires: "sso:view",
      load: () => import("./ui/sections/sso-setup.screen.tsx"),
    },
  })
  // How people sign in, drawn on organization's Authentication overview.
  .lends(AuthenticationOverviewCardToken, {
    load: () => import("./ui/sections/sso-overview-card.tsx"),
  })
  // The back office's replacement import, drawn in ops' legacy-connection inventory.
  .lends(SsoReplacementImportToken, {
    load: () => import("./ui/sections/replacement-import.section.tsx"),
  });
