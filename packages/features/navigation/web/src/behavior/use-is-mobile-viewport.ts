import { useBreakpointValue } from "@chakra-ui/react";

/**
 * Whether the viewport is phone-width, which is where the navigation-v2
 * shells trade the sidebar chrome for the compact mobile bar and its
 * full-screen menu. Below Chakra's `md` breakpoint the sidebar has no
 * room to earn; between `md` and `lg` the compact hover-expanded
 * sidebar still works.
 *
 * Spec: specs/navigation/mobile-chrome.feature
 */
export function useIsMobileViewport(): boolean {
  return useBreakpointValue({ base: true, md: false }, { fallback: "md" }) === true;
}
