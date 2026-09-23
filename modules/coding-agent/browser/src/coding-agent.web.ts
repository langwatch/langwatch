/**
 * What a browser installs when it installs coding-agent: no screen of its
 * own — user mounts its activity tables inline.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

/** What another module may mount: user reads the activity tables. */
export const codingAgentWeb = defineWebModule("coding-agent").publishSurfaces({
  "surfaces/activity": { load: () => import("./activity.ts") },
});
