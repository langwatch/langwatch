import type { ButtonProps, PopoverRootProps } from "@chakra-ui/react";
import { Box, Button, Field, HStack, Input, Text, useDisclosure, VStack } from "@chakra-ui/react";
import { differenceInCalendarDays, format, startOfDay, subDays } from "date-fns";
import { ChevronDown } from "lucide-react";
import { LuCalendar } from "react-icons/lu";
import { Popover } from "@langwatch/design-system/popover";

import type { Period, PeriodMode } from "./session-filters";

/**
 * The date-range control the activity tables narrow by.
 *
 * The package's own copy of `platform/app`'s `PeriodSelector`, and only the
 * controlled half of it: the application's `usePeriodSelector` keeps the range
 * in the query string through its own router, which is an import a feature-web
 * package may not make and which neither of these tables used anyway — both
 * hold the range in their own state and pass it in.
 *
 * `Period` and `PeriodMode` are this package's own, already declared by
 * `session-filters`, so the control and the filter it drives agree by
 * construction.
 */

/**
 * Relative range presets. The key is what a caller names a preset by;
 * `minutes` is the lookback window from "now", and `days` the equivalent
 * inclusive day count, clamped to 1 for sub-day windows.
 */
const RELATIVE_PRESETS = [
  { key: "15m", label: "Last 15 minutes", minutes: 15, days: 1 },
  { key: "1h", label: "Last 1 hour", minutes: 60, days: 1 },
  { key: "6h", label: "Last 6 hours", minutes: 60 * 6, days: 1 },
  { key: "24h", label: "Last 24 hours", minutes: 60 * 24, days: 1 },
  { key: "today", label: "Today", minutes: null, days: 1 },
  { key: "7d", label: "Last 7 days", minutes: null, days: 7 },
  { key: "15d", label: "Last 15 days", minutes: null, days: 15 },
  { key: "30d", label: "Last 30 days", minutes: null, days: 30 },
  { key: "90d", label: "Last 90 days", minutes: null, days: 90 },
  { key: "6mo", label: "Last 6 months", minutes: null, days: 180 },
  { key: "1y", label: "Last 1 year", minutes: null, days: 365 },
] as const;

export type RelativePresetKey = (typeof RELATIVE_PRESETS)[number]["key"];

const RELATIVE_PRESETS_BY_KEY = new Map(RELATIVE_PRESETS.map((preset) => [preset.key, preset]));

const getDaysDifference = (startDate: Date, endDate: Date) =>
  differenceInCalendarDays(endDate, startDate) + 1;

/**
 * The [start, end] window for a relative preset, anchored to `now`.
 * Day-based presets snap the start to start-of-day, matching the day quick
 * selectors elsewhere in the product.
 */
export const computeRelativeWindow = (presetKey: RelativePresetKey, now: Date): Period => {
  const preset = RELATIVE_PRESETS_BY_KEY.get(presetKey);
  if (!preset) {
    return { startDate: startOfDay(subDays(now, 29)), endDate: now };
  }

  if (preset.minutes !== null) {
    const startDate = new Date(now.getTime() - preset.minutes * 60 * 1000);
    return { startDate, endDate: now };
  }

  const startDate = startOfDay(subDays(now, preset.days - 1));
  return { startDate, endDate: now };
};

const getPresetForRange = (
  startDate: Date,
  endDate: Date,
  now: Date,
): (typeof RELATIVE_PRESETS)[number] | undefined => {
  const daysDifference = getDaysDifference(startDate, endDate);
  const daysFromToday = getDaysDifference(endDate, now);
  if (daysFromToday > 1) return void 0;

  return RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === daysDifference,
  );
};

/** Where the range list opens, relative to the trigger. */
export type PeriodSelectorPlacement = NonNullable<
  NonNullable<PopoverRootProps["positioning"]>["placement"]
>;

export function PeriodSelector({
  period: { startDate, endDate },
  mode,
  label,
  setPeriod,
  setRelativePeriod,
  clearPeriod,
  size = "sm",
  triggerVariant = "outline",
  placement = "bottom-end",
}: {
  period: Period;
  mode: PeriodMode;
  /**
   * Replaces the range shown on the trigger. For a surface that only filters
   * once a range is picked, so the control does not name a window it is not
   * applying.
   */
  label?: string;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (presetKey: RelativePresetKey) => void;
  /**
   * Takes the range back off, offered as "All time". Only surfaces that show
   * everything without a range have somewhere to go back to, so the entry
   * appears only when they pass this.
   */
  clearPeriod?: () => void;
  /** The size of the trigger. A rail foot wants "xs". */
  size?: ButtonProps["size"];
  /** The look of the trigger. A rail foot wants "ghost". */
  triggerVariant?: ButtonProps["variant"];
  /** Where the range list opens. A control at the foot of a rail wants "top-start". */
  placement?: PeriodSelectorPlacement;
}) {
  const { open, onOpen, onClose, setOpen } = useDisclosure();

  const handleQuickSelect = (presetKey: RelativePresetKey) => {
    setRelativePeriod(presetKey);
    onClose();
  };

  const getDateRangeLabel = () => {
    if (mode === "relative") {
      const matchedByDays = getPresetForRange(startDate, endDate, new Date());
      if (matchedByDays) return matchedByDays.label;

      const minutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
      const subDay = RELATIVE_PRESETS.find((preset) => preset.minutes === minutes);
      if (subDay) return subDay.label;
    }

    return `${format(startDate, "MMM d")} - ${format(endDate, "MMM d")}`;
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={({ open }) => setOpen(open)}
      positioning={{ placement }}
      size="sm"
    >
      <Popover.Trigger asChild>
        <Button variant={triggerVariant} size={size} minWidth="fit-content" onClick={onOpen}>
          <LuCalendar />
          <Text>{label ?? getDateRangeLabel()}</Text>
          <Box>
            <ChevronDown size={16} />
          </Box>
        </Button>
      </Popover.Trigger>
      <Popover.Content width="fit-content">
        <Popover.Arrow />
        <Popover.CloseTrigger />
        <Popover.Header>
          <Popover.Title>Select Date Range</Popover.Title>
        </Popover.Header>
        <Popover.Body>
          <HStack align="start" gap={6}>
            <VStack gap={4}>
              <Field.Root>
                <Field.Label>Start Date</Field.Label>
                <Input
                  type="datetime-local"
                  value={format(startDate, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) => setPeriod(new Date(e.target.value), endDate)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>End Date</Field.Label>
                <Input
                  type="datetime-local"
                  value={format(endDate, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) => setPeriod(startDate, new Date(e.target.value))}
                />
              </Field.Root>
            </VStack>
            <VStack>
              {clearPeriod && (
                <Button
                  width="full"
                  onClick={() => {
                    clearPeriod();
                    onClose();
                  }}
                >
                  All time
                </Button>
              )}
              {RELATIVE_PRESETS.map((preset) => (
                <Button width="full" key={preset.key} onClick={() => handleQuickSelect(preset.key)}>
                  {preset.label}
                </Button>
              ))}
            </VStack>
          </HStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
