/**
 * What a browser installs when it installs trace: the Trace Explorer, the
 * public share page, and the drawer the address bar opens
 * (`?drawer.open=<name>`) under the name the product has always used.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const traceWeb = defineWebModule("trace")
  .withHosts({
    requires: ["TraceHostApi"],
    mounts: { TraceHostApi: { load: () => import("./behavior/trace-host-mount.tsx") } },
  })
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
  })
  /** Trace UI that reads trace's own data, lent to the modules that show it (§3.4 rule 7). */
  .withCapabilities({
    annotationQueueConversation: {
      load: async () => ({
        default: (await import("./ui/sections/annotation-queue/annotation-queue-conversation.tsx"))
          .AnnotationQueueConversation,
      }),
    },
    renderInputOutput: {
      load: async () => ({
        default: (await import("./ui/sections/traces/render-input-output.tsx")).RenderInputOutput,
      }),
    },
    setupWithAgentButton: {
      load: async () => ({
        default: (await import("./ui/sections/setup-with-agent-button.tsx")).SetupWithAgentButton,
      }),
    },
    traceEditButton: {
      load: async () => ({
        default: (await import("./ui/sections/annotation-queue/trace-edit-button.tsx"))
          .TraceEditButton,
      }),
    },
    traceIdPeek: {
      load: async () => ({
        default: (await import("./ui/sections/explorer/trace-id-peek.tsx")).TraceIdPeek,
      }),
    },
    tracePreviewHoverCard: {
      load: async () => ({
        default: (await import("./ui/sections/explorer/trace-id-peek.tsx")).TracePreviewHoverCard,
      }),
    },
  });
