/**
 * The connected-agent row, as another feature renders it.
 *
 * The Agents screen owns the page; the row, its card and the vocabulary that
 * names a connection are what the scenario editor and the agent-testing dialog
 * put in front of the reader, so they are a door of their own rather than a
 * reach into the screen.
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
