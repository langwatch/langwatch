/**
 * What a process has decided before telemetry starts: semantic values only,
 * declared structurally rather than imported from `@langwatch/config`, so this
 * package stays below configuration — the rule `otlp-metrics.ts` already follows.
 */

/** A push to the collector, or a scrape door the collector pulls. */
export type MetricsMode = "otlp" | "prometheus";

export type TelemetrySettings = Readonly<{
  /** The collector's base URL; absent means this process exports nothing. */
  otlpEndpoint: string | undefined;
  /** Which install this is, on every signal's resource. */
  environment: string;
  /** Build identity on log records; absent leaves the field off. */
  serviceVersion: string | undefined;
  /** `OTEL_RESOURCE_ATTRIBUTES`, still in its environment encoding. */
  resourceAttributes: string | undefined;
  /** Share of root traces kept, in [0, 1]. Absent keeps the SDK default. */
  tracesSampleRatio: number | undefined;
  logs: Readonly<{
    format: "pretty" | "json" | undefined;
    level: string | undefined;
    consoleLevel: string | undefined;
    otelLevel: string | undefined;
    otelExport: boolean;
  }>;
  metrics: Readonly<{ mode: MetricsMode; enabled: boolean }>;
}>;

/**
 * A declared secret as the resolver reads one. `Secret.load` builds this same
 * shape; declaring it here keeps the id in one place without this package
 * depending on `@langwatch/secrets`.
 */
export type TelemetrySecret = Readonly<{
  id: string;
  optional: boolean;
  schema: undefined;
  resolvesTo: string | undefined;
}>;

/** The collector's auth headers are a credential, never a config field (ADR-132). */
export const otlpHeadersSecret: TelemetrySecret = {
  id: "OTEL_EXPORTER_OTLP_HEADERS",
  optional: true,
  schema: void 0,
  resolvesTo: void 0,
};

/** The bearer a Prometheus scrape presents. Absent leaves the door open. */
export const metricsScrapeTokenSecret: TelemetrySecret = {
  id: "LANGWATCH_METRICS_TOKEN",
  optional: true,
  schema: void 0,
  resolvesTo: void 0,
};

/** The one capability telemetry needs of the resolver: a value into a closure. */
export type TelemetrySecrets = Readonly<{
  into: <Out>(
    handle: TelemetrySecret,
    build: (value: string | undefined) => Out | Promise<Out>,
  ) => Promise<Out>;
}>;

/** What the preamble hands a telemetry or metrics factory (§4). */
export type TelemetryContext = Readonly<{
  config: Readonly<{ observability: TelemetrySettings }>;
  secrets: TelemetrySecrets;
  /** Field paths every log record masks; the boot seam names them, this package holds none. */
  redactPaths?: readonly string[];
}>;

/** `key=value,key2=value2` — the OTLP environment encoding for headers. */
export function otlpHeadersFrom(value: string | undefined): Readonly<Record<string, string>> {
  return pairsFrom(value, (raw) => raw);
}

/** The same encoding, with the spec's percent-escaping applied to values. */
export function resourceAttributesFrom(
  value: string | undefined,
): Readonly<Record<string, string>> {
  return pairsFrom(value, decodePercent);
}

function pairsFrom(
  value: string | undefined,
  decode: (raw: string) => string,
): Readonly<Record<string, string>> {
  const pairs: Record<string, string> = {};
  for (const pair of value?.split(",") ?? []) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    pairs[pair.slice(0, separator).trim()] = decode(pair.slice(separator + 1).trim());
  }
  return pairs;
}

/** A value the collector would reject is worse than the literal it was written as. */
function decodePercent(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
