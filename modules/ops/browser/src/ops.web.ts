/**
 * What a browser installs when it installs ops: the drawers the address bar
 * opens (`?drawer.open=<name>`), under the names the product has always
 * used.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const opsWeb = defineWebModule("ops").withDrawers({
  opsGroupDetail: {
    load: async () => ({
      default: (await import("./features/queue/ui/sections/group-detail-drawer.tsx"))
        .GroupDetailDrawer,
    }),
  },
  opsProcessInstance: {
    load: async () => ({
      default: (await import("./features/event-store/ui/sections/process-instance-drawer.tsx"))
        .ProcessInstanceDrawer,
    }),
  },
  opsProcessInstances: {
    load: async () => ({
      default: (await import("./features/event-store/ui/sections/process-instances-drawer.tsx"))
        .ProcessInstancesDrawer,
    }),
  },
  opsBlobs: {
    load: async () => ({
      default: (await import("./features/blob-store/ui/sections/ops-blobs-drawer.tsx"))
        .OpsBlobsDrawer,
    }),
  },
  opsReplay: {
    load: async () => ({
      default: (await import("./features/event-store/ui/sections/ops-replay-drawer.tsx"))
        .OpsReplayDrawer,
    }),
  },
  foundry: {
    load: async () => ({
      default: (await import("./features/foundry/ui/sections/foundry-drawer.tsx")).FoundryDrawer,
    }),
  },
});
