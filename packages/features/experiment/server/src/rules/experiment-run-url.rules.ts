/**
 * Builds the shareable results-page URL for an experiment workbench run.
 */
export const getRunUrl = ({
  baseUrl,
  projectSlug,
  experimentSlug,
  runId,
}: {
  baseUrl: string;
  projectSlug: string;
  experimentSlug: string;
  runId: string;
}): string => `${baseUrl}/${projectSlug}/experiments/${experimentSlug}?runId=${runId}`;
