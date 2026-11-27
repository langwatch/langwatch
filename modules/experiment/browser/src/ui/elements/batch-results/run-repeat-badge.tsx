import { Badge } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { runRepeatExplanation } from "../../../model/batch-evaluation-results.run-repeat.ts";

/** "Repeat N" with what it means on hover, for a run that repeated its dataset rows. */
export const RunRepeatBadge = ({ repeat, testId }: { repeat: number; testId: string }) => (
  <Tooltip content={runRepeatExplanation(repeat)} openDelay={300}>
    <Badge
      size="xs"
      variant="outline"
      flexShrink={0}
      data-testid={testId}
      aria-label={runRepeatExplanation(repeat)}
    >
      {`Repeat ${repeat}`}
    </Badge>
  </Tooltip>
);
