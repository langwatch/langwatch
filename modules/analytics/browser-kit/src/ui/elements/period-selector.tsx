import type { ButtonProps, PopoverRootProps } from "@chakra-ui/react";
import { Box, Button, Field, HStack, Input, Text, useDisclosure, VStack } from "@chakra-ui/react";
import { useRouter } from "@langwatch/browser-host/use-router";
import { Popover } from "@langwatch/design-system/popover";
import {
  currentTimeZone,
  differenceInCalendarDays,
  format,
  nowInstant,
  Temporal,
  toEpochMs,
  type Instant,
} from "@langwatch/time";
import { useCallback, useMemo } from "react";
import { ChevronDown } from "react-feather";
import { LuCalendar } from "react-icons/lu";

/** Date range used for time-based filtering across the app. */
export type Period = { startDate: Instant; endDate: Instant };

/**
 * Relative range presets. The key is what gets serialised into the URL as `?period=<key>`.
 * `minutes` is the lookback window from "now". `days` is the equivalent inclusive day count
 * exposed to consumers via `daysDifference`.
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

const isRelativePresetKey = (value: unknown): value is RelativePresetKey =>
  typeof value === "string" && RELATIVE_PRESETS_BY_KEY.has(value as RelativePresetKey);

const getDaysDifference = (startDate: Instant, endDate: Instant) =>
  differenceInCalendarDays(endDate.epochMilliseconds, startDate.epochMilliseconds) + 1;

const startOfDayDaysBefore = (now: Instant, days: number): Instant =>
  now.toZonedDateTimeISO(currentTimeZone()).subtract({ days }).startOfDay().toInstant();

/** A moment read leniently from text, or `fallback` when the text does not hold one. */
const instantFromText = (text: string, fallback: Instant): Instant => {
  const epochMs = toEpochMs(text);
  return Number.isFinite(epochMs) ? Temporal.Instant.fromEpochMilliseconds(epochMs) : fallback;
};

/**
 * Compute the [start, end] window for a relative preset, anchored to `now`.
 * Day-based presets snap the start to start-of-day to match the historical
 * behaviour of the day quick selectors.
 */
export const computeRelativeWindow = (presetKey: RelativePresetKey, now: Instant): Period => {
  const preset = RELATIVE_PRESETS_BY_KEY.get(presetKey);
  if (!preset) {
    return { startDate: startOfDayDaysBefore(now, 29), endDate: now };
  }

  if (preset.minutes !== null) {
    return { startDate: now.subtract({ minutes: preset.minutes }), endDate: now };
  }

  return { startDate: startOfDayDaysBefore(now, preset.days - 1), endDate: now };
};

const defaultPresetForDays = (defaultNDays: number): RelativePresetKey => {
  const match = RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === defaultNDays,
  );
  return match?.key ?? "30d";
};

export type PeriodMode = "relative" | "absolute";

/** An absolute range in the address wins; otherwise a relative preset does. */
function readPeriodFromAddress({
  defaultNDays,
  now,
  queryEndDate,
  queryPeriod,
  queryStartDate,
}: {
  defaultNDays: number;
  now: Instant;
  queryEndDate: unknown;
  queryPeriod: unknown;
  queryStartDate: unknown;
}): { period: Period; mode: PeriodMode; isDefault: boolean } {
  const startMs = typeof queryStartDate === "string" ? toEpochMs(queryStartDate) : Number.NaN;
  const endMs = typeof queryEndDate === "string" ? toEpochMs(queryEndDate) : Number.NaN;
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    const endDate = Temporal.Instant.fromEpochMilliseconds(endMs);
    const safeStart = startMs > endMs ? endDate : Temporal.Instant.fromEpochMilliseconds(startMs);

    return { period: { startDate: safeStart, endDate }, mode: "absolute", isDefault: false };
  }

  const picked = isRelativePresetKey(queryPeriod);
  const presetKey = picked ? queryPeriod : defaultPresetForDays(defaultNDays);

  return { period: computeRelativeWindow(presetKey, now), mode: "relative", isDefault: !picked };
}

