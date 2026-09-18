/**
 * What a browser installs when it installs feature-flag: no screen of its
 * own — ops mounts the operator catalogue view inline.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

/** What another module may mount. ops reads the flag catalogue through it. */
export const featureFlagWeb = defineWebModule("feature-flag").publishSurfaces({
  "surfaces/experiment-catalogue": { load: () => import("./experiment-catalogue.ts") },
});
