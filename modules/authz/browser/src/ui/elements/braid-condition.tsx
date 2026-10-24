// A braid's condition in code style, or "Every span" when it braids every span.

import { InlineCode } from "@langwatch/design-system/inline-code";
import { Box, Text } from "@langwatch/design-system/primitives";

export function BraidCondition({ where }: { where: string | null }) {
  if (!where) {
    return (
      <Text textStyle="sm" color="fg.muted">
        Every span
      </Text>
    );
  }
  // Ligatures would draw `==` as one glyph, which is not what the condition says.
  return (
    <Box as="span" display="contents" fontVariantLigatures="none">
      <InlineCode variant="neutral" truncate="end" title={where}>
        {where}
      </InlineCode>
    </Box>
  );
}
