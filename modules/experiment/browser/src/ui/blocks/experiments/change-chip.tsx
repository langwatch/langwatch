import { Badge } from "@langwatch/design-system/primitives";

import type { ChangeInWords } from "../../../model/experiments/experiment-list-metrics.ts";

const PALETTE = { good: "green", bad: "red", flat: "gray" } as const;

/** A change in words ("1.3 pt better"), green or red only when the direction is known. */
export const ChangeChip = ({ change }: { change: ChangeInWords }) => (
  <Badge size="sm" variant="subtle" colorPalette={PALETTE[change.tone]} whiteSpace="nowrap">
    {change.text}
  </Badge>
);
