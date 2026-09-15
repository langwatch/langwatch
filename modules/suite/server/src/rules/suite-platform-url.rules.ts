/**
 * One suite resource's platform address: the app's `publicBaseUrl`, the
 * project's slug, and the path the caller already resolved. Mirrors
 * `agent-platform-url.rules.ts` — the REST declarations are static objects
 * with no request-scoped builder, so the app composes the link itself.
 */
export function suitePlatformUrl({
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
