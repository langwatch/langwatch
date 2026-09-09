import { Box, Text } from "@chakra-ui/react";
import { Building2 } from "lucide-react";

import {
  FilterChip,
  FilterChipRow,
  SortChip,
} from "~/components/governance/filters";
import { MenuItem } from "~/components/ui/menu";
import type { SpendSortField } from "~/hooks/useSpendSortParam";

/**
 * Both choices the People table offers, in one row under the page header: which
 * department it shows, and what it ranks by.
 *
 * One row rather than two places, because both change the same table and
 * splitting them puts controls that do the same job on opposite sides of the
 * screen. The pills are the section's own `FilterChip`, so a reader who learned
 * the control on Costs has already learned this one.
 *
 * There is no time-frame chip. It used to sit first here, and it did not
 * correlate to the table: the people the connected providers named carry no
 * window at all, so narrowing the frame moved the metered rows and left the
 * rest untouched. The spend read still has a window, fixed at a year
 * (`SPEND_WINDOW_DAYS`), and the table's Spend and Requests headings say so.
 *
 * The sort has the same half-reaching problem and it is still a control the
 * reader can set, so the limit is written into the sort menu: it drives the
 * spend read, so it ranks the rows that read returned, and everybody a
 * connected source merely named keeps their own order however the chip is set.
 * Ranking both halves needs a read that measures both, which is not this
 * screen's to build. A reader who picks "Last active" and watches a third of
 * the rows stay put reads why in the menu they just used, instead of concluding
 * the control is broken.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
export function PeopleFilterBar({
  department,
  departments,
  onDepartmentChange,
  sortBy,
  onSortChange,
}: {
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
          {/* Not a choice, so not a MenuItem: it is how far whichever choice
              they make actually reaches. */}
          <Text
            fontSize="xs"
            color="fg.subtle"
            paddingX={2}
            paddingY={1.5}
            borderTopWidth="1px"
            borderColor="border.muted"
          >
            Ranks the people with measured spend. Anyone a connected source
            named but nothing measured follows, most recently seen first.
          </Text>
        </SortChip>
      </FilterChipRow>
    </Box>
  );
}
