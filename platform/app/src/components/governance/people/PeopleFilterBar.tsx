import { Box } from "@chakra-ui/react";
import { Building2, CalendarDays } from "lucide-react";

import {
  FilterChip,
  FilterChipRow,
  SortChip,
  TIME_FRAMES,
  type TimeFrame,
  timeFrameLabel,
} from "~/components/governance/filters";
import { MenuItem } from "~/components/ui/menu";
import type { SpendSortField } from "~/hooks/useSpendSortParam";

/**
 * Every choice the People table offers, in one row under the page header: how
 * far back it looks, which department it shows, and what it ranks by.
 *
 * One row rather than three places, because all three change the same table and
 * splitting them puts controls that do the same job on opposite sides of the
 * screen. The pills are the section's own `FilterChip`, so a reader who learned
 * the control on Costs has already learned this one.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
export function PeopleFilterBar({
  frame,
  onFrameChange,
  department,
  departments,
  onDepartmentChange,
  sortBy,
  onSortChange,
}: {
  frame: TimeFrame;
  onFrameChange: (next: TimeFrame) => void;
  /** `null` is every department. */
  department: string | null;
  /** The departments any row on the table actually shows. */
  departments: readonly string[];
  onDepartmentChange: (next: string | null) => void;
  sortBy: SpendSortField;
  onSortChange: (next: SpendSortField) => void;
}) {
  const sortOptions: Array<{ key: SpendSortField; label: string }> = [
    { key: "spend", label: "Spend" },
    { key: "requests", label: "Requests" },
    { key: "lastActivity", label: "Last active" },
  ];
  const sortLabel =
    sortOptions.find((option) => option.key === sortBy)?.label ?? "Spend";

  return (
    <Box data-testid="people-filter-row">
      <FilterChipRow>
        <FilterChip
          icon={<CalendarDays size={12} />}
          label="Time frame"
          value={timeFrameLabel(frame)}
        >
          {TIME_FRAMES.map((option) => (
            <MenuItem
              key={option.value}
              value={option.value}
              onClick={() => onFrameChange(option.value)}
            >
              {option.label}
            </MenuItem>
          ))}
        </FilterChip>

        <FilterChip
          icon={<Building2 size={12} />}
          label="Department"
          value={department ?? "All departments"}
          // Nothing to choose between until a row shows a department: an enabled
          // chip whose only option is the one already selected is a control that
          // teaches the reader it does nothing.
          disabled={departments.length === 0}
        >
          <MenuItem value="__all__" onClick={() => onDepartmentChange(null)}>
            All departments
          </MenuItem>
          {departments.map((name) => (
            <MenuItem
              key={name}
              value={name}
              onClick={() => onDepartmentChange(name)}
            >
              {name}
            </MenuItem>
          ))}
        </FilterChip>

        <SortChip value={sortLabel}>
          {sortOptions.map((option) => (
            <MenuItem
              key={option.key}
              value={option.key}
              onClick={() => onSortChange(option.key)}
            >
              {option.label}
            </MenuItem>
          ))}
        </SortChip>
      </FilterChipRow>
    </Box>
  );
}
