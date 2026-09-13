/**
 * The platform's own deep links back into the analytics surfaces, built from
 * the app's own `publicBaseUrl` config: the SAME pattern
 * `modules/agent/server/src/rules/agent-platform-url.rules.ts` uses, because
 * the REST declaration is a static, module-load-time object with no
 * request-scoped builder to receive — the app composes the link itself from
 * config it already holds.
 *
 * Two paths, because the two families that publish a deep link point at two
 * different pages: the Workbench editor for a saved LangWatchQL chart
 * (`savedWorkbenchChartUrl`), and the dashboards list for a playground widget
 * (`dashboardWidgetUrl`).
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
