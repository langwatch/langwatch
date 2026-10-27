/**
 * One monitor resource's platform address: the app's `publicBaseUrl`, the
 * project's slug, and the path the caller already resolved. Mirrors
 * `suite-platform-url.rules.ts` — the REST declaration has no request-scoped builder.
 */
export function monitorPlatformUrl({
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
