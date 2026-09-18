/**
 * One automation resource's platform address: `publicBaseUrl`, project
 * slug, and the caller's path -- mirrors `suite-platform-url.rules.ts`.
 * No request-scoped builder, so the app composes the link itself.
 */
export function automationPlatformUrl({
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
