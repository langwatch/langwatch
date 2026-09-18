/**
 * One trace resource's platform address: `publicBaseUrl`, project slug,
 * and the caller's resolved path. Mirrors `agent-platform-url.rules.ts` —
 * the `traces` REST declaration has no request-scoped builder.
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
