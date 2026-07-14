/**
 * Builders for Grafana Explore deep links, so a trace/span id can become a URL a
 * developer clicks to land straight on the failing trace (Tempo) or its logs
 * (Loki) — in HTTP error bodies, the Langy "view trace" link, anywhere an id is
 * surfaced.
 *
 * Pure and isomorphic: no env reads, no side effects, just id + config → URL. The
 * server reads GRAFANA_BASE_URL and calls these; the result travels to the client
 * as a ready-made href, so the base URL never has to leak to the browser.
 *
 * The default datasource uids (`tempo`/`loki`) are the fixed uids the local
 * grafana/otel-lgtm bundle provisions, so links work out of the box under haven.
 * A different Grafana (production) overrides them via config.
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
 * Fails closed: a malformed `GRAFANA_BASE_URL` (a bare host with no scheme, an
 * empty string, anything `new URL` rejects) returns null rather than throwing.
 * These builders run on the error path (serialized domain errors, HTTP error
 * bodies), so a bad env value must never turn a handled error into a second throw.
 */
function buildExploreUrl(
  baseUrl: string,
  pane: Record<string, unknown>,
): string | null {
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
export function grafanaTraceUrl(
  traceId: string,
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
 * Both links for an error that carries a trace id — trace-first (the usual
 * "what happened"), logs as the companion. Returns null when there is no base
 * URL configured (no observability stack / no Grafana) or when it is malformed,
 * so callers can fall back to plain ids without special-casing.
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

/**
 * Resolve the deep-link config from the environment (server-side). GRAFANA_BASE_URL
 * is set by haven when the local observability stack is up, or by ops in
 * production; the datasource uids default to the LGTM bundle's and only need
 * overriding for a Grafana whose uids differ. On the client these read as
 * undefined, so the builders return null and callers fall back to plain ids —
 * which is why the href is built on the server and passed down.
 */
export function grafanaConfigFromEnv(): {
  baseUrl?: string;
  tempoDatasourceUid?: string;
  lokiDatasourceUid?: string;
} {
  return {
    baseUrl: process.env.GRAFANA_BASE_URL,
    tempoDatasourceUid: process.env.GRAFANA_TEMPO_DATASOURCE_UID,
    lokiDatasourceUid: process.env.GRAFANA_LOKI_DATASOURCE_UID,
  };
}

/**
 * The Grafana trace link for a REAL trace id (pass the actual trace id, not a
 * display/span id), resolved from the environment. Returns undefined when no
 * Grafana is configured (no GRAFANA_BASE_URL) or there is no trace id — so it is
 * safe to spread into any serialized error.
 *
 * Safe in production too: Grafana is access-controlled (behind AWS auth, not
 * public), so surfacing the URL leaks nothing — a client without access just
 * can't follow it.
 */
export function grafanaTraceUrlFromEnv(
  traceId: string | undefined,
): string | undefined {
  if (!traceId) return undefined;
  const { baseUrl, tempoDatasourceUid } = grafanaConfigFromEnv();
  if (!baseUrl) return undefined;
  // null (malformed base URL) coalesces to undefined so it stays safe to spread.
  return grafanaTraceUrl(traceId, { baseUrl, tempoDatasourceUid }) ?? undefined;
}
