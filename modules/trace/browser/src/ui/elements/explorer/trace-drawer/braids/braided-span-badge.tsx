import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import type { BraidStrand } from "../../../../../model/braids/braided-span.ts";

/**
 * Names the project a braided span came from, drawn as the row's model pill is. Compact, it is
 * the mark alone, naming the owner in its tooltip and accessible label.
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
  if (compact) {
    return (
      <Tooltip content={label} positioning={{ placement: "top" }}>
        <Box
          as="span"
          display="inline-flex"
          flexShrink={0}
          color="fg.muted"
          data-testid="braided-span-badge"
          data-compact="true"
        >
          <FeatureMark feature="braids" size={12} label={label} />
        </Box>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={label} positioning={{ placement: "top" }}>
      <HStack
        as="span"
        gap={1}
        flexShrink={0}
        paddingX={1.5}
        borderRadius="full"
        borderWidth="1px"
        borderColor="border.muted"
        bg="bg.subtle"
        color="fg.muted"
        data-testid="braided-span-badge"
      >
        <FeatureMark feature="braids" size={10} />
        <Text as="span" textStyle="2xs" whiteSpace="nowrap" lineHeight={1.4}>
          {strand.ownerName}
        </Text>
      </HStack>
    </Tooltip>
  );
}
