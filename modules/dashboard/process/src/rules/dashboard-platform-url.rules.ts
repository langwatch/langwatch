/**
 * The platform's own address for a dashboard: the deployment's public
 * origin, the project's slug, and the resolved path. Mirrors the deleted
 * `createPlatformUrlBuilder`: an absent origin builds a relative link, never refuses.
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
