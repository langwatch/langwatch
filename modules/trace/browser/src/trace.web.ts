/**
 * What a browser installs when it installs trace: the Trace Explorer, the
 * public share page, and the drawer the address bar opens
 * (`?drawer.open=<name>`) under the name the product has always used.
 */

import { defineBrowserModule } from "@langwatch/browser";
import {
  AgentActionsMenuToken,
  AnnotationQueueConversationToken,
  ConversationThreadToken,
  RenderInputOutputToken,
  SetupWithAgentButtonToken,
  TraceEditButtonToken,
  TraceIdPeekToken,
  TracePreviewHoverCardToken,
} from "@langwatch/trace-client";

// Declare the `trace:` slices at install, so langy and annotation read them from first paint.
import "./behavior/annotation-queue-session.store.ts";
import "./behavior/explorer-scope.slice.ts";

export const traceWeb = defineBrowserModule("trace")
  .withHosts({
    requires: ["TraceHostApi"],
    mounts: { TraceHostApi: { load: () => import("./behavior/trace-host-mount.tsx") } },
  })
  .withScreens({
    // Path-less: the route table nests every chrome page under it.
    "layouts/trace-drawer": {
      load: () => import("./ui/sections/explorer/trace-drawer-layout.tsx"),
    },
    "pages/[project]/traces": {
      requires: "traces:view",
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
    // Kept so links naming the removed legacy drawer still resolve to the Trace Explorer one.
    traceDetails: {
      load: async () => ({
        default: (await import("./ui/sections/legacy-trace-drawer-redirect.tsx"))
          .LegacyTraceDrawerRedirect,
      }),
    },
  })
  /** Held: evaluator's traces mapping and the presence menu item still travel by name. */
  .withCapabilities({
    evaluatorTracesMapping: {
      load: async () => ({
        default: (await import("./ui/sections/evaluations/evaluator-traces-mapping.tsx"))
          .EvaluatorTracesMapping,
      }),
    },
    presenceMenuItem: {
      load: async () => ({
        default: (await import("./ui/sections/presence/presence-menu-item.tsx")).PresenceMenuItem,
      }),
    },
  })
  /** Trace UI that reads trace's own data, lent to the modules that show it (§10.1). */
  .lends(AgentActionsMenuToken, {
    load: async () => ({
      default: (await import("./ui/sections/setup-with-agent-button.tsx")).AgentActionsMenu,
    }),
  })
  .lends(ConversationThreadToken, {
    load: async () => ({
      default: (await import("./ui/sections/conversation/conversation-thread.tsx"))
        .ConversationThread,
    }),
  })
  .lends(TracePreviewHoverCardToken, {
    load: async () => ({
      default: (await import("./ui/sections/explorer/trace-id-peek.tsx")).TracePreviewHoverCard,
    }),
  })
  .lends(RenderInputOutputToken, {
    load: async () => ({
      default: (await import("./ui/sections/traces/render-input-output.tsx")).RenderInputOutput,
    }),
  })
  .lends(TraceIdPeekToken, {
    load: async () => ({
      default: (await import("./ui/sections/explorer/trace-id-peek.tsx")).TraceIdPeek,
    }),
  })
  .lends(SetupWithAgentButtonToken, {
    load: async () => ({
      default: (await import("./ui/sections/setup-with-agent-button.tsx")).SetupWithAgentButton,
    }),
  })
  .lends(AnnotationQueueConversationToken, {
    load: async () => ({
      default: (await import("./ui/sections/annotation-queue/annotation-queue-conversation.tsx"))
        .AnnotationQueueConversation,
    }),
  })
  .lends(TraceEditButtonToken, {
    load: async () => ({
      default: (await import("./ui/sections/annotation-queue/trace-edit-button.tsx"))
        .TraceEditButton,
    }),
  });
