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
          // Active button reads as a calm flat surface (transparent bg,
          // full-opacity icon), inactive sits on the muted/emphasized
          // surface that says "available target". rchaves prefers this
          // mapping — the active state is recognised by the *icon*
          // crispness, the inactive button reads as the chip you can
          // click to flip to.
          return (
            <IconButton
              key={value}
              aria-label={label}
              aria-pressed={isActive}
              variant="outline"
              // Active button gets a clear "selected" treatment instead
              // of the previous subtle opacity-only difference. The
              // previous styling (transparent bg + 0.6 opacity on the
              // inactive icon) read as two near-identical icon buttons
              // sitting side by side — users couldn't tell which mode
              // was active without hovering for the tooltip.
              bg={isActive ? "bg.muted" : "transparent"}
              color={isActive ? "fg" : "fg.muted"}
              borderColor={isActive ? "border" : "border.muted"}
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
