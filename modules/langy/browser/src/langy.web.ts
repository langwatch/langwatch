/**
 * What a browser installs when it installs langy: the host its dock reads, and
 * the api its hooks run on. No screens — langy draws inside other modules'
 * pages, which is exactly why its host must mount above the routed tree.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

import { langyApi } from "./behavior/langy-api.ts";

export const langyWeb = defineWebModule("langy")
  .withApi(langyApi)
  .withHosts({
    requires: ["LangyHostApi"],
    mounts: { LangyHostApi: { load: () => import("./behavior/langy-host-mount.tsx") } },
  });
