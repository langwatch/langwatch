/**
 * What a browser installs when it installs coding-agent: no screen of its
 * own — user and trace mount its activity tables, identity and metrics
 * surfaces inline.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

/** What another module may mount. user and trace read all four today. */
export const codingAgentWeb = defineWebModule("coding-agent").publishSurfaces({
  "surfaces/activity": { load: () => import("./activity.ts") },
  "surfaces/agent-identity": { load: () => import("./agent-identity.ts") },
  "surfaces/agent-metrics": { load: () => import("./agent-metrics.ts") },
  "surfaces/agent-traces": { load: () => import("./agent-traces.ts") },
});
