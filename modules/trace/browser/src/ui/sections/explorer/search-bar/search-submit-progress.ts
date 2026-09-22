/**
 * What the bar says between Enter and the result: routing, then an Instant
 * Eval's estimate and start, so Enter is never followed by a still page.
 */
export function searchSubmitProgress({
  isRouting,
  isEstimating,
  isStarting,
}: {
  isRouting: boolean;
  isEstimating: boolean;
  isStarting: boolean;
}): string | null {
  if (isRouting) return "Searching";
  if (isEstimating) return "Estimating the Instant Eval";
  if (isStarting) return "Starting the Instant Eval";
  return null;
}
