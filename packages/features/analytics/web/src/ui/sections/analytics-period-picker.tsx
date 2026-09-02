/**
 * The control that picks the range every chart on the page is drawn over.
 *
 * The RENDERING half of `platform/app/src/components/PeriodSelector.tsx`; the
 * reading half is pure in `model/analytics-period.ts` and bound in
 * `behavior/use-analytics-period.ts`. Splitting them is what makes "which
 * window does the address mean" a unit test rather than something only a
 * mounted router can answer — and it is what keeps a relative window from being
 * recomputed on every render, which is a refetch loop rather than a slow page.
 *
 * NOT NARROWED, unlike the audit log's copy of the same control: analytics is
 * where the absolute start and end inputs are actually used, so both halves of
 * the popover travel. `clearPeriod` ("All time") is still optional, and no
 * analytics page passes it — every chart here is a window by construction.
 *
 * The platform module stays: twenty-odd non-analytics modules render it.
 */

import type { ButtonProps, PopoverRootProps } from "@chakra-ui/react";
import { Box, Button, Field, HStack, Input, Text, useDisclosure, VStack } from "@chakra-ui/react";
import { format } from "date-fns";
import { ChevronDown } from "react-feather";
import { LuCalendar } from "react-icons/lu";
import { Popover } from "@langwatch/design-system/popover";

import {
  ANALYTICS_RELATIVE_PRESETS,
  presetForRange,
  type AnalyticsPeriod,
  type AnalyticsPeriodMode,
  type AnalyticsPresetKey,
} from "../../model/analytics-period";

/** Where the range list opens, relative to the trigger. */
export type AnalyticsPeriodPickerPlacement = NonNullable<
  NonNullable<PopoverRootProps["positioning"]>["placement"]
>;

export function AnalyticsPeriodPicker({
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
  period: AnalyticsPeriod;
  mode: AnalyticsPeriodMode;
  /**
   * Replaces the range shown on the trigger. For a surface that only filters
   * once a range is picked, so the control does not name a window it is not
   * applying.
   */
  label?: string;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (presetKey: AnalyticsPresetKey) => void;
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
  placement?: AnalyticsPeriodPickerPlacement;
}) {
  const { open, onOpen, onClose, setOpen } = useDisclosure();

  const handleQuickSelect = (presetKey: AnalyticsPresetKey) => {
    setRelativePeriod(presetKey);
    onClose();
  };

  const getDateRangeLabel = () => {
    if (mode === "relative") {
      const matchedByDays = presetForRange(startDate, endDate, new Date());
      if (matchedByDays) return matchedByDays.label;

      const minutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
      const subDay = ANALYTICS_RELATIVE_PRESETS.find((preset) => preset.minutes === minutes);
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
        <Button variant="outline" size="sm" minWidth="fit-content" onClick={onOpen}>
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
              {ANALYTICS_RELATIVE_PRESETS.map((preset) => (
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
