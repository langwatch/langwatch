import { Box } from "@chakra-ui/react";
import type React from "react";
import { useUIStore } from "../stores/uiStore";

export const DensityProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const density = useUIStore((s) => s.density);
  return (
    <Box data-density={density} height="full" width="full">
      {children}
    </Box>
  );
};
