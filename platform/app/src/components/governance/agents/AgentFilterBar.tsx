import { Plug, UserRoundX } from "lucide-react";

import {
  FilterChip,
  FilterChipRow,
  SortChip,
} from "~/components/governance/filters";
import { MenuItem } from "~/components/ui/menu";

import {
  AGENT_SORT_LABELS,
  AGENT_SORTS,
  type AgentFilters,
  ALL_SOURCES,
  OWNERSHIP_FILTERS,
  OWNERSHIP_LABELS,
  sourceLabel,
} from "./agentFilters";
import { AGENT_SOURCE_LABELS, type AgentSource } from "./agentRows";

/**
 * The Agents page's filter row: source, ownership, sort, in that order, in one
 * row under the header. Every chip is the section's `FilterChip`, so the page
 * reads as the same screen as Costs rather than a cousin of it.
 *
 * `sources` is the list actually present in the rows on screen, not the full
 * enumeration — a chip that offers a source the organization does not use
 * takes the reader to an empty page and tells them nothing.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
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
      <FilterChip
        icon={<Plug size={12} />}
        label="Source"
        value={sourceLabel(filters.source)}
      >
        <MenuItem value={ALL_SOURCES} onClick={() => onSourceChange("all")}>
          All sources
        </MenuItem>
        {sources.map((source) => (
          <MenuItem
            key={source}
            value={source}
            onClick={() => onSourceChange(source)}
          >
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
          <MenuItem
            key={option}
            value={option}
            onClick={() => onOwnershipChange(option)}
          >
            {OWNERSHIP_LABELS[option]}
          </MenuItem>
        ))}
      </FilterChip>

      <SortChip value={AGENT_SORT_LABELS[filters.sort]}>
        {AGENT_SORTS.map((option) => (
          <MenuItem
            key={option}
            value={option}
            onClick={() => onSortChange(option)}
          >
            {AGENT_SORT_LABELS[option]}
          </MenuItem>
        ))}
      </SortChip>
    </FilterChipRow>
  );
}
