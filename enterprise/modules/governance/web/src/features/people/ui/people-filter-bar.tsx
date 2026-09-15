// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Box, Text } from "@chakra-ui/react";
import { Building2 } from "lucide-react";

import { Menu } from "@langwatch/design-system/menu";

import {
  FilterChip,
  FilterChipRow,
  SortChip,
} from "../../../ui/elements/governance-filter-chip.tsx";
import type { SpendSortField } from "@langwatch/enterprise-governance-contract";

/**
 * Both choices the People table offers, in one row under the page header:
 * which department it shows, and what it ranks by. There is no time-frame
 * chip — the identity half of the table carries no window at all, so the
 * spend read's fixed window (`SPEND_WINDOW_DAYS`) is stated on the table's
 * headings and in this menu instead of implying the reader chose it.
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
          // Nothing to choose between until a row shows a department.
          disabled={departments.length === 0}
        >
          <Menu.Item value="__all__" onClick={() => onDepartmentChange(null)}>
            All departments
          </Menu.Item>
          {departments.map((name) => (
            <Menu.Item
              key={name}
              value={name}
              onClick={() => onDepartmentChange(name)}
            >
              {name}
            </Menu.Item>
          ))}
        </FilterChip>

        <SortChip value={sortLabel}>
          {sortOptions.map((option) => (
            <Menu.Item
              key={option.key}
              value={option.key}
              onClick={() => onSortChange(option.key)}
            >
              {option.label}
            </Menu.Item>
          ))}
          {/* Not a choice, so not a Menu.Item: it is how far whichever choice
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
