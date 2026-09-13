/**
 * The Agents page's own parts: the list and the card the fleet is drawn as,
 * the switch between them, the filter row, the register dialog, and the
 * invented rows that fill an empty page.
 *
 * This is a barrel over a directory, not a re-export of code that lives
 * elsewhere: nothing behind it has another home.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
// `AgentFigure` is deliberately absent. It is the plumbing the card and the
// table share so the two cannot format a number or word a dash differently,
// and it is theirs: both import it directly, and nothing outside this
// directory has any business rendering one figure of an agent.
export { AgentCard } from "./AgentCard";
export { AgentFilterBar } from "./AgentFilterBar";
export { AgentFleetSummaryStrip } from "./AgentFleetSummaryStrip";
export {
  type AgentsLayout,
  AgentsLayoutControl,
  AgentsList,
  DEFAULT_AGENTS_LAYOUT,
  isAgentsLayout,
} from "./AgentsList";
export { AGENT_TABLE_COLUMNS, AgentsTable } from "./AgentsTable";
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
  formatRegistered,
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
  agentsListedEmptyCopy,
  agentsRefusedCopy,
  agentsUnlistedCopy,
  type GovernanceEmptyStateCopy,
  NO_MATCHING_AGENTS_COPY,
} from "./emptyStates";
// `RegisterAgentDrawer` is deliberately absent. It is a registry drawer, and
// `drawerRegistry` imports it lazily by path so its chunk stays out of the
// initial bundle; re-exporting it here would pull it back in for every
// importer of this barrel.
