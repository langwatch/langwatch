/**
 * The connected-agent row, as another feature renders it: the Agents screen
 * owns the page, but the scenario editor and agent-testing dialog also put
 * the row and its vocabulary in front of the reader, through this door.
 */

export {
  AgentCard,
  AgentCardIcon,
  AgentCardMenuTrigger,
  AgentCardShell,
  type AgentCardShellProps,
  CARD_MENU_CLASS,
} from "./ui/blocks/agent-card.tsx";
export { ConnectedAgentsSection } from "./ui/blocks/connected-agents-section.tsx";
export type { ConnectedAgentBrowser } from "./model/agent-client.ts";
export {
  type ConnectedAgentScope,
  environmentTone,
  instanceCountLabel,
  isConnectedAgent,
  presenceLabel,
  scopeOf,
  sdkLabel,
  sortConnectedAgents,
} from "./model/connected-agent-rows.ts";
