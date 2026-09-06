/**
 * The Agents family, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes for the
 * page itself is a LOADER rather than a component, because the screen drags
 * three dialogs, two overlays and the card menu behind it and none of that
 * belongs in the chunk that renders the rest of the application.
 *
 * ONE SCREEN, ONE ADDRESS: `/:project/agents`.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC
 * Provider this package's hooks run on, and the host port that answers for the
 * project, the browser transport, the replication targets, the address and the
 * two notices.
 *
 * THE REST OF THIS ENTRY IS NOT THE SCREEN. The HTTP editor's presentation and
 * its building blocks, and the agent type selector, are still composed by
 * `platform/app`'s drawer registry for the scenario editor, the experiments
 * workbench and the agent-testing dialog; they are exported here because that
 * registry is where those overlays are mounted, and they stay until those
 * surfaces move too.
 */

import type { ComponentType } from "react";

export type AgentScreenLoader = () => Promise<{ default: ComponentType }>;

export const agentScreens = {
  agentManagement: () => import("./agent-management.screen.tsx"),
} as const satisfies Record<string, AgentScreenLoader>;

export type AgentScreenName = keyof typeof agentScreens;

export {
  AGENT_HISTORY_QUERY_KEY,
  AGENT_NEW_QUERY_KEY,
  AGENT_NEW_QUERY_VALUE,
} from "./agent-management.screen.tsx";
export { agentApi } from "../../behavior/agent-api.ts";
export {
  AgentManagementHostPort,
  AgentManagementHostProvider,
  type AgentCopyTarget,
  type AgentEditorDrawer,
  type AgentFailureNotice,
  type AgentHostProject,
  type AgentRouteReading,
  type AgentSuccessNotice,
} from "../../model/agent-management-host.ts";
export {
  AgentTypeSelectorDrawer,
  type AgentType,
  type AgentTypeSelectorDrawerProps,
} from "../../features/editor/ui/sections/agent-type-selector-drawer.tsx";
export {
  AgentCard,
  AgentCardIcon,
  AgentCardMenuTrigger,
  AgentCardShell,
  type AgentCardShellProps,
  CARD_MENU_CLASS,
} from "../../features/management/ui/blocks/agent-card.tsx";
export { ConnectedAgentsSection } from "../../features/management/ui/blocks/connected-agents-section.tsx";
export {
  type ConnectedAgentScope,
  environmentTone,
  instanceCountLabel,
  isConnectedAgent,
  presenceLabel,
  scopeOf,
  sdkLabel,
  sortConnectedAgents,
} from "../../model/connected-agent-rows.ts";
export { LocalTunnelBadge } from "../../ui/elements/local-tunnel-badge.tsx";
export {
  AgentHttpEditorDrawer,
  type AgentHttpEditorDrawerProps,
} from "../../features/http/ui/sections/agent-http-editor-drawer.tsx";
export {
  AgentHttpEditorPresentationPort,
  type RenderAgentVariablesInput,
  type RenderScenarioMappingsInput,
} from "../../features/http/ui/sections/agent-http-editor.presentation.tsx";
export {
  AuthConfigSection,
  type AuthConfigSectionProps,
} from "../../features/http/ui/elements/http-auth-config-section.tsx";
export {
  BodyTemplateEditor,
  type BodyTemplateEditorProps,
} from "../../features/http/ui/elements/http-body-template-editor.tsx";
export {
  HeadersConfigSection,
  type HeadersConfigSectionProps,
} from "../../features/http/ui/elements/http-headers-config-section.tsx";
export {
  HttpConfigEditor,
  type HttpConfigEditorProps,
} from "../../features/http/ui/sections/http-config-editor.tsx";
export {
  HttpMethodSelector,
  type HttpMethodSelectorProps,
} from "../../features/http/ui/elements/http-method-selector.tsx";
export {
  HttpTestPanel,
  type HttpTestPanelProps,
  type HttpTestResult,
} from "../../features/http/ui/sections/http-test-panel.tsx";
export {
  OutputPathInput,
  type HttpOutputPathInputProps,
} from "../../features/http/ui/elements/http-output-path-input.tsx";
export {
  messagesToJson,
  type TestMessage,
  TestMessagesBuilder,
  type TestMessagesBuilderProps,
} from "../../features/http/ui/blocks/http-test-messages-builder.tsx";
