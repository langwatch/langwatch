import { Text } from "@chakra-ui/react";
import { Building2, CalendarDays, Clock } from "lucide-react";

import {
  FilterChip,
  FilterChipRow,
  isIntervalCoarserThanFrame,
  TIME_FRAMES,
  TIME_INTERVALS,
  type TimeFrame,
  type TimeInterval,
  timeFrameLabel,
  timeIntervalLabel,
} from "~/components/governance/filters";
import { MenuItem } from "~/components/ui/menu";

import { ALL_DEPARTMENTS } from "./costsWindow";

/**
 * The filter row: one pill per choice, each showing its own name and the value
 * currently picked. The pill itself is the section-wide `FilterChip`; every
 * chip here changes what the page renders — a chip that only looked like a
 * filter would be worse than no chip at all.
 *
 * Three chips, not four. Group By went: it named the series of exactly one
 * chart while sitting in a row that reads as filtering the page, and the chart
 * beside it ignored it, so the one lesson it taught was that a chip on this
 * page may or may not do anything. That chart is grouped by team and says so
 * in its own title, where a reader looking at it will actually see it.
 *
 * An interval wider than the frame is offered as disabled rather than removed
 * — the section-wide rule, so a reader learns why a choice is unavailable
 * instead of watching options appear and vanish under them.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *       specs/ai-governance/dashboard/governance-ui-controls.feature
 */
export function CostFilterBar({
  departmentName,
  departments,
  onDepartmentChange,
  frame,
  onFrameChange,
  interval,
  onIntervalChange,
}: {
  /** `null` when no single department is selected. */
  departmentName: string | null;
  departments: Array<{ id: string; name: string }>;
  onDepartmentChange: (value: string, name: string | null) => void;
  frame: TimeFrame;
  onFrameChange: (value: TimeFrame) => void;
  interval: TimeInterval;
  onIntervalChange: (value: TimeInterval) => void;
}) {
  // The selected name, not a lookup against the current window's options. A
  // department the reader picked can drop out of those options, and falling
  // back to "All departments" there would label a filtered panel as the whole
  // organisation's spend.
  const departmentLabel = departmentName ?? "All departments";

  return (
    <FilterChipRow>
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
        icon={<Clock size={12} />}
        label="Time Interval"
        value={timeIntervalLabel(interval)}
      >
        {TIME_INTERVALS.map((option) => {
          const tooWide = isIntervalCoarserThanFrame({
            interval: option.value,
            frame,
          });
          return (
            <MenuItem
              key={option.value}
              value={option.value}
              disabled={tooWide}
              onClick={
                tooWide ? undefined : () => onIntervalChange(option.value)
              }
            >
              {option.label}
            </MenuItem>
          );
        })}
      </FilterChip>
      {/* The bucket is stated once, for every chart, rather than inside one
          chart's heading. It used to live in the lane chart's title, which
          could only ever speak for that chart — and the rule is that every
          chart on the screen shares this axis. */}
      <Text
        width="full"
        fontSize="xs"
        color="fg.muted"
        data-testid="cost-bucket-note"
      >
        Department filters only the department breakdown. Every chart is
        bucketed by {timeIntervalLabel(interval).toLowerCase()}.
      </Text>
    </FilterChipRow>
  );
}
