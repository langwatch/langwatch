import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * Renders a vendor mark at a fixed size, dark-mode safe. Wrapper-level, not
 * fixed in the SVGs, since icons are shared across backgrounds. The caller
 * marks which are monochrome — flat near-black fills vanish on dark themes.
 */
export function IconGlyph({
  icon,
  monochrome = false,
  size = "16px",
}: {
  icon: ReactNode;
  monochrome?: boolean;
  size?: string | number;
}) {
  return (
    <Box
      width={size}
      height={size}
      flexShrink={0}
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      css={{ "& > svg": { width: "100%", height: "100%" } }}
      // Pure invert(1) — monochrome marks are flat black on transparent;
      // rotating hue afterwards would tint the result away from neutral.
      // brightness(0.92) tones the result to off-white so it doesn't
      // hard-burn against the dark surface.
      _dark={monochrome ? { filter: "invert(1) brightness(0.92)" } : undefined}
      aria-hidden="true"
    >
      {icon}
    </Box>
  );
}
