import { Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import type { RetryingEval } from "../../../../../features/trace-drawer/behavior/use-trace-evaluations.ts";
import {
  formatAbsoluteTime,
  formatRelativeTimeUntil,
} from "../../../../../model/display-formatters.ts";

/** The line a retrying run reads as: attempt count, last error, and when the next try is due. */
export function retryingLabelOf(run: RetryingEval): string {
  return [
    "Retrying",
    `attempt ${run.attempts}`,
    run.lastAttemptError ? `last error: ${run.lastAttemptError}` : undefined,
    run.nextAttemptAt !== undefined
      ? `next try ${formatRelativeTimeUntil(run.nextAttemptAt)}`
      : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

/** A pending run the worker is retrying because the evaluator service was down. */
export function RetryingEvalRow({ run }: { run: RetryingEval }) {
  const text = (
    <Text textStyle="xs" color="fg.muted">
      <Text as="span" fontWeight="medium">
        {run.name}
      </Text>
      {": "}
      {retryingLabelOf(run)}
    </Text>
  );
  if (run.lastAttemptAt === undefined) return text;
  return (
    <Tooltip content={`Last attempt ${formatAbsoluteTime(run.lastAttemptAt)}`}>{text}</Tooltip>
  );
}
