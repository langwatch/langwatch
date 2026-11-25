import { MenuItem } from "@langwatch/design-system/menu";
import {
  type AgentRegistryPosture,
  type AgentSource,
} from "@langwatch/enterprise-governance-contract";
import { Plug, ShieldCheck, UserRoundX } from "lucide-react";

import { FilterChip, FilterChipRow, SortChip } from "../../ui/elements/governance-filter-chip.tsx";
import {
  AGENT_POSTURE_LABELS,
  AGENT_SORT_LABELS,
  AGENT_SORTS,
  type AgentFilters,
  ALL_POSTURES,
  ALL_SOURCES,
  OWNERSHIP_FILTERS,
  OWNERSHIP_LABELS,
  postureLabel,
  sourceLabel,
} from "./agent-filters";
import { AGENT_SOURCE_LABELS } from "./agent-rows";

/**
 * The Agents filter row: source, posture, ownership, sort, on the section's `FilterChip`.
 * `sources` and `postures` list only what the rows hold, so no chip leads to an empty page.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */
export function AgentFilterBar({
  filters,
  sources,
  postures,
  onSourceChange,
  onPostureChange,
  onOwnershipChange,
  onSortChange,
}: {
  filters: AgentFilters;
  sources: AgentSource[];
  postures: AgentRegistryPosture[];
  onSourceChange: (value: AgentFilters["source"]) => void;
  onPostureChange: (value: AgentFilters["posture"]) => void;
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

      {(postures.length > 0 || filters.posture !== ALL_POSTURES) && (
        <FilterChip
          icon={<ShieldCheck size={12} />}
          label="Posture"
          value={postureLabel(filters.posture)}
        >
          <MenuItem value={ALL_POSTURES} onClick={() => onPostureChange(ALL_POSTURES)}>
            All postures
          </MenuItem>
          {postures.map((posture) => (
            <MenuItem key={posture} value={posture} onClick={() => onPostureChange(posture)}>
              {AGENT_POSTURE_LABELS[posture]}
            </MenuItem>
          ))}
        </FilterChip>
      )}

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
