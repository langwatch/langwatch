/**
 * One workflow resource's platform address: the app's `publicBaseUrl`, the
 * project's slug, and an already-resolved path. Mirrors
 * `suite-platform-url.rules.ts`/`agent-platform-url.rules.ts` since REST is static.
 */
export function workflowPlatformUrl({
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
