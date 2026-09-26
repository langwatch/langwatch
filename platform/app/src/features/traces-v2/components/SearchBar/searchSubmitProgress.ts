/**
 * What the bar says between Enter and the result. Routing is one request, but
 * a sentence routed to an Instant Eval is followed by an estimate and a start
 * before the progress bar exists, and each takes seconds: the bar names the
 * step so Enter is never followed by a still page.
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
