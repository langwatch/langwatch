import { Chip } from "@langwatch/design-system/chip";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { Box } from "@langwatch/design-system/primitives";

import type { BraidStrand } from "../../../../../model/braids/braided-span.ts";

/** Wide enough for a project name beside the row's other pills; longer ends in an ellipsis. */
const OWNER_MAX_WIDTH = "10rem";
/** The smallest the braids mark stays legible at in a waterfall row. */
const COMPACT_MARK_SIZE = 16;

function BraidsIcon() {
  return <FeatureMark feature="braids" size={12} />;
}

/**
 * Names the project a braided span came from, drawn as the header's braided pill is. Compact, it
 * is the mark alone, naming the owner in its tooltip and accessible label.
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
    <Box
      as="span"
      display="inline-flex"
      flexShrink={0}
      data-testid="braided-span-badge"
      data-compact={compact ? "true" : undefined}
    >
      {compact ? (
        <Chip
          value={<FeatureMark feature="braids" size={COMPACT_MARK_SIZE} label={label} />}
          tooltip={label}
          tone="neutral"
        />
      ) : (
        <Chip
          icon={BraidsIcon}
          value={strand.ownerName}
          tooltip={label}
          ariaLabel={label}
          tone="neutral"
          maxValueWidth={OWNER_MAX_WIDTH}
        />
      )}
    </Box>
  );
}
