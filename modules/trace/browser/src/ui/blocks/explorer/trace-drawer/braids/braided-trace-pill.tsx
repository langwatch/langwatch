import { Chip } from "@langwatch/design-system/chip";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import type { BraidedOwner } from "@langwatch/trace-contract";

import { joinOwnerNames } from "../../../../../model/braids/braided-span.ts";

/** Room for two owners' names; a longer list ends in an ellipsis, whole in the label. */
const PILL_MAX_WIDTH = "20rem";

function BraidsIcon() {
  return <FeatureMark feature="braids" size={12} />;
}

/**
 * Says the trace includes spans braided in from other projects, drawn as the Project chip beside
 * it is; nothing when it has none.
 */
export function BraidedTracePill({ owners }: { owners: readonly BraidedOwner[] }) {
  if (owners.length === 0) return null;
  const names = joinOwnerNames(owners.map((owner) => owner.name));
  return (
    <Chip
      icon={BraidsIcon}
      label="Braided from"
      value={names}
      tone="neutral"
      ariaLabel={`Includes spans from ${names}`}
      maxValueWidth={PILL_MAX_WIDTH}
    />
  );
}
