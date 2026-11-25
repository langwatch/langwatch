/**
 * One evaluator resource's platform address, from `publicBaseUrl`,
 * project slug and an already-resolved path. Mirrors
 * `suite-platform-url.rules.ts` / `agent-platform-url.rules.ts`.
 */
export function evaluatorPlatformUrl({
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
