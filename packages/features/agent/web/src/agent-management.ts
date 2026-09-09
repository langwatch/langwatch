import type { ComponentType } from "react";

export type AgentScreenLoader = () => Promise<{ default: ComponentType }>;

export const agentScreens = {
  agentManagement: () => import("./ui/sections/agent-management-screen.tsx"),
} as const satisfies Record<string, AgentScreenLoader>;

export type AgentScreenName = keyof typeof agentScreens;

export { agentApi } from "./behavior/agent-api.ts";
export {
  type AgentManagementHost,
  AgentManagementHostProvider,
  type AgentCopyTarget,
  type AgentEditorDrawer,
  type AgentFailureNotice,
  type AgentHostProject,
  type AgentRouteReading,
  type AgentSuccessNotice,
} from "./model/agent-management-host.ts";
export {
  AgentTypeSelectorDrawer,
  type AgentType,
  type AgentTypeSelectorDrawerProps,
} from "./ui/sections/agent-type-selector-drawer.tsx";
