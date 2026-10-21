import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import type { BraidStrand } from "../../../../../model/braids/braided-span.ts";

/** Names the project a braided span came from, in that project's strand colour. */
export function BraidedSpanBadge({ strand }: { strand: BraidStrand | null }) {
  if (!strand) return null;
  return (
    <Tooltip content={`Braided from ${strand.ownerName}`} positioning={{ placement: "top" }}>
      <HStack
        as="span"
        gap={1}
        flexShrink={0}
        minWidth={0}
        maxWidth="140px"
        paddingX={1.5}
        borderRadius="full"
        borderWidth="1px"
        borderColor={strand.colour}
        color={strand.colour}
        data-testid="braided-span-badge"
      >
        <FeatureMark feature="braids" size={12} variant="mono" />
        <Text as="span" textStyle="2xs" color="fg" truncate lineHeight={1.4}>
          {strand.ownerName}
        </Text>
      </HStack>
    </Tooltip>
  );
}
