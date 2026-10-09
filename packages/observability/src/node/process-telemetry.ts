/**
 * Traces and logs for one Node process, wired from the parsed observability
 * slice and the one credential it carries. The preamble owns startup; the
 * hosted component it answers with owns shutdown, so the flush is ordered.
 */
import type { SetupObservabilityOptions } from "langwatch/observability/node";

import { configureLogger } from "../logger.ts";
import { otlpSpanProcessors, tracesSampler } from "./otlp-traces.ts";
import { createProcessObservability } from "./process-observability.ts";
import { startProfiling } from "./profiling.ts";
import { type ResolvedTelemetry, resolveTelemetry } from "./telemetry-aliases.ts";
import {
  otlpHeadersFrom,
  otlpHeadersSecret,
  type TelemetryContext,
  type TelemetrySettings,
} from "./telemetry-settings.ts";

type SetupOptions = Omit<SetupObservabilityOptions, "debug" | "serviceName">;

export function processTelemetry(serviceName: string) {
  return ({ config, secrets, redactPaths }: TelemetryContext) =>
    secrets.into(otlpHeadersSecret, (rawHeaders) => {
      const settings = config.observability;
      const resolved = resolveTelemetry(settings);
      const name = resolved.serviceName ?? serviceName;
      configureLogger({
        ...loggerConfiguration({ settings, resolved, serviceName: name }),
        ...(redactPaths ? { redactPaths } : {}),
      });
      const telemetry = createProcessObservability({
        serviceName: name,
        setup: telemetrySetup({ settings, resolved, headers: otlpHeadersFrom(rawHeaders) }),
      });
      for (const deprecation of resolved.deprecations) telemetry.logger.warn(deprecation);

      // Pyroscope's own push, gated on its own endpoint: independent of OTLP.
      const profiler = startProfiling({
        serverAddress: settings.profilingServerAddress,
        appName: serviceName,
        environment: settings.environment,
        resourceAttributes: settings.resourceAttributes,
      });

      return {
        logger: telemetry.logger,
        component: {
          name: "process telemetry",
          stop: async () => {
            await telemetry.shutdown();
            await profiler?.stop();
          },
        },
      };
    });
}

/**
 * LangWatch's own telemetry never rides the product's ingest: `langwatch` is
 * disabled and the collector, when there is one, takes the spans instead.
 */
function telemetrySetup({
  settings,
  resolved,
  headers,
}: {
  settings: TelemetrySettings;
  resolved: ResolvedTelemetry;
  headers: Readonly<Record<string, string>>;
}): SetupOptions {
  const spanProcessors = otlpSpanProcessors({ endpoint: resolved.tracesEndpoint, headers });
  const sampler = tracesSampler(settings.tracesSampleRatio);

  return {
    langwatch: "disabled",
    attributes: { "deployment.environment.name": settings.environment },
    ...(spanProcessors.length > 0 ? { spanProcessors } : {}),
    ...(sampler === undefined ? {} : { sampler }),
  };
}

function loggerConfiguration({
  settings,
  resolved,
  serviceName,
}: {
  settings: TelemetrySettings;
  resolved: ResolvedTelemetry;
  serviceName: string;
}) {
  return {
    serviceName,
    serviceVersion: settings.serviceVersion,
    environment: settings.environment,
    deploymentEnvironment: settings.environment,
    format: settings.logs.format,
    level: resolved.logs.level,
    consoleLevel: resolved.logs.consoleLevel,
    otelLevel: resolved.logs.otelLevel,
    otelExportEnabled: resolved.logs.otelExport,
  };
}
