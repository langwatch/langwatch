/**
 * What a browser installs when it installs sso. Screens arrive with the port
 * of upstream's ee/sso components; always installed, entitlement refuses.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const ssoWeb = defineWebModule("sso");
