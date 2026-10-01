/**
 * What a browser installs when it installs share: no screen of its own — the
 * trace explorer mounts its share dialog and link-expiry helpers inline.
 */

import { defineWebModule } from "@langwatch/browser";

export const shareWeb = defineWebModule("share");
