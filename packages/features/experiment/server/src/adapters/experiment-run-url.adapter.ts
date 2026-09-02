/**
 * Builds the shareable results-page URL for an experiment workbench run.
 *
 * The base URL is a parameter rather than a `process.env` read: a package does
 * not read the environment, and the deployment's public base URL is one of the
 * facts the process parses once and injects.
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
