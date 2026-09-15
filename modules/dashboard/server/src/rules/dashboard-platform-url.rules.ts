/**
 * The platform's own address for a dashboard: the deployment's public
 * origin, the project's slug, and the path the caller already resolved.
 * Mirrors the deleted `createPlatformUrlBuilder` exactly — an absent origin
 * builds a relative link rather than refusing, so a deployment that serves
 * no public host still returns an address the caller can use.
 */
export function dashboardPlatformUrl({
  publicBaseUrl,
  projectSlug,
  path,
}: {
  publicBaseUrl: string | undefined;
  projectSlug: string;
  path: string;
}): string {
  const base = (publicBaseUrl ?? "").replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  return `${base}/${projectSlug}${cleanPath}`;
}
