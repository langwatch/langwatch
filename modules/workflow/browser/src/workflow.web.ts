/**
 * What a browser installs when it installs workflow: the workflow list, the
 * Optimization Studio, and the workflow chat.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const workflowWeb = defineWebModule("workflow")
  .withHosts({
    requires: ["WorkflowHostApi"],
    mounts: { WorkflowHostApi: { load: () => import("./behavior/workflow-host-mount.tsx") } },
  })
  .withScreens({
    "pages/[project]/workflows": {
      load: () => import("./ui/sections/workflows/workflows-screen.tsx"),
    },
    "pages/[project]/studio/[workflow]": {
      load: () => import("./ui/sections/workflows/studio-screen.tsx"),
    },
    "pages/[project]/chat/[workflow]": {
      load: () => import("./ui/sections/workflows/workflow-chat-screen.tsx"),
    },
  })
  /** Lent under §3.4 rule 7: to evaluator, and run-via-api plus the version badge to experiment. */
  .withCapabilities({
    hoverableBigText: {
      load: async () => ({
        default: (await import("./ui/sections/hoverable-big-text.tsx")).HoverableBigText,
      }),
    },
    redactedField: {
      load: async () => ({
        default: (await import("./ui/sections/redacted-field.tsx")).RedactedField,
      }),
    },
    runExperimentViaApiDialog: {
      load: async () => ({
        default: (await import("./ui/sections/run-via-api/run-experiment-via-api-dialog.tsx"))
          .RunExperimentViaApiDialog,
      }),
    },
    versionBox: {
      load: async () => ({
        default: (await import("./ui/sections/optimization_studio/history.tsx")).VersionBox,
      }),
    },
  });
