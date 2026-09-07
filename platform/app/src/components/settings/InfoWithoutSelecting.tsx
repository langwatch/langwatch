import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * Wraps an (i) tooltip that sits inside something clickable, so reading the
 * explanation does not also take the action the container offers.
 *
 * A select option commits on pointer-down rather than click, so an (i) rendered
 * inside one selects that option the moment the pointer lands on the icon. On
 * the organization role field that meant clicking "what is a lite member?"
 * answered the question by making them one, which is a seat change and a
 * billing change.
 */
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
