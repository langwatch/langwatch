/**
 * The Agents page's own parts: list, card, layout switch, filter row, register drawer and sample
 * rows. A barrel over this directory only.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */

// `AgentFigure` is deliberately absent: it is the card's and table's shared plumbing, imported
// directly.
export { AgentCard } from "./agent-card";
export { AgentFilterBar } from "./agent-filter-bar";
export { AgentFleetSummaryStrip } from "./agent-fleet-summary-strip";
export {
  type AgentsLayout,
  AgentsLayoutControl,
  AgentsList,
  DEFAULT_AGENTS_LAYOUT,
  isAgentsLayout,
} from "./agents-list";
export { AGENT_TABLE_COLUMNS, AgentsTable } from "./agents-table";
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
} from "./agent-filters";
export {
  AGENT_HEALTH_LABELS,
  AGENT_SOURCE_LABELS,
  formatLastActive,
  formatRegistered,
  SAMPLE_AGENT_ROWS,
} from "./agent-rows";
export {
  type AgentFleetCount,
  type AgentFleetSummary,
  type AgentSpendLine,
  type AgentStatusLine,
  summarizeAgentFleet,
} from "./agent-summary";
export {
  AGENTS_EMPTY_COPY,
  agentsListedEmptyCopy,
  agentsRefusedCopy,
  agentsUnlistedCopy,
  type GovernanceEmptyStateCopy,
  NO_MATCHING_AGENTS_COPY,
} from "./empty-states";
// `RegisterAgentDrawer` is deliberately absent. It is a registry drawer, and
// `drawerRegistry` imports it lazily by path so its chunk stays out of the
// initial bundle; re-exporting it here would pull it back in for every
// importer of this barrel.
