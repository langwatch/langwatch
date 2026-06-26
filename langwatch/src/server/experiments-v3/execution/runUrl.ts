/**
 * Builds the shareable results-page URL for an evaluations-v3 run. Shared by
 * the run API and the workflow evaluate endpoint so every entry point returns
 * the same link a caller can open in the browser.
 */
export const getRunUrl = (
  projectSlug: string,
  experimentSlug: string,
  runId: string,
): string => {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://app.langwatch.ai";
  return `${baseUrl}/${projectSlug}/experiments/${experimentSlug}?runId=${runId}`;
};
