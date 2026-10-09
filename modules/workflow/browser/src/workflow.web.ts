/**
 * What a browser installs when it installs workflow: the workflow list, the
 * Optimization Studio, and the workflow chat.
 */

import { defineBrowserModule } from "@langwatch/browser";
import {
  HoverableBigTextToken,
  RedactedFieldToken,
  RunExperimentViaApiDialogToken,
  VersionBoxToken,
} from "@langwatch/workflow-client";
import { workflowOptimizationTrpc, workflowTrpc } from "@langwatch/workflow-contract";

import { workflowApi } from "./behavior/workflow-api.ts";

export const workflowWeb = defineBrowserModule("workflow")
  .withApi(workflowApi, { contracts: [workflowTrpc, workflowOptimizationTrpc] })
  .withHosts({
    requires: ["WorkflowHostApi"],
    mounts: { WorkflowHostApi: { load: () => import("./behavior/workflow-host-mount.tsx") } },
  })
  .withScreens({
    "pages/[project]/workflows": {
      load: () => import("./ui/sections/workflows/workflows-screen.tsx"),
      requires: "workflows:view",
    },
    "pages/[project]/studio/[workflow]": {
      load: () => import("./ui/sections/workflows/studio-screen.tsx"),
    },
    "pages/[project]/chat/[workflow]": {
      load: () => import("./ui/sections/workflows/workflow-chat-screen.tsx"),
    },
  })
  /** Lent by token (§10.1): clamped text and the redaction marker to evaluator and experiment. */
  .lends(HoverableBigTextToken, {
    load: async () => ({
      default: (await import("./ui/sections/hoverable-big-text.tsx")).HoverableBigText,
    }),
  })
  .lends(RedactedFieldToken, {
    load: async () => ({
      default: (await import("./ui/sections/redacted-field.tsx")).RedactedField,
    }),
  })
  .lends(VersionBoxToken, {
    load: async () => ({
      default: (await import("./ui/sections/optimization_studio/history.tsx")).VersionBox,
    }),
  })
  .lends(RunExperimentViaApiDialogToken, {
    load: async () => ({
      default: (await import("./ui/sections/run-via-api/run-experiment-via-api-dialog.tsx"))
        .RunExperimentViaApiDialog,
    }),
  });
