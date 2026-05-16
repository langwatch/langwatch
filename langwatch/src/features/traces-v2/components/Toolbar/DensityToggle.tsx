import { Group, HStack, IconButton, Text } from "@chakra-ui/react";
import { AArrowDown, AArrowUp } from "lucide-react";
import type React from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";
import { type Density, useDensityStore } from "../../stores/densityStore";

// Icons map "visual height of letter" to "row height" — the up-arrow
// "A↑" reads as "tighter rows, taller letters poking up" = compact,
// and the down-arrow "A↓" reads as "looser rows, breathing room
// below the letter" = comfortable.
const OPTIONS: {
  density: Density;
  label: string;
  Icon: typeof AArrowDown;
}[] = [
  { density: "compact", label: "Compact", Icon: AArrowUp },
  { density: "comfortable", label: "Comfortable", Icon: AArrowDown },
];

const INACTIVE_ICON_OPACITY = 0.6;

export const DensityToggle: React.FC = () => {
  const density = useDensityStore((s) => s.density);
  const setDensity = useDensityStore((s) => s.setDensity);

  // Toggle on any click — the segmented group is a binary switch, so
  // there's no scenario where you'd click the already-active button on
  // purpose. Treating every click as a flip removes the "which one is
  // selected vs clickable" guessing game.
  const toggle = () => {
    setDensity(density === "compact" ? "comfortable" : "compact");
  };

  return (
    <Tooltip
      content={
        <HStack gap={1}>
          <Text>Density</Text>
          <Kbd>D</Kbd>
        </HStack>
      }
      positioning={{ placement: "bottom" }}
    >
      <Group attached>
        {OPTIONS.map(({ density: value, label, Icon }) => {
          const isActive = density === value;
          // Active button looks pressed (emphasized bg + solid icon),
          // inactive looks raised (transparent bg + faded icon). Reads
          // as "this is the current state" instead of "this is the
          // clickable one", which is what the previous mapping suggested.
          return (
            <IconButton
              key={value}
              aria-label={label}
              aria-pressed={isActive}
              variant="outline"
              bg={isActive ? "bg.emphasized" : "transparent"}
              size="2xs"
              onClick={toggle}
            >
              <Icon size={16} opacity={isActive ? 1 : INACTIVE_ICON_OPACITY} />
            </IconButton>
          );
        })}
      </Group>
    </Tooltip>
  );
};
