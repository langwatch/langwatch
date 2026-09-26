/**
 * What a browser installs when it installs agent: the drawers the address
 * bar opens (`?drawer.open=<name>`).
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const agentWeb = defineWebModule("agent")
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
        default: (await import("./ui/sections/agent-code-editor-drawer.tsx")).AgentCodeEditorDrawer,
      }),
    },
    agentHttpEditor: {
      load: async () => ({
        default: (await import("./ui/sections/agent-http-editor-drawer.tsx")).AgentHttpEditorDrawer,
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
        default: (await import("./ui/sections/connected-agent-drawer.tsx")).ConnectedAgentDrawer,
      }),
    },
    agentConnectFromCode: {
      load: async () => ({
        default: (await import("./ui/sections/connect-from-code-drawer.tsx")).ConnectFromCodeDrawer,
      }),
    },
    agentWorkflowEditor: {
      load: async () => ({
        default: (await import("./ui/sections/agent-workflow-editor-drawer.tsx"))
          .AgentWorkflowEditorDrawer,
      }),
    },
    agentWorkflowTargetEditor: {
      load: async () => ({
        default: (await import("./ui/sections/agent-workflow-target-editor-drawer.tsx"))
          .AgentWorkflowTargetEditorDrawer,
      }),
    },
    workflowSelector: {
      load: async () => ({
        default: (await import("./ui/sections/workflow-selector-drawer.tsx"))
          .WorkflowSelectorDrawer,
      }),
    },
  });
