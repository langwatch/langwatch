import { Popover, type PopoverRootProps } from "@langwatch/design-system/popover";
import type { ButtonProps } from "@langwatch/design-system/primitives";
import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Text,
  useDisclosure,
  VStack,
} from "@langwatch/design-system/primitives";
import { format, nowInstant, type Instant } from "@langwatch/time";
import { ChevronDown } from "react-feather";
import { LuCalendar } from "react-icons/lu";

import {
  describePeriod,
  instantFromText,
  type Period,
  type PeriodMode,
  RELATIVE_PRESETS,
  type RelativePresetKey,
} from "../../../model/analytics/period.ts";

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
