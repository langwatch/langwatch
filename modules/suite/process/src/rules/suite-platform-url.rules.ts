/**
 * One suite resource's platform address: `publicBaseUrl`, the project's
 * slug, and the path already resolved. Mirrors `agent-platform-url.rules.ts`
 * — REST declarations are static, with no request-scoped builder, so the app composes the link.
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
