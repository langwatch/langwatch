/**
 * What a browser installs when it installs github: the connect-popup surface
 * the langy module mounts. The Integrations screen is integration's.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const githubWeb = defineWebModule("github")
  /** What another module may mount. Today langy mounts the connect popup. */
  .publishSurfaces({
    "surfaces/github-connect-popup": { load: () => import("./behavior/github-connect-popup.ts") },
  });
