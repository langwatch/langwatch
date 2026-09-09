/**
 * The Agents page's own parts: the card, the filter row, the register dialog,
 * and the invented rows that fill an empty page.
 *
 * This is a barrel over a directory, not a re-export of code that lives
 * elsewhere: nothing behind it has another home.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
export { AgentCard } from "./AgentCard";
export { AgentFilterBar } from "./AgentFilterBar";
export { AgentFleetSummaryStrip } from "./AgentFleetSummaryStrip";
export {
  AGENT_SORT_LABELS,
  AGENT_SORTS,
  type AgentFilters,
  type AgentSort,
  ALL_SOURCES,
  applyAgentFilters,
  coerceOwnership,
  coerceSort,
  coerceSource,
  DEFAULT_AGENT_FILTERS,
  OWNERSHIP_FILTERS,
  OWNERSHIP_LABELS,
  type OwnershipFilter,
  type SourceFilter,
  sourceLabel,
  sourcesPresentIn,
  useAgentFilters,
} from "./agentFilters";
export {
  AGENT_HEALTH_LABELS,
  AGENT_HEALTH_STATES,
  AGENT_SOURCE_LABELS,
  AGENT_SOURCES,
  type AgentHealth,
  type AgentSource,
  formatLastActive,
  type GovernanceAgentRow,
  SAMPLE_AGENT_ROWS,
} from "./agentRows";
export {
  type AgentFleetCount,
  type AgentFleetSummary,
  type AgentSpendLine,
  type AgentStatusLine,
  summarizeAgentFleet,
} from "./agentSummary";
export {
  AGENTS_EMPTY_COPY,
  APPLICATIONS_EMPTY_COPY,
  type GovernanceEmptyStateCopy,
  NO_MATCHING_AGENTS_COPY,
} from "./emptyStates";
export { RegisterAgentDialog } from "./RegisterAgentDialog";
