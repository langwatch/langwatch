/**
 * What the Evaluate dialog says when the run it just asked for did not start. Only a
 * failure of this dialog's own attempt counts: an older run's error is not this one's.
 */
export function evaluationStartFailure({
  hasStarted,
  evaluation,
}: {
  hasStarted: boolean;
  evaluation: { status?: string | undefined; error?: string | undefined } | undefined;
}): string | undefined {
  if (!hasStarted || evaluation?.status !== "error") return undefined;
  return evaluation.error || "The evaluation did not start. Try again.";
}
