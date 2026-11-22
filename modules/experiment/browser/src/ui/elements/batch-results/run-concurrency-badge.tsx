import { Badge, chakra } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { runConcurrencyExplanation } from "../../../model/batch-evaluation-results.run-concurrency.ts";

/**
 * "Concurrency N" with its explanation on hover. The explanation also sits in a hidden node with
 * `explanationId`, so a focusable control can point `aria-describedby` at it for keyboard and
 * screen reader users. `focusable` makes the badge itself that control, for a badge outside one.
 */
export const RunConcurrencyBadge = ({
  concurrency,
  explanationId,
  focusable = false,
  testId,
}: {
  concurrency: number;
  explanationId: string;
  focusable?: boolean;
  testId: string;
}) => {
  const explanation = runConcurrencyExplanation(concurrency);
  return (
    <>
      <Tooltip content={explanation} openDelay={300}>
        <Badge
          size="xs"
          variant="outline"
          flexShrink={0}
          data-testid={testId}
          {...(focusable ? { tabIndex: 0, "aria-describedby": explanationId } : {})}
        >
          {`Concurrency ${concurrency}`}
        </Badge>
      </Tooltip>
      <chakra.span id={explanationId} hidden>
        {explanation}
      </chakra.span>
    </>
  );
};
