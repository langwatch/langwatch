/**
 * The window the Results tab reads, in the two forms the surface uses.
 *
 * The full form heads the Test Runs list. The compact form sits at the foot of
 * the runs rail and opens upwards, so the window stays reachable without
 * taking a line of the rail.
 *
 * The list offers the three short windows. A window the page widened on its
 * own is still named on the trigger, so a plan whose last run is months old
 * says which window it opened.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { chakra, HStack, Text } from "@chakra-ui/react";
import { differenceInCalendarDays } from "date-fns";
import { Calendar, ChevronDown } from "lucide-react";
import type { Period, RelativePresetKey } from "@langwatch/analytics-web/components/PeriodSelector";
import { Menu } from "@langwatch/design-system/menu";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design";

/** The windows the list offers, shortest first. */
const WINDOWS: { key: RelativePresetKey; days: number; label: string }[] = [
  { key: "7d", days: 7, label: "Last 7 days" },
  { key: "15d", days: 15, label: "Last 15 days" },
  { key: "30d", days: 30, label: "Last 30 days" },
];

/** What the picker says about the runs it cannot reach. */
export const COLD_STORAGE_NOTE = "Runs older than 30 days are in cold storage.";

/**
 * How many days the window spans, counted the way the shared period control
 * counts them: a window that starts at the top of a day and ends now spans
 * both of those days.
 */
export function periodDays(period: Period): number {
  return differenceInCalendarDays(period.endDate, period.startDate) + 1;
}

/** The window on the trigger, including one the page widened on its own. */
export function periodLabel(period: Period): string {
  const days = periodDays(period);
  if (days >= 360) return "Last 1 year";
  if (days >= 175 && days <= 185) return "Last 6 months";
  return `Last ${days} days`;
}

/** The window on the compact trigger: "30d". */
export function compactPeriodLabel(period: Period): string {
  const days = periodDays(period);
  return days >= 360 ? "1y" : `${days}d`;
}

export type AgentTestingPeriodPickerProps = {
  period: Period;
  setRelativePeriod: (key: RelativePresetKey) => void;
  /** The rail form: shorter, quieter, and opening upwards. */
  compact?: boolean;
};

/** The control that opens the window list, in its wide and its rail form. */
function PeriodTrigger({
  period,
  compact,
  ...rest
}: {
  period: Period;
  compact?: boolean;
}) {
  const label = periodLabel(period);

  return (
    <chakra.button
      type="button"
      display="flex"
      alignItems="center"
      gap={compact ? 1 : 1.5}
      whiteSpace="nowrap"
      cursor="pointer"
      title={label}
      aria-label={label}
      {...(compact
        ? {
            borderRadius: "md",
            paddingX: 1.5,
            paddingY: 1,
            fontSize: "11px",
            fontWeight: "medium",
            color: FG_MUTED,
            _hover: { background: "bg.muted" },
          }
        : {
            height: "32px",
            borderRadius: "lg",
            borderWidth: "1px",
            borderColor: "border",
            background: "bg.panel",
            paddingX: "10px",
            fontSize: "12.5px",
            fontWeight: "medium",
            color: "fg",
            _hover: {
              borderColor: "border.emphasized",
              background: "bg.muted",
            },
          })}
      data-testid="results-period-picker"
      {...rest}
    >
      <Calendar
        size={compact ? 12 : 13}
        color="var(--chakra-colors-fg-muted)"
      />
      {compact ? compactPeriodLabel(period) : label}
      <ChevronDown
        size={compact ? 11 : 13}
        color="var(--chakra-colors-fg-muted)"
      />
    </chakra.button>
  );
}

/** The windows on offer, and the note about what is kept for how long. */
function PeriodMenuContent({
  days,
  setRelativePeriod,
}: {
  days: number;
  setRelativePeriod: (key: RelativePresetKey) => void;
}) {
  return (
    <Menu.Content paddingY={0.5} minWidth="auto">
      {WINDOWS.map((window) => (
        <Menu.Item
          key={window.key}
          value={window.key}
          paddingX={3}
          paddingY={1.5}
          fontSize="12.5px"
          fontWeight={window.days === days ? "semibold" : "normal"}
          whiteSpace="nowrap"
          onClick={() => setRelativePeriod(window.key)}
        >
          {window.label}
        </Menu.Item>
      ))}
      <HStack
        borderTopWidth="1px"
        borderColor="border"
        paddingX={3}
        paddingY={1.5}
      >
        <Text fontSize="10.5px" color={FG_MUTED}>
          {COLD_STORAGE_NOTE}
        </Text>
      </HStack>
    </Menu.Content>
  );
}

export function AgentTestingPeriodPicker({
  period,
  setRelativePeriod,
  compact,
}: AgentTestingPeriodPickerProps) {
  return (
    <Menu.Root
      positioning={{ placement: compact ? "top-start" : "bottom-end" }}
    >
      <Menu.Trigger asChild>
        <PeriodTrigger period={period} compact={compact} />
      </Menu.Trigger>
      <PeriodMenuContent
        days={periodDays(period)}
        setRelativePeriod={setRelativePeriod}
      />
    </Menu.Root>
  );
}
