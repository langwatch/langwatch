/** The board header's period control: a "30d · auto" button opening a range and grain menu. */

import { Button } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Clock } from "lucide-react";

import {
  BOARD_PERIOD_GRAINS,
  BOARD_PERIOD_RANGES,
  boardPeriodGrainIsSupported,
  boardPeriodLabel,
  type BoardPeriodGrain,
  type BoardPeriodRange,
} from "../../model/board-period.ts";

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
        <Button variant="ghost" size="sm" aria-label="Period">
          <Clock size={14} /> {boardPeriodLabel({ range, grain })}
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.ItemGroup title="Range">
          {BOARD_PERIOD_RANGES.map((option) => (
            <Menu.Item key={option} value={`range-${option}`} onClick={() => onRangeChange(option)}>
              {option}
              {option === range && " ✓"}
            </Menu.Item>
          ))}
        </Menu.ItemGroup>
        <Menu.ItemGroup title="Grain">
          {BOARD_PERIOD_GRAINS.map((option) => {
            const disabled = option !== "auto" && !boardPeriodGrainIsSupported(option);
            return (
              <Menu.Item
                key={option}
                value={`grain-${option}`}
                disabled={disabled}
                title={disabled ? "Coming soon" : void 0}
                onClick={() => !disabled && onGrainChange(option)}
              >
                {option}
                {option === grain && " ✓"}
              </Menu.Item>
            );
          })}
        </Menu.ItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
}
