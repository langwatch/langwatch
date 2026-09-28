/** The board header's period control: a "30d · auto" pill opening a range and grain menu. */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Check, ChevronDown, Clock } from "lucide-react";
import type { ReactNode } from "react";

import {
  BOARD_PERIOD_GRAINS,
  BOARD_PERIOD_RANGES,
  type BoardPeriodGrain,
  type BoardPeriodRange,
} from "../../model/board-period.ts";

function PeriodOption({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <HStack width="full" gap={2} fontSize="12.5px">
      <Text as="span" fontFamily="mono">
        {children}
      </Text>
      {selected && (
        <Box marginLeft="auto" color="fg">
          <Check size={13} aria-label="selected" />
        </Box>
      )}
    </HStack>
  );
}

export function BoardPeriodControl({
  range,
  grain,
  onRangeChange,
  onGrainChange,
}: {
  readonly range: BoardPeriodRange;
  readonly grain: BoardPeriodGrain;
  readonly onRangeChange: (range: BoardPeriodRange) => void;
  readonly onGrainChange: (grain: BoardPeriodGrain) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="outline"
          aria-label="Period"
          title="Time range & grain"
          height="auto"
          minWidth={0}
          paddingX={2.5}
          paddingY={1}
          gap={1.5}
          borderRadius="lg"
          borderColor="border"
          background="bg.panel"
          fontSize="12px"
          fontWeight="normal"
          _hover={{ borderColor: "border.emphasized", background: "bg.panel" }}
        >
          <Box as="span" color="fg.subtle">
            <Clock size={13} aria-hidden />
          </Box>
          <Text as="span" fontFamily="mono" fontWeight="medium" color="fg">
            {range}
          </Text>
          <Text as="span" color="gray.400">
            · {grain}
          </Text>
          <Box as="span" color="gray.400">
            <ChevronDown size={12} aria-hidden />
          </Box>
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.ItemGroup title="Range">
          {BOARD_PERIOD_RANGES.map((option) => (
            <Menu.Item key={option} value={`range-${option}`} onClick={() => onRangeChange(option)}>
              <PeriodOption selected={option === range}>{option}</PeriodOption>
            </Menu.Item>
          ))}
        </Menu.ItemGroup>
        <Menu.ItemGroup title="Grain">
          {BOARD_PERIOD_GRAINS.map((option) => (
            <Menu.Item key={option} value={`grain-${option}`} onClick={() => onGrainChange(option)}>
              <PeriodOption selected={option === grain}>{option}</PeriodOption>
            </Menu.Item>
          ))}
        </Menu.ItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
}
