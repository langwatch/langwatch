/**
 * Grafana Explore deep links, as the queue and process surfaces build them.
 *
 * A family-local copy of the browser-side half of
 * `platform/app/src/utils/grafanaLinks.ts`, which stays where it is because the
 * error handler, the tRPC root and the PostHog capture all still call it — and
 * `platform/app` may only shrink, so repointing them is not on the table.
 *
 * WHAT DELIBERATELY DID NOT COME: `grafanaConfigFromEnv` and
 * `grafanaTraceUrlFromEnv`. They read `process.env`, which is a server fact and
 * one of the browser capabilities a screen closure may not name. The config
 * still arrives the way it always did — the server answers
 * `ops.getGrafanaLinkConfig` and the browser turns an id into an href.
 *
 * Pure and isomorphic: no env reads, no side effects, just id + config → URL.
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
 * Wrap a single Explore query pane in the `panes`/`schemaVersion=1` URL shape
 * Grafana has used since 10.1 (current through 13.x). The pane key is arbitrary.
 *
 * Fails closed: a malformed base URL (a bare host with no scheme, an empty
 * string, anything `new URL` rejects) returns null rather than throwing, so a
 * misconfigured Grafana never turns a rendered row into a blank page.
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

/** Escape a value for interpolation into a double-quoted TraceQL/LogQL string. */
function escapeQueryString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * A Grafana Explore link to every span the queue executed for one group.
 * GroupQueue stamps `queue.group_id` on each consumer span, so the TraceQL
 * attribute match is exact — no substring false positives across groups that
 * share a prefix. Returns null when the base URL is malformed.
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
 * A Grafana Explore link to the log lines mentioning one group. A line-contains
 * filter rather than a label matcher: the group id is logged as an ordinary
 * field by whichever worker touches the group, not indexed as a stream label.
 * Returns null when the base URL is malformed.
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
