/**
 * What a browser installs when it installs langy: the host its dock reads, and
 * the api its hooks run on. No screens — langy draws inside other modules'
 * pages, which is exactly why its host must mount above the routed tree.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

import { langyApi } from "./behavior/langy-api.ts";
import { langyGuidedOnboarding } from "./behavior/langy-guided-onboarding.capability.ts";

export const langyWeb = defineWebModule("langy")
  .withApi(langyApi)
  // All another module may do to the panel: dock it with a kickoff and hear
  // the scope it entered, or ask it a question with the view it is about. A
  // consumer's own host reads `langyAsk` by name; nothing else reaches the store.
  .withCapabilities({
    guidedOnboarding: langyGuidedOnboarding,
    langyAsk: {
      load: async () => ({
        default: (await import("./behavior/langy-ask.capability.ts")).langyAsk,
      }),
    },
  })
  .withHosts({
    requires: ["LangyHostApi"],
    mounts: { LangyHostApi: { load: () => import("./behavior/langy-host-mount.tsx") } },
  });
