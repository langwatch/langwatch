/**
 * What a browser installs when it installs sso: the host its sections read
 * session and scope through. Screens arrive with the rest of the port of
 * upstream's ee/sso components; always installed, entitlement refuses.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const ssoWeb = defineWebModule("sso").withHosts({
  requires: ["SsoHostApi"],
  mounts: { SsoHostApi: { load: () => import("./behavior/sso-host-mount.tsx") } },
});
