import { useBreakpointValue } from "@chakra-ui/react";

/** Viewport is phone-width; trades sidebar for compact mobile bar below Chakra's md breakpoint */
export function useIsMobileViewport(): boolean {
  return useBreakpointValue({ base: true, md: false }, { fallback: "md" }) === true;
}
