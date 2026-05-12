import { Group, HStack, IconButton, Text } from "@chakra-ui/react";
import { AArrowDown, AArrowUp } from "lucide-react";
import type React from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";
import { type Density, useDensityStore } from "../../stores/densityStore";

const OPTIONS: {
  density: Density;
  label: string;
  Icon: typeof AArrowDown;
}[] = [
  { density: "compact", label: "Compact", Icon: AArrowDown },
  { density: "comfortable", label: "Comfortable", Icon: AArrowUp },
];

const INACTIVE_ICON_OPACITY = 0.7;

export const DensityToggle: React.FC = () => {
  const density = useDensityStore((s) => s.density);
  const setDensity = useDensityStore((s) => s.setDensity);

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
          return (
            <IconButton
              key={value}
              aria-label={label}
              aria-pressed={isActive}
              variant={isActive ? "outline" : "outline"}
              bg={isActive ? "transparent" : "bg.emphasized"}
              size="2xs"
              onClick={() => setDensity(value)}
            >
              <Icon size={16} opacity={isActive ? 1 : INACTIVE_ICON_OPACITY} />
            </IconButton>
          );
        })}
      </Group>
    </Tooltip>
  );
};
