/**
 * What a browser installs when it installs agent: the drawers the address
 * bar opens (`?drawer.open=<name>`).
 */

import { defineBrowserModule } from "@langwatch/browser";

export const agentWeb = defineBrowserModule("agent")
  .withHosts({
    requires: ["AgentManagementHostApi"],
    mounts: {
      AgentManagementHostApi: {
        load: () => import("./behavior/agent-management-host-mount.tsx"),
      },
    },
  })
  .withScreens({
    // The application's table still names this page by its monolith key; the
    // loader is this module's either way.
    "runtime/ui/features/agent-ui-host.adapter": {
      requires: "evaluations:view",
      load: () => import("./ui/sections/agent-management-screen.tsx"),
    },
  })
  .withDrawers({
    agentList: {
      load: async () => ({
        default: (await import("./ui/sections/agent-list-drawer.tsx")).AgentListDrawer,
      }),
    },
    agentHistory: {
      load: async () => ({
        default: (await import("./ui/sections/agent-history-drawer.tsx")).AgentHistoryDrawer,
      }),
    },
    agentTypeSelector: {
      load: async () => ({
        default: (await import("./ui/sections/agent-type-selector-drawer.tsx"))
          .AgentTypeSelectorDrawer,
      }),
    },
    agentCodeEditor: {
      load: async () => ({
        default: (await import("./ui/sections/routed-agent-drawers.tsx"))
          .RoutedAgentCodeEditorDrawer,
      }),
    },
    agentHttpEditor: {
      load: async () => ({
        default: (await import("./ui/sections/routed-agent-drawers.tsx"))
          .RoutedAgentHttpEditorDrawer,
      }),
    },
    agentVoiceEditor: {
      load: async () => ({
        default: (await import("./features/voice-editor/ui/sections/agent-voice-editor-drawer.tsx"))
          .AgentVoiceEditorDrawer,
      }),
    },
    agentConnectedDetail: {
      load: async () => ({
        default: (await import("./ui/sections/routed-agent-drawers.tsx"))
          .RoutedConnectedAgentDrawer,
      }),
    },
    agentConnectFromCode: {
      load: async () => ({
        default: (await import("./ui/sections/routed-agent-drawers.tsx"))
          .RoutedConnectFromCodeDrawer,
      }),
    },
    agentWorkflowEditor: {
      load: async () => ({
        default: (await import("./ui/sections/routed-agent-drawers.tsx"))
          .RoutedAgentWorkflowEditorDrawer,
      }),
    },
    agentWorkflowTargetEditor: {
      load: async () => ({
        default: (await import("./ui/sections/routed-agent-drawers.tsx"))
          .RoutedAgentWorkflowTargetEditorDrawer,
      }),
    },
    workflowSelector: {
      load: async () => ({
        default: (await import("./ui/sections/routed-agent-drawers.tsx"))
          .RoutedWorkflowSelectorDrawer,
      }),
    },
  })
  /** The HTTP agent's configuration editor, lent to the studio's panels (§3.4 rule 7). */
  .withCapabilities({
    httpConfigEditor: {
      load: async () => ({
        default: (await import("./ui/sections/http-config-editor.tsx")).HttpConfigEditor,
      }),
    },
  });
