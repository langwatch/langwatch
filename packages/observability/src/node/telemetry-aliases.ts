/**
 * The telemetry environment as one decision (ADR-175): the standard names win,
 * main's older names are read as aliases with a boot warning, and an alias that
 * disagrees with its replacement refuses the boot rather than guessing.
 */
import type { TelemetrySettings } from "./telemetry-settings.ts";

type Alias = Readonly<{
  deprecated: string;
  current: string;
  /** What the old value means under the new name; absent copies it. */
  translate?: (value: string) => string;
}>;

/** main's flags were opt-in: only `true` switched the signal on. */
const exporterOf = (value: string) => (value === "true" ? "otlp" : "none");

/** Read until the LTS floor passes the first release carrying the new names (ADR-175 Q7). */
export const telemetryAliases: readonly Alias[] = [
  { deprecated: "PINO_LOG_LEVEL", current: "LOG_LEVEL" },
  { deprecated: "_LOG_LEVEL", current: "LOG_LEVEL" },
  { deprecated: "PINO_CONSOLE_LEVEL", current: "LOG_CONSOLE_LEVEL" },
  { deprecated: "PINO_OTEL_LEVEL", current: "LOG_OTEL_LEVEL" },
  { deprecated: "PINO_OTEL_ENABLED", current: "OTEL_LOGS_EXPORTER", translate: exporterOf },
  { deprecated: "OTEL_METRICS_ENABLED", current: "OTEL_METRICS_EXPORTER", translate: exporterOf },
];

export class TelemetryAliasConflictError extends Error {
  constructor(readonly conflicts: readonly string[]) {
    super(`telemetry environment disagrees with itself: ${conflicts.join("; ")}`);
    this.name = "TelemetryAliasConflictError";
  }
}

export type ResolvedTelemetry = Readonly<{
  /** `OTEL_SERVICE_NAME`; absent keeps the process's own name. */
  serviceName: string | undefined;
  /** The collector traces go to; absent when there is none or traces are off. */
  tracesEndpoint: string | undefined;
  logs: Readonly<{
    level: string | undefined;
    consoleLevel: string | undefined;
    otelLevel: string;
    otelExport: boolean;
  }>;
  metrics: Readonly<{
    endpoint: string | undefined;
    /** `prometheus` is listed: a pull reader on its own port, beside any push. */
    pull: boolean;
    /** No exporter list written: main's health-door `/metrics` stays while a key is set (Q3). */
    healthDoor: boolean;
    enabled: boolean;
  }>;
  /** One boot warning per old name in use. */
  deprecations: readonly string[];
}>;

/** Throws `TelemetryAliasConflictError` when an old name and its new one disagree. */
export function resolveTelemetry(settings: TelemetrySettings): ResolvedTelemetry {
  const named: Readonly<Record<string, string | undefined>> = {
    LOG_LEVEL: settings.logs.level,
    LOG_CONSOLE_LEVEL: settings.logs.consoleLevel,
    LOG_OTEL_LEVEL: settings.logs.otelLevel,
    OTEL_LOGS_EXPORTER: settings.logs.exporter,
    OTEL_METRICS_EXPORTER: settings.metrics.exporter,
  };
  const conflicts: string[] = [];
  const deprecations: string[] = [];
  const valueOf = (current: string) =>
    aliasedValue({ current, named, deprecated: settings.deprecated, conflicts, deprecations });

  const level = valueOf("LOG_LEVEL");
  const consoleLevel = valueOf("LOG_CONSOLE_LEVEL") ?? level;
  const otelLevel = valueOf("LOG_OTEL_LEVEL") ?? level ?? "info";
  const logExporters = exportersOf(valueOf("OTEL_LOGS_EXPORTER"));
  const metricExporters = exportersOf(valueOf("OTEL_METRICS_EXPORTER"));
  if (conflicts.length > 0) throw new TelemetryAliasConflictError(conflicts);

  // No collector means nothing leaves the process: no localhost is guessed (Q1).
  const endpoint = settings.sdkDisabled ? undefined : settings.otlpEndpoint;
  const tracesOn = exportersOf(settings.traces.exporter).includes("otlp");

  return {
    serviceName: settings.serviceName,
    tracesEndpoint: tracesOn ? endpoint : undefined,
    logs: {
      level,
      consoleLevel,
      otelLevel,
      otelExport: endpoint !== undefined && logExporters.includes("otlp"),
    },
    metrics: {
      endpoint: metricExporters.includes("otlp") ? endpoint : undefined,
      pull: metricExporters.includes("prometheus"),
      healthDoor: settings.metrics.exporter === undefined,
      enabled: !settings.sdkDisabled && metricExporters.length > 0,
    },
    deprecations,
  };
}

/** The one value a name and its aliases agree on; a disagreement joins `conflicts`. */
function aliasedValue({
  current,
  named,
  deprecated,
  conflicts,
  deprecations,
}: {
  current: string;
  named: Readonly<Record<string, string | undefined>>;
  deprecated: Readonly<Record<string, string | undefined>> | undefined;
  conflicts: string[];
  deprecations: string[];
}): string | undefined {
  const written = new Map<string, string>();
  const own = named[current];
  if (own !== undefined) written.set(current, own);
  for (const alias of telemetryAliases.filter((row) => row.current === current)) {
    const old = deprecated?.[alias.deprecated];
    if (old === undefined) continue;
    deprecations.push(
      `${alias.deprecated} is deprecated, use ${current}; it stops being read once the LTS floor passes this release`,
    );
    written.set(alias.deprecated, alias.translate ? alias.translate(old) : old);
  }
  const values = new Set(written.values());
  if (values.size > 1) {
    const pairs = [...written].map(([name, value]) => `${name}=${value}`).join(", ");
    conflicts.push(`${pairs}: set only ${current}`);
  }
  return values.values().next().value;
}

/** `OTEL_*_EXPORTER`: a comma list, `none` for nothing, `otlp` when unset. */
function exportersOf(value: string | undefined): readonly string[] {
  const names = (value ?? "otlp").split(",").map((name) => name.trim().toLowerCase());
  return names.filter((name) => name !== "" && name !== "none");
}
