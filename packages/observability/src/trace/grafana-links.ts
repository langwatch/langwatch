/**
 * Grafana Explore deep links: pure builders that take id + config → URL.
 */

export const DEFAULT_TEMPO_DATASOURCE_UID = "tempo";
export const DEFAULT_LOKI_DATASOURCE_UID = "loki";

export interface GrafanaDeepLinkConfig {
  /** Grafana base URL, e.g. `http://127.0.0.1:3000` or `https://grafana.example.com`. */
  baseUrl: string;
  /** Tempo datasource uid (defaults to the LGTM bundle's `tempo`). */
  tempoDatasourceUid?: string;
  /** Loki datasource uid (defaults to the LGTM bundle's `loki`). */
  lokiDatasourceUid?: string;
  /** Explore time range start (Grafana relative or absolute). Defaults to `now-1h`. */
  from?: string;
  /** Explore time range end. Defaults to `now`. */
  to?: string;
}

const DEFAULT_FROM = "now-1h";
const DEFAULT_TO = "now";

/**
 * Wrap a single Explore query pane: fails closed (returns null, never throws) so
 * a bad base URL doesn't turn a handled error into a second throw.
 */
function buildExploreUrl(baseUrl: string, pane: Record<string, unknown>): string | null {
  let url: URL;
  try {
    url = new URL("/explore", ensureTrailingSlash(baseUrl));
  } catch {
    return null;
  }
  url.searchParams.set("schemaVersion", "1");
  url.searchParams.set("orgId", "1");
  url.searchParams.set("panes", JSON.stringify({ lw: pane }));
  return url.toString();
}

// new URL("/explore", base) needs the base to be a valid absolute URL; a bare
// host without a scheme would throw (caught in buildExploreUrl). Callers pass a
// full URL, but tolerate a trailing slash either way.
function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
}

/**
 * A Grafana Explore link that opens the trace with this id in Tempo. A bare
 * trace id is valid TraceQL, so Grafana resolves it straight to the trace view.
 * Returns null when the base URL is malformed (see buildExploreUrl).
 */
export function grafanaTraceUrl(traceId: string, config: GrafanaDeepLinkConfig): string | null {
  const uid = config.tempoDatasourceUid ?? DEFAULT_TEMPO_DATASOURCE_UID;
  return buildExploreUrl(config.baseUrl, {
    datasource: uid,
    queries: [
      {
        refId: "A",
        datasource: { type: "tempo", uid },
        queryType: "traceql",
        query: traceId,
      },
    ],
    range: { from: config.from ?? DEFAULT_FROM, to: config.to ?? DEFAULT_TO },
  });
}

/**
 * A Grafana Explore link that opens the Loki logs carrying this trace id. Useful
 * when the log line, not the span, is what you want to read. Returns null when
 * the base URL is malformed (see buildExploreUrl).
 */
export function grafanaLogsUrlByTrace(
  traceId: string,
  config: GrafanaDeepLinkConfig,
): string | null {
  const uid = config.lokiDatasourceUid ?? DEFAULT_LOKI_DATASOURCE_UID;
  return buildExploreUrl(config.baseUrl, {
    datasource: uid,
    queries: [
      {
        refId: "A",
        datasource: { type: "loki", uid },
        editorMode: "code",
        queryType: "range",
        // trace_id arrives as OTLP structured metadata on the log, filterable
        // with a label matcher; the `{service_name=~".+"}` selector just means
        // "any stream". Loki's own derived field links the other direction.
        expr: `{service_name=~".+"} | trace_id=\`${traceId}\``,
      },
    ],
    range: { from: config.from ?? DEFAULT_FROM, to: config.to ?? DEFAULT_TO },
  });
}

/**
 * Both links for an error with a trace id — trace-first, logs as companion.
 * Returns null with no base URL configured or a malformed one, so callers
 * fall back to plain ids without special-casing.
 */
export function grafanaLinksForTrace(
  traceId: string | undefined,
  config: Partial<GrafanaDeepLinkConfig> & { baseUrl?: string },
): { traceUrl: string; logsUrl: string } | null {
  if (!traceId || !config.baseUrl) return null;
  const full: GrafanaDeepLinkConfig = { ...config, baseUrl: config.baseUrl };
  const traceUrl = grafanaTraceUrl(traceId, full);
  const logsUrl = grafanaLogsUrlByTrace(traceId, full);
  if (!traceUrl || !logsUrl) return null;
  return { traceUrl, logsUrl };
}

/** Escape a value for interpolation into a double-quoted TraceQL/LogQL string. */
function escapeQueryString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * A Grafana Explore link to every span the queue executed for one group.
 * GroupQueue stamps `queue.group_id` on each consumer span, so the match is
 * exact — no false positives across groups sharing a prefix. Null if malformed.
 */
export function grafanaGroupTracesUrl(
  groupId: string,
  config: GrafanaDeepLinkConfig,
): string | null {
  const uid = config.tempoDatasourceUid ?? DEFAULT_TEMPO_DATASOURCE_UID;
  return buildExploreUrl(config.baseUrl, {
    datasource: uid,
    queries: [
      {
        refId: "A",
        datasource: { type: "tempo", uid },
        queryType: "traceql",
        query: `{span.queue.group_id="${escapeQueryString(groupId)}"}`,
      },
    ],
    range: { from: config.from ?? DEFAULT_FROM, to: config.to ?? DEFAULT_TO },
  });
}

/**
 * A Grafana Explore link to log lines mentioning one group — a line-contains
 * filter, not a label matcher, since the group id is an ordinary logged
 * field, not indexed as a stream label. Null when the base URL is malformed.
 */
export function grafanaGroupLogsUrl(groupId: string, config: GrafanaDeepLinkConfig): string | null {
  const uid = config.lokiDatasourceUid ?? DEFAULT_LOKI_DATASOURCE_UID;
  return buildExploreUrl(config.baseUrl, {
    datasource: uid,
    queries: [
      {
        refId: "A",
        datasource: { type: "loki", uid },
        editorMode: "code",
        queryType: "range",
        expr: `{service_name=~".+"} |= "${escapeQueryString(groupId)}"`,
      },
    ],
    range: { from: config.from ?? DEFAULT_FROM, to: config.to ?? DEFAULT_TO },
  });
}
