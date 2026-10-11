import { Box } from "@langwatch/design-system/primitives";
import type { BoxProps } from "@langwatch/design-system/primitives";

export type TypeMode = "expressive" | "productive";

const COMPACT = "@media (max-width: 47.99rem)";

/** Reading and reference scales share Inter; prose keeps the more generous measure and leading. */
export const TYPE_MODES: Record<TypeMode, Record<string, string | Record<string, string>>> = {
  expressive: {
    "--docs-font-heading": "var(--chakra-fonts-heading)",
    "--docs-weight-heading": "600",
    "--docs-body-size": "16px",
    "--docs-body-line": "28px",
    "--docs-h2-size": "24px",
    "--docs-h2-line": "32px",
    "--docs-h3-size": "20px",
    "--docs-h3-line": "28px",
    "--docs-heading-tracking": "0",
    [COMPACT]: {
      "--docs-body-size": "16px",
      "--docs-body-line": "26px",
      "--docs-h2-size": "24px",
      "--docs-h2-line": "32px",
      "--docs-h3-size": "20px",
      "--docs-h3-line": "30px",
    },
  },
  productive: {
    "--docs-font-heading": "var(--chakra-fonts-heading)",
    "--docs-weight-heading": "600",
    "--docs-body-size": "14px",
    "--docs-body-line": "20px",
    "--docs-h2-size": "20px",
    "--docs-h2-line": "28px",
    "--docs-h3-size": "16px",
    "--docs-h3-line": "24px",
    "--docs-heading-tracking": "-0.01em",
  },
};

export function TypeRegion({ mode, children, css, ...rest }: BoxProps & { mode: TypeMode }) {
  return (
    <Box
      data-type-mode={mode}
      fontSize="var(--docs-body-size)"
      lineHeight="var(--docs-body-line)"
      minWidth="0"
      css={{ ...TYPE_MODES[mode], ...css }}
      {...rest}
    >
      {children}
    </Box>
  );
}
