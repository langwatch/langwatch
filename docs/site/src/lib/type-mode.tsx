import { Box } from "@langwatch/design-system/primitives";
import type { BoxProps } from "@langwatch/design-system/primitives";

export type TypeMode = "expressive" | "productive";

/**
 * The two type systems as CSS variables. Expressive is the brand voice (Sentient headings, a
 * looser larger body); productive is the dense application scale. docs.css reads these only.
 */
export const TYPE_MODES: Record<TypeMode, Record<string, string>> = {
  expressive: {
    "--docs-font-heading": "var(--chakra-fonts-display)",
    "--docs-weight-heading": "400",
    "--docs-body-size": "17px",
    "--docs-body-line": "30px",
    "--docs-h2-size": "28px",
    "--docs-h2-line": "36px",
    "--docs-h3-size": "22px",
    "--docs-h3-line": "30px",
    "--docs-heading-tracking": "-0.01em",
  },
  productive: {
    "--docs-font-heading": "var(--chakra-fonts-heading)",
    "--docs-weight-heading": "600",
    "--docs-body-size": "14px",
    "--docs-body-line": "24px",
    "--docs-h2-size": "20px",
    "--docs-h2-line": "28px",
    "--docs-h3-size": "16px",
    "--docs-h3-line": "24px",
    "--docs-heading-tracking": "-0.005em",
  },
};

/** A region that sets one type mode for everything inside it; dense components nest a productive one. */
export function TypeRegion({ mode, children, ...rest }: BoxProps & { mode: TypeMode }) {
  return (
    <Box data-type-mode={mode} style={TYPE_MODES[mode]} fontSize="var(--docs-body-size)" lineHeight="var(--docs-body-line)" minWidth="0" {...rest}>
      {children}
    </Box>
  );
}
