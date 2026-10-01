/**
 * The door's fixed budgets and how it names a caller. The per-caller bucket is
 * fairness only (the session and address are self-asserted); the global bucket
 * is the bound. See modules/rum/specs/browser-telemetry-ingest.feature.
 */
export const RUM_PER_CALLER_PER_MINUTE = 120;
export const RUM_GLOBAL_PER_MINUTE = 6_000;
export const RUM_RATE_LIMIT_WINDOW_SECONDS = 60;
export const RUM_GLOBAL_RATE_LIMIT_KEY = "rum:global";

/** The session the browser sent, else the nearest hop's address: the last entry is ours. */
export function rumCallerKey({
  session,
  forwardedFor,
}: Readonly<{ session: string | undefined; forwardedFor: string | undefined }>): string {
  if (session) return `session:${session.slice(0, 64)}`;

  const hops = forwardedFor?.split(",") ?? [];
  const nearest = hops[hops.length - 1]?.trim();
  return `ip:${nearest ?? "unknown"}`;
}

export function rumCallerRateLimitKey(callerKey: string): string {
  return `rum:caller:${callerKey}`;
}

/** The collector's traces address under the configured OTLP base. */
export function collectorTracesUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/v1/traces`;
}

/** `key=value,key2=value2` headers, lower-cased, over a JSON content type. */
export function collectorHeaders(raw: string | undefined): Readonly<Record<string, string>> {
  const pairs: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    pairs[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }
  return collectorHeadersFrom(pairs);
}

/** Parsed header pairs, lower-cased and emptied of blanks, over a JSON content type. */
export function collectorHeadersFrom(
  pairs: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const [name, value] of Object.entries(pairs)) {
    if (name && value) headers[name.toLowerCase()] = value;
  }
  return headers;
}

export const DEPRECATED_COLLECTOR_VARIABLES = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
] as const;
export const COLLECTOR_VARIABLES = ["RUM_COLLECTOR_ENDPOINT", "RUM_COLLECTOR_HEADERS"] as const;

type CollectorSource = Readonly<{
  endpoint: string | undefined;
  headers: Readonly<Record<string, string>>;
}>;

export type CollectorTarget =
  | Readonly<{
      configured: true;
      tracesUrl: string;
      headers: Readonly<Record<string, string>>;
      deprecated: boolean;
    }>
  | Readonly<{ configured: false }>;

/** rum's own collector wins; observability's is the deprecated fallback; neither serves nothing. */
export function collectorTargetOf({
  own,
  telemetry,
}: Readonly<{ own: CollectorSource; telemetry: CollectorSource }>): CollectorTarget {
  if (own.endpoint !== undefined) {
    return {
      configured: true,
      tracesUrl: collectorTracesUrl(own.endpoint),
      headers: own.headers,
      deprecated: false,
    };
  }
  if (telemetry.endpoint !== undefined) {
    return {
      configured: true,
      tracesUrl: collectorTracesUrl(telemetry.endpoint),
      headers: telemetry.headers,
      deprecated: true,
    };
  }
  return { configured: false };
}