export const usePeriodSelector = (defaultNDays = 30) => {
  const router = useRouter();

  // Recompute on every render so relative windows stay anchored to "now".
  // The useMemo below excludes `now` from its deps, so the returned `period`
  // stays referentially stable across renders unless query params change.
  // Page re-mounts (refresh, route change) get a fresh `now` for free.
  const now = nowInstant();

  const queryPeriod = router.query.period;
  const queryStartDate = router.query.startDate;
  const queryEndDate = router.query.endDate;

  const { period, mode, isDefault } = useMemo(
    () =>
      readPeriodFromAddress({
        defaultNDays,
        now,
        queryEndDate,
        queryPeriod,
        queryStartDate,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryPeriod, queryStartDate, queryEndDate, defaultNDays],
  );

  const setPeriod = useCallback(
    (startDate: Instant, endDate: Instant) => {
      const validStartDate = Temporal.Instant.compare(startDate, endDate) > 0 ? endDate : startDate;

      const { period: _omitPeriod, ...rest } = router.query;
      void router.push(
        {
          query: {
            ...rest,
            startDate: validStartDate.toString({ fractionalSecondDigits: 3 }),
            endDate: endDate.toString({ fractionalSecondDigits: 3 }),
          },
        },
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  const setRelativePeriod = useCallback(
    (presetKey: RelativePresetKey) => {
      const { startDate: _s, endDate: _e, ...rest } = router.query;
      void router.push(
        {
          query: {
            ...rest,
            period: presetKey,
          },
        },
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  const daysDifference = getDaysDifference(period.startDate, period.endDate);

  return {
    period,
    mode,
    /**
     * True while the URL carries no range of its own, so `period` is this hook's own fallback
     * rather than something the reader asked for. Surfaces where a default window would hide
     * rows read this to filter only once a range has actually been picked.
     */
    isDefault,
    setPeriod,
    setRelativePeriod,
    daysDifference,
  };
};

const getPresetForRange = (
  startDate: Instant,
  endDate: Instant,
  now: Instant,
): (typeof RELATIVE_PRESETS)[number] | undefined => {
  const daysDifference = getDaysDifference(startDate, endDate);
  const daysFromToday = getDaysDifference(endDate, now);
  if (daysFromToday > 1) return undefined;

  return RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === daysDifference,
  );
};

/**
 * The preset a window matches, by whole days or by a sub-day minute span.
 * Undefined for a window that matches no preset, which is any free range.
 */
export const matchPeriodPreset = ({
  period: { startDate, endDate },
  mode,
}: {
  period: Period;
  mode: PeriodMode;
}): (typeof RELATIVE_PRESETS)[number] | undefined => {
  if (mode !== "relative") return undefined;

  const matchedByDays = getPresetForRange(startDate, endDate, nowInstant());
  if (matchedByDays) return matchedByDays;

  const minutes = Math.round((endDate.epochMilliseconds - startDate.epochMilliseconds) / 60000);
  return RELATIVE_PRESETS.find((preset) => preset.minutes === minutes);
};

/**
 * What the window is called, the way the trigger names it: the matched preset's own label, or
 * the start and end dates for a free range.
 */
export const describePeriod = ({ period, mode }: { period: Period; mode: PeriodMode }): string => {
  const preset = matchPeriodPreset({ period, mode });
  if (preset) return preset.label;

  return `${format(period.startDate.epochMilliseconds, "MMM d")} - ${format(period.endDate.epochMilliseconds, "MMM d")}`;
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
  triggerProps,
}: {
  period: Period;
  mode: PeriodMode;
  /**
   * Replaces the range shown on the trigger. For a surface that only filters
   * once a range is picked, so the control does not name a window it is not
   * applying.
   */
  label?: string;
  setPeriod: (startDate: Instant, endDate: Instant) => void;
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
  /**
   * Spread onto the trigger button, for a surface that needs a test id or a
   * height the size scale does not offer.
   */
  triggerProps?: ButtonProps & { "data-testid"?: string };
}) {
  const { open, onOpen, onClose, setOpen } = useDisclosure();

  const handleQuickSelect = (presetKey: RelativePresetKey) => {
    setRelativePeriod(presetKey);
    onClose();
  };

  const getDateRangeLabel = () => describePeriod({ period: { startDate, endDate }, mode });

  return (
    <Popover.Root
      open={open}
      onOpenChange={({ open }) => setOpen(open)}
      positioning={{ placement }}
      size="sm"
    >
      <Popover.Trigger asChild>
        <Button
          variant={triggerVariant}
          size={size}
          minWidth="fit-content"
          onClick={onOpen}
          {...triggerProps}
        >
          <LuCalendar />
          <Text>{label ?? getDateRangeLabel()}</Text>
          <Box>
            <ChevronDown />
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
                  value={format(startDate.epochMilliseconds, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) =>
                    setPeriod(instantFromText(e.target.value, nowInstant()), endDate)
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>End Date</Field.Label>
                <Input
                  type="datetime-local"
                  value={format(endDate.epochMilliseconds, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) =>
                    setPeriod(startDate, instantFromText(e.target.value, nowInstant()))
                  }
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
