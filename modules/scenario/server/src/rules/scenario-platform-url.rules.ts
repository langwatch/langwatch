/**
 * One scenario resource's platform address: the app's `publicBaseUrl`, the
 * project's slug, and the resolved path. Mirrors the agent/suite platform-url
 * rules — REST declarations are static, with no request-scoped builder.
 */
export function scenarioPlatformUrl({
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
