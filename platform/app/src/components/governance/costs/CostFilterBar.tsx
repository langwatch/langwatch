import { Button, HStack, Text } from "@chakra-ui/react";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  Clock,
  Layers,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "~/components/ui/menu";

import {
  ALL_DEPARTMENTS,
  GROUP_BYS,
  type GroupBy,
  TIME_FRAMES,
  TIME_INTERVALS,
  type TimeInterval,
} from "./costsWindow";

/**
 * The filter row: one pill per choice, each showing its own name and the value
 * currently picked. Every chip here changes what the page renders — a chip
 * that only looked like a filter would be worse than no chip at all.
 */
function FilterChip({
  icon,
  label,
  value,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          borderRadius="full"
          paddingX={3}
          fontWeight="normal"
          colorPalette="purple"
        >
          <HStack gap={1.5}>
            {icon}
            <Text color="fg.muted">{label}</Text>
            <Text color="fg.muted">·</Text>
            <Text fontWeight="medium">{value}</Text>
            <ChevronDown size={12} />
          </HStack>
        </Button>
      </MenuTrigger>
      <MenuContent minWidth="180px">{children}</MenuContent>
    </MenuRoot>
  );
}

export function CostFilterBar({
  departmentName,
  departments,
  onDepartmentChange,
  windowDays,
  onWindowDaysChange,
  interval,
  onIntervalChange,
  groupBy,
  onGroupByChange,
}: {
  /** `null` when no single department is selected. */
  departmentName: string | null;
  departments: Array<{ id: string; name: string }>;
  onDepartmentChange: (value: string, name: string | null) => void;
  windowDays: number;
  onWindowDaysChange: (value: number) => void;
  interval: TimeInterval;
  onIntervalChange: (value: TimeInterval) => void;
  groupBy: GroupBy;
  onGroupByChange: (value: GroupBy) => void;
}) {
  // The selected name, not a lookup against the current window's options. A
  // department the reader picked can drop out of those options, and falling
  // back to "All departments" there would label a filtered panel as the whole
  // organisation's spend.
  const departmentLabel = departmentName ?? "All departments";
  const timeFrameLabel =
    TIME_FRAMES.find((f) => f.value === windowDays)?.label ??
    `Last ${windowDays} days`;
  const intervalLabel =
    TIME_INTERVALS.find((i) => i.value === interval)?.label ?? "Day";
  const groupByLabel =
    GROUP_BYS.find((g) => g.value === groupBy)?.label ?? "Team";

  return (
    <HStack gap={2} wrap="wrap">
      <FilterChip
        icon={<Building2 size={12} />}
        label="Department"
        value={departmentLabel}
      >
        <MenuItem
          value={ALL_DEPARTMENTS}
          onClick={() => onDepartmentChange(ALL_DEPARTMENTS, null)}
        >
          All departments
        </MenuItem>
        {departments.map((d) => (
          <MenuItem
            key={d.id}
            value={d.id}
            onClick={() => onDepartmentChange(d.id, d.name)}
          >
            {d.name}
          </MenuItem>
        ))}
      </FilterChip>

      <FilterChip
        icon={<CalendarDays size={12} />}
        label="Time Frame"
        value={timeFrameLabel}
      >
        {TIME_FRAMES.map((frame) => (
          <MenuItem
            key={frame.value}
            value={String(frame.value)}
            onClick={() => onWindowDaysChange(frame.value)}
          >
            {frame.label}
          </MenuItem>
        ))}
      </FilterChip>

      <FilterChip
        icon={<Clock size={12} />}
        label="Time Interval"
        value={intervalLabel}
      >
        {TIME_INTERVALS.map((option) => (
          <MenuItem
            key={option.value}
            value={option.value}
            onClick={() => onIntervalChange(option.value)}
          >
            {option.label}
          </MenuItem>
        ))}
      </FilterChip>

      <FilterChip
        icon={<Layers size={12} />}
        label="Group By"
        value={groupByLabel}
      >
        {GROUP_BYS.map((option) => (
          <MenuItem
            key={option.value}
            value={option.value}
            onClick={() => onGroupByChange(option.value)}
          >
            {option.label}
          </MenuItem>
        ))}
      </FilterChip>
    </HStack>
  );
}
