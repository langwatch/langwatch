import { Group, IconButton } from "@chakra-ui/react";
import { AArrowDown, AArrowUp } from "lucide-react";
import type React from "react";
import { useUIStore } from "../../stores/uiStore";

export const DensityToggle: React.FC = () => {
  const density = useUIStore((s) => s.density);
  const setDensity = useUIStore((s) => s.setDensity);

  return (
    <Group attached>
      <IconButton
        aria-label="Compact"
        aria-pressed={density === "compact"}
        variant={density === "compact" ? "outline" : "solid"}
        size="xs"
        onClick={() => setDensity("compact")}
      >
        <AArrowDown size={12} opacity={density === "compact" ? 1 : 0.7} />
      </IconButton>
      <IconButton
        aria-label="Comfortable"
        aria-pressed={density === "comfortable"}
        variant={density === "comfortable" ? "outline" : "solid"}
        size="xs"
        onClick={() => setDensity("comfortable")}
      >
        <AArrowUp size={12} opacity={density === "comfortable" ? 1 : 0.7} />
      </IconButton>
    </Group>
  );
};
