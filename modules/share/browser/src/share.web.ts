/**
 * What a browser installs when it installs share: no screen of its own — the
 * trace explorer mounts its share dialog and link-expiry helpers inline.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

/** What another module may mount. trace shares a trace through both. */
export const shareWeb = defineWebModule("share").publishSurfaces({
  "share-link-views": { load: () => import("./share-link-views.ts") },
  "share-links": { load: () => import("./share-links.ts") },
});
