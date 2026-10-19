/**
 * One dataset resource's platform address: the app's `publicBaseUrl`,
 * project slug, and caller-resolved path. Mirrors `suite-platform-url.rules.ts`
 * / `agent-platform-url.rules.ts`; the app composes this link itself.
 */
export function datasetPlatformUrl({
  publicBaseUrl,
  projectSlug,
  path,
}: {
  publicBaseUrl: string;
  projectSlug: string;
  path: string;
}): string {
  const base = publicBaseUrl.replace(/\/+$/, "");

  return `${base}/${projectSlug}${path}`;
}
