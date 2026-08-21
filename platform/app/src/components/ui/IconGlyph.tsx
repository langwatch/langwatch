import { Box } from "@chakra-ui/react";
// biome-ignore lint/style/useImportType: React is needed at runtime for JSX in non-jsdom test environments
import React from "react";

/**
 * Renders a vendor mark at a fixed size, dark-mode safe. Wrapper-level (not
 * fixed in the SVGs themselves) because the icon components are shared
 * across surfaces that render on different backgrounds — inverting only the
 * monochrome ones here keeps brand-coloured marks untouched. The caller
 * decides which marks are monochrome: flat near-black fills vanish on the
 * dark theme, brand-coloured marks read fine in both modes.
 */
export function IconGlyph({
  icon,
  monochrome = false,
  size = "16px",
  testId,
}: {
  icon: React.ReactNode;
  monochrome?: boolean;
  size?: string | number;
  testId?: string;
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
      data-testid={testId}
    >
      {icon}
    </Box>
  );
}
