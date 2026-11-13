import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import type { BraidStrand } from "../../../../../model/braids/braided-span.ts";

/** Wide enough for a project name beside the row's other pills; longer ends in an ellipsis. */
const OWNER_MAX_WIDTH = "10rem";
/** The smallest the braids mark stays legible at in a waterfall row. */
const COMPACT_MARK_SIZE = 16;

/**
 * Names the project a braided span came from, quieter than the span's own name. Compact, it is
 * the bare mark, naming the owner in its tooltip and accessible label.
 */
export function BraidedSpanBadge({
  strand,
  compact = false,
}: {
  strand: BraidStrand | null;
  compact?: boolean;
}) {
  if (!strand) return null;
  const label = `Braided from ${strand.ownerName}`;
  return (
    <Tooltip content={label} positioning={{ placement: "top" }}>
      <Box
        as="span"
        display="inline-flex"
        alignItems="center"
        flexShrink={0}
        data-testid="braided-span-badge"
        data-compact={compact ? "true" : undefined}
      >
        {compact ? (
          <FeatureMark feature="braids" size={COMPACT_MARK_SIZE} label={label} />
        ) : (
          <HStack as="span" gap={1} aria-label={label}>
            <FeatureMark feature="braids" size={12} />
            <Text as="span" textStyle="2xs" color="fg.muted" truncate maxWidth={OWNER_MAX_WIDTH}>
              {strand.ownerName}
            </Text>
          </HStack>
        )}
      </Box>
    </Tooltip>
  );
}
