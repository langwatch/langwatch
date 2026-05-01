import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import {
  differenceInCalendarDays,
  format,
  startOfDay,
  subDays,
} from "date-fns";
import { useRouter } from "~/utils/compat/next-router";
import { useCallback, useMemo } from "react";
import { Calendar, ChevronDown } from "react-feather";
import { LuCalendar } from "react-icons/lu";
import { Popover } from "./ui/popover";

/** Date range used for time-based filtering across the app. */
export type Period = { startDate: Date; endDate: Date };

/**
 * Relative range presets. The key is what gets serialised into the URL as
 * `?period=<key>`. `minutes` is the lookback window from "now".
 *
 * `days` is the equivalent inclusive day count exposed to consumers via
 * `daysDifference`. For sub-day windows it clamps to 1 — analytics queries
 * already do their own `Math.max` so this stays compatible.
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

const RELATIVE_PRESETS_BY_KEY = new Map(
  RELATIVE_PRESETS.map((preset) => [preset.key, preset]),
);

const isRelativePresetKey = (value: unknown): value is RelativePresetKey =>
  typeof value === "string" &&
  RELATIVE_PRESETS_BY_KEY.has(value as RelativePresetKey);

const getDaysDifference = (startDate: Date, endDate: Date) =>
  differenceInCalendarDays(endDate, startDate) + 1;

const isValidDateString = (dateString: string) => {
  const d = new Date(dateString);
  return d instanceof Date && !isNaN(d as any);
};

/**
 * Compute the [start, end] window for a relative preset, anchored to `now`.
 * Day-based presets snap the start to start-of-day to match the historical
 * behaviour of the day quick selectors.
 */
const computeRelativeWindow = (
  presetKey: RelativePresetKey,
  now: Date,
): Period => {
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

const defaultPresetForDays = (defaultNDays: number): RelativePresetKey => {
  const match = RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === defaultNDays,
  );
  return match?.key ?? "30d";
};

export type PeriodMode = "relative" | "absolute";

export const usePeriodSelector = (defaultNDays = 30) => {
  const router = useRouter();

  // Recompute on every render so relative windows stay anchored to "now".
  // The useMemo below excludes `now` from its deps, so the returned `period`
  // stays referentially stable across renders unless query params change.
  // Page re-mounts (refresh, route change) get a fresh `now` for free.
  const now = new Date();

  const queryPeriod = router.query.period;
  const queryStartDate = router.query.startDate;
  const queryEndDate = router.query.endDate;

  const { period, mode } = useMemo<{ period: Period; mode: PeriodMode }>(() => {
    if (
      typeof queryStartDate === "string" &&
      typeof queryEndDate === "string" &&
      isValidDateString(queryStartDate) &&
      isValidDateString(queryEndDate)
    ) {
      const startDate = new Date(queryStartDate);
      const endDate = new Date(queryEndDate);
      const safeStart = startDate > endDate ? endDate : startDate;
      return {
        period: { startDate: safeStart, endDate },
        mode: "absolute",
      };
    }

    const presetKey = isRelativePresetKey(queryPeriod)
      ? queryPeriod
      : defaultPresetForDays(defaultNDays);

    return {
      period: computeRelativeWindow(presetKey, now),
      mode: "relative",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryPeriod, queryStartDate, queryEndDate, defaultNDays]);

  const setPeriod = useCallback(
    (startDate: Date, endDate: Date) => {
      const validEndDate =
        endDate instanceof Date && !isNaN(endDate.getTime())
          ? endDate
          : new Date();

      let validStartDate =
        startDate instanceof Date && !isNaN(startDate.getTime())
          ? startDate
          : new Date();

      if (validStartDate > validEndDate) {
        validStartDate = validEndDate;
      }

      const { period: _omitPeriod, ...rest } = router.query;
      void router.push(
        {
          query: {
            ...rest,
            startDate: validStartDate.toISOString(),
            endDate: validEndDate.toISOString(),
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
    setPeriod,
    setRelativePeriod,
    daysDifference,
  };
};

const getPresetForRange = (
  startDate: Date,
  endDate: Date,
  now: Date,
): (typeof RELATIVE_PRESETS)[number] | undefined => {
  const daysDifference = getDaysDifference(startDate, endDate);
  const daysFromToday = getDaysDifference(endDate, now);
  if (daysFromToday > 1) return undefined;

  return RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === daysDifference,
  );
};

export function PeriodSelector({
  period: { startDate, endDate },
  mode,
  setPeriod,
  setRelativePeriod,
}: {
  period: Period;
  mode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (presetKey: RelativePresetKey) => void;
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

      const minutes = Math.round(
        (endDate.getTime() - startDate.getTime()) / 60000,
      );
      const subDay = RELATIVE_PRESETS.find(
        (preset) => preset.minutes === minutes,
      );
      if (subDay) return subDay.label;
    }

    return `${format(startDate, "MMM d")} - ${format(endDate, "MMM d")}`;
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={({ open }) => setOpen(open)}
      positioning={{ placement: "bottom-end" }}
      size="sm"
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          size="sm"
          minWidth="fit-content"
          onClick={onOpen}
        >
          <LuCalendar />
          <Text>{getDateRangeLabel()}</Text>
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
                  value={format(startDate, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) => setPeriod(new Date(e.target.value), endDate)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>End Date</Field.Label>
                <Input
                  type="datetime-local"
                  value={format(endDate, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) =>
                    setPeriod(startDate, new Date(e.target.value))
                  }
                />
              </Field.Root>
            </VStack>
            <VStack>
              {RELATIVE_PRESETS.map((preset) => (
                <Button
                  width="full"
                  key={preset.key}
                  onClick={() => handleQuickSelect(preset.key)}
                >
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
