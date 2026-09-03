/**
 * The range control at the head of every annotation list.
 *
 * The rendering half of the family-local period copy — `model/annotation-period.ts`
 * holds the presets, the window they resolve to and the address writes. A
 * FAMILY-LOCAL COPY of `platform/app/src/components/PeriodSelector`, which keeps
 * thirty callers and so did not travel.
 *
 * NARROWED: the platform control takes a size, a trigger variant and a
 * placement because an analytics rail foot wants a small ghost button opening
 * upwards. Every annotation list renders it the same way, so those three are
 * gone and the look is stated once.
 */

import { Box, Button, Field, HStack, Input, Text, useDisclosure, VStack } from "@chakra-ui/react";
import { Popover } from "@langwatch/design-system/popover";
import { format } from "date-fns";
import { Calendar, ChevronDown } from "lucide-react";
import {
  ANNOTATION_PERIOD_PRESETS,
  matchingPreset,
  type AnnotationPeriod,
  type AnnotationPeriodMode,
  type AnnotationPeriodPresetKey,
} from "../../model/annotation-period";

export function PeriodPicker({
  period,
  mode,
  label,
  setPeriod,
  setRelativePeriod,
  clearPeriod,
}: {
  period: AnnotationPeriod;
  mode: AnnotationPeriodMode;
  /**
   * Replaces the range shown on the trigger. For a list that only filters once
   * a range is picked, so the control does not name a window it is not
   * applying.
   */
  label?: string;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (presetKey: AnnotationPeriodPresetKey) => void;
  /**
   * Takes the range back off, offered as "All time". Only lists that show
   * everything without a range have somewhere to go back to, so the entry
   * appears only when they pass this.
   */
  clearPeriod?: () => void;
}) {
  const { open, onOpen, onClose, setOpen } = useDisclosure();
  const { startDate, endDate } = period;

  const triggerLabel = () => {
    if (mode === "relative") {
      const preset = matchingPreset({ period, now: new Date() });
      if (preset) return preset.label;
    }
    return `${format(startDate, "MMM d")} - ${format(endDate, "MMM d")}`;
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => setOpen(nextOpen)}
      positioning={{ placement: "bottom-end" }}
      size="sm"
    >
      <Popover.Trigger asChild>
        <Button variant="outline" size="sm" minWidth="fit-content" onClick={onOpen}>
          <Calendar size={16} />
          <Text>{label ?? triggerLabel()}</Text>
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
                  onChange={(event) => setPeriod(new Date(event.target.value), endDate)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>End Date</Field.Label>
                <Input
                  type="datetime-local"
                  value={format(endDate, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(event) => setPeriod(startDate, new Date(event.target.value))}
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
              {ANNOTATION_PERIOD_PRESETS.map((preset) => (
                <Button
                  width="full"
                  key={preset.key}
                  onClick={() => {
                    setRelativePeriod(preset.key);
                    onClose();
                  }}
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
