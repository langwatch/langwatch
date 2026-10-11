import { Box, Button, Field, HStack, Input, Stack, Text, useDisclosure } from "@chakra-ui/react";
import type { ButtonProps } from "@chakra-ui/react";
import { ChevronDown } from "react-feather";
import { LuCalendar } from "react-icons/lu";

import { Popover, type PopoverRootProps } from "../overlays/popover.tsx";
import { OptionItem } from "./option-list.tsx";

export type DateRangePickerPlacement = NonNullable<
  NonNullable<PopoverRootProps["positioning"]>["placement"]
>;

export interface DateRangePreset<Key extends string> {
  key: Key;
  label: string;
}

/**
 * Presets as a list, a custom range beside it. Dates travel as the
 * `yyyy-MM-ddTHH:mm` text a datetime-local input holds; the caller parses.
 */
export function DateRangePicker<Key extends string>({
  presets,
  activePresetKey,
  startValue,
  endValue,
  triggerLabel,
  onStartChange,
  onEndChange,
  onPresetSelect,
  onClear,
  size = "sm",
  triggerVariant = "outline",
  placement = "bottom-end",
  triggerProps,
}: {
  presets: readonly DateRangePreset<Key>[];
  /** The preset the shown range corresponds to, marked in the list. */
  activePresetKey?: Key;
  /** Both ends and both handlers draw the custom range; omit them for presets only. */
  startValue?: string;
  endValue?: string;
  triggerLabel: string;
  onStartChange?: (text: string) => void;
  onEndChange?: (text: string) => void;
  onPresetSelect: (key: Key) => void;
  /** Offers an "All time" row that takes the range back off. */
  onClear?: () => void;
  size?: ButtonProps["size"];
  triggerVariant?: ButtonProps["variant"];
  placement?: DateRangePickerPlacement;
  triggerProps?: ButtonProps & { "data-testid"?: string };
}) {
  const { open, onOpen, onClose, setOpen } = useDisclosure();
  const hasCustomRange = Boolean(onStartChange && onEndChange);

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
          <Text>{triggerLabel}</Text>
          <Box>
            <ChevronDown />
          </Box>
        </Button>
      </Popover.Trigger>
      <Popover.Content width="fit-content">
        <Popover.CloseTrigger />
        <Popover.Header>
          <Popover.Title fontWeight="semibold">Select date range</Popover.Title>
        </Popover.Header>
        <Popover.Body paddingTop="0">
          <HStack align="stretch" gap="4">
            <Stack
              gap="0.5"
              minWidth="40"
              paddingEnd={hasCustomRange ? "3" : undefined}
              borderEndWidth={hasCustomRange ? "1px" : undefined}
              borderColor="border"
            >
              {onClear && (
                <OptionItem
                  onClick={() => {
                    onClear();
                    onClose();
                  }}
                >
                  All time
                </OptionItem>
              )}
              {presets.map((preset) => (
                <OptionItem
                  key={preset.key}
                  aria-current={preset.key === activePresetKey ? "true" : undefined}
                  data-selected={preset.key === activePresetKey ? "" : undefined}
                  fontWeight={preset.key === activePresetKey ? "semibold" : undefined}
                  onClick={() => {
                    onPresetSelect(preset.key);
                    onClose();
                  }}
                >
                  {preset.label}
                </OptionItem>
              ))}
            </Stack>
            {onStartChange && onEndChange && (
              <Stack gap="3" minWidth="48">
                <Field.Root>
                  <Field.Label>Start date</Field.Label>
                  <Input
                    size="sm"
                    type="datetime-local"
                    value={startValue ?? ""}
                    onChange={(e) => onStartChange(e.target.value)}
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>End date</Field.Label>
                  <Input
                    size="sm"
                    type="datetime-local"
                    value={endValue ?? ""}
                    onChange={(e) => onEndChange(e.target.value)}
                  />
                </Field.Root>
              </Stack>
            )}
          </HStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
