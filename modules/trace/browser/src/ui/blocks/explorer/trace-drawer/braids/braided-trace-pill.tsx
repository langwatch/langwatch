import { Chip } from "@langwatch/design-system/chip";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { HStack } from "@langwatch/design-system/primitives";
import type { BraidedOwner } from "@langwatch/trace-contract";

import { joinOwnerNames } from "../../../../../model/braids/braided-span.ts";

/** Room for two owners' names; a longer list ends in an ellipsis, whole in the label. */
const PILL_MAX_WIDTH = "28rem";

/** Says the trace includes spans braided in from other projects; nothing when it has none. */
export function BraidedTracePill({ owners }: { owners: readonly BraidedOwner[] }) {
  if (owners.length === 0) return null;
  const sentence = `Includes spans from ${joinOwnerNames(owners.map((owner) => owner.name))}`;
  return (
    <Chip
      tone="neutral"
      ariaLabel={sentence}
      maxValueWidth={PILL_MAX_WIDTH}
      value={
        <HStack as="span" gap={1}>
          <FeatureMark feature="braids" size={12} variant="mono" />
          {sentence}
        </HStack>
      }
    />
  );
}
