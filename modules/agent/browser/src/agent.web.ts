/**
 * What a browser installs when it installs agent: the drawers the address
 * bar opens (`?drawer.open=<name>`). `agentVoiceEditor` is not declared —
 * no wrapper for it has been ported to this branch yet.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const agentWeb = defineWebModule("agent").withDrawers({
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
      default: (await import("./ui/sections/workflow-selector-drawer.tsx")).WorkflowSelectorDrawer,
    }),
  },
});
