import { Box } from "@chakra-ui/react";
import type React from "react";
import { useViewStore } from "../stores/viewStore";

export const DensityProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const density = useViewStore((s) => s.density);
  return (
    <Box data-density={density} height="full" width="full">
      {children}
    </Box>
  );
};
