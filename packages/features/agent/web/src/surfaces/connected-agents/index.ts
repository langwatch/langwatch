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
} from "../../features/management/ui/blocks/agent-card";
export { ConnectedAgentsSection } from "../../features/management/ui/blocks/connected-agents-section";
export {
  type ConnectedAgentScope,
  environmentTone,
  instanceCountLabel,
  isConnectedAgent,
  presenceLabel,
  scopeOf,
  sdkLabel,
  sortConnectedAgents,
} from "../../model/connected-agent-rows";
