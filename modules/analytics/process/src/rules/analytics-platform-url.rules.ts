/**
 * The platform's own deep link into the analytics workbench, built from
 * `publicBaseUrl` config — same pattern as `agent-platform-url.rules.ts`,
 * since the static REST declaration has no request-scoped builder to receive it.
 */
const WORKBENCH_PATH = "/analytics/query";

function platformUrl(input: { publicBaseUrl: string; projectSlug: string; path: string }): string {
  const base = input.publicBaseUrl.replace(/\/+$/, "");
  return `${base}/${input.projectSlug}${input.path}`;
}

/** `${publicBaseUrl}/${projectSlug}/analytics/query`, trailing slash trimmed. */
export function savedWorkbenchChartPlatformUrl(input: {
  publicBaseUrl: string;
  projectSlug: string;
}): string {
  return platformUrl({ ...input, path: WORKBENCH_PATH });
}
