/**
 * The platform's own deep links into the analytics surfaces, built from
 * `publicBaseUrl` config — same pattern as `agent-platform-url.rules.ts`,
 * since the static REST declaration has no request-scoped builder to receive it.
 */
const WORKBENCH_PATH = "/analytics/query";
const DASHBOARDS_PATH = "/analytics/reports";

function platformUrl(input: {
  publicBaseUrl: string;
  projectSlug: string;
  path: string;
}): string {
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

/** `${publicBaseUrl}/${projectSlug}/analytics/reports`, trailing slash trimmed. */
export function dashboardWidgetPlatformUrl(input: {
  publicBaseUrl: string;
  projectSlug: string;
}): string {
  return platformUrl({ ...input, path: DASHBOARDS_PATH });
}
