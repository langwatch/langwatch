import { MenuItem } from "@langwatch/design-system/menu";
import { Plug, UserRoundX } from "lucide-react";

import { FilterChip, FilterChipRow, SortChip } from "../../ui/elements/governance-filter-chip.tsx";
import {
  AGENT_SORT_LABELS,
  AGENT_SORTS,
  type AgentFilters,
  ALL_SOURCES,
  OWNERSHIP_FILTERS,
  OWNERSHIP_LABELS,
  sourceLabel,
} from "./agent-filters";
import { AGENT_SOURCE_LABELS, type AgentSource } from "./agent-rows";

/**
 * The Agents filter row: source, ownership, sort, on the section's `FilterChip`. `sources` lists
 * only sources present in the rows, so no chip leads to an empty page.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */
export function AgentFilterBar({
  filters,
  sources,
  onSourceChange,
  onOwnershipChange,
  onSortChange,
}: {
  filters: AgentFilters;
  sources: AgentSource[];
  onSourceChange: (value: AgentFilters["source"]) => void;
  onOwnershipChange: (value: AgentFilters["ownership"]) => void;
  onSortChange: (value: AgentFilters["sort"]) => void;
}) {
  return (
    <FilterChipRow>
      <FilterChip icon={<Plug size={12} />} label="Source" value={sourceLabel(filters.source)}>
        <MenuItem value={ALL_SOURCES} onClick={() => onSourceChange("all")}>
          All sources
        </MenuItem>
        {sources.map((source) => (
          <MenuItem key={source} value={source} onClick={() => onSourceChange(source)}>
            {AGENT_SOURCE_LABELS[source]}
          </MenuItem>
        ))}
      </FilterChip>

      <FilterChip
        icon={<UserRoundX size={12} />}
        label="Ownership"
        value={OWNERSHIP_LABELS[filters.ownership]}
      >
        {OWNERSHIP_FILTERS.map((option) => (
          <MenuItem key={option} value={option} onClick={() => onOwnershipChange(option)}>
            {OWNERSHIP_LABELS[option]}
          </MenuItem>
        ))}
      </FilterChip>

      <SortChip value={AGENT_SORT_LABELS[filters.sort]}>
        {AGENT_SORTS.map((option) => (
          <MenuItem key={option} value={option} onClick={() => onSortChange(option)}>
            {AGENT_SORT_LABELS[option]}
          </MenuItem>
        ))}
      </SortChip>
    </FilterChipRow>
  );
}
