/**
 * What a browser installs when it installs trace: the Trace Explorer, the
 * public share page, and the drawer the address bar opens
 * (`?drawer.open=<name>`) under the name the product has always used.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const traceWeb = defineWebModule("trace")
  .withScreens({
    "pages/[project]/traces": {
      load: () => import("./ui/sections/traces/traces-screen.tsx"),
    },
    "pages/share/[id]": {
      load: () => import("./ui/sections/traces/shared-trace-screen.tsx"),
    },
  })
  .withDrawers({
    addDatasetRecord: {
      load: async () => ({
        default: (await import("./ui/sections/datasets/add-dataset-record-drawer.tsx"))
          .AddDatasetRecordDrawer,
      }),
    },
  });
