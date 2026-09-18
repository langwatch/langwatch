/**
 * What a browser installs when it installs presence: no screen of its own —
 * the trace explorer mounts its stores, markers and avatar stack inline.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

/** What another module may mount. trace reads peers and cursors through it. */
export const presenceWeb = defineWebModule("presence").publishSurfaces({
  presence: { load: () => import("./index.ts") },
});
