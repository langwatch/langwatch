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

/** The run link's origin: BASE_HOST, else the deprecated NEXT_PUBLIC_BASE_URL, flagged to warn. */
export const runLinkBaseOf = ({
  publicBaseUrl,
  legacyPublicBaseUrl,
}: {
  publicBaseUrl: string | undefined;
  legacyPublicBaseUrl: string | undefined;
}): { baseUrl: string | undefined; deprecated: boolean } =>
  publicBaseUrl
    ? { baseUrl: publicBaseUrl, deprecated: false }
    : { baseUrl: legacyPublicBaseUrl, deprecated: legacyPublicBaseUrl !== undefined };
