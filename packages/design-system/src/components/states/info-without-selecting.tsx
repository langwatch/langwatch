import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Prevents (i) tooltip from triggering parent action (e.g., select on pointer-down). */
export function InfoWithoutSelecting({ children }: { children: ReactNode }) {
  return (
    <Box
      display="inline-flex"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </Box>
  );
}
