/**
 * What a browser installs when it installs langy: the layout its dock draws
 * in, the host that dock reads, and the api its hooks run on. Langy draws
 * inside other modules' pages, which is why its host mounts above the tree.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

import { langyApi } from "./behavior/langy-api.ts";
import { langyGuidedOnboarding } from "./behavior/langy-guided-onboarding.capability.ts";

export const langyWeb = defineWebModule("langy")
  .withApi(langyApi)
  // Path-less: the route table nests every project and settings page under
  // it, so the panel and its provider survive navigation between them.
  .withScreens({
    "layouts/project-langy": {
      load: () => import("./features/langy/ui/sections/project-langy-layout.tsx"),
    },
  })
  // All another module may do to the panel: dock it with a kickoff and hear
  // the scope it entered. The shell wires this into the consumer's own
  // `*HostApi`; nothing else reaches Langy's store.
  .withCapabilities({ guidedOnboarding: langyGuidedOnboarding })
  .withHosts({
    requires: ["LangyHostApi"],
    mounts: { LangyHostApi: { load: () => import("./behavior/langy-host-mount.tsx") } },
  });
