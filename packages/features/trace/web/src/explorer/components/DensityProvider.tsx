import { Box } from "@chakra-ui/react";
import type React from "react";
import { useDensityStore } from "../../index";

export const DensityProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const density = useDensityStore((s) => s.density);
  return (
    <Box data-density={density} height="full" width="full">
      {children}
    </Box>
  );
};
