/**
 * One trace resource's platform address: the app's `publicBaseUrl`, the
 * project's slug, and the path the caller already resolved. Mirrors
 * `agent-platform-url.rules.ts` and `suite-platform-url.rules.ts` — the
 * `traces` REST declaration is a static object with no request-scoped
 * builder, so the app composes the link itself.
 */
export function tracePlatformUrl({
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
