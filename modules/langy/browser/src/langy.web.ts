/**
 * What a browser installs when it installs langy: the layout its dock draws
 * in, the host that dock reads, and the api its hooks run on. Langy draws
 * inside other modules' pages, which is why its host mounts above the tree.
 */

import { defineBrowserModule } from "@langwatch/browser";

import { langyApi } from "./behavior/langy-api.ts";
import { langyGuidedOnboarding } from "./behavior/langy-guided-onboarding.capability.ts";
// Declares the `langy:` slices at install, so other modules read them from first paint.
import "./behavior/langy-context-target.store.ts";
import "./behavior/langy-page-context.store.ts";
import "./behavior/langy-registrations.store.ts";

export const langyWeb = defineBrowserModule("langy")
  .withApi(langyApi)
  // Path-less: the route table nests every project and settings page under
  // it, so the panel and its provider survive navigation between them.
  .withScreens({
    "layouts/project-langy": {
      load: () => import("./features/langy/ui/sections/project-langy-layout.tsx"),
    },
  })
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
