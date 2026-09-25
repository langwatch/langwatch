/**
 * Traces and logs for one Node process, wired from the parsed observability
 * slice and the one credential it carries. The preamble owns startup; the
 * hosted component it answers with owns shutdown, so the flush is ordered.
 */
import type { SetupObservabilityOptions } from "langwatch/observability/node";

import { configureLogger } from "../logger.ts";
import { otlpSpanProcessors, tracesSampler } from "./otlp-traces.ts";
import { createProcessObservability } from "./process-observability.ts";
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
      configureLogger({
        ...loggerConfiguration(settings, serviceName),
        ...(redactPaths ? { redactPaths } : {}),
      });
      const telemetry = createProcessObservability({
        serviceName,
        setup: telemetrySetup(settings, otlpHeadersFrom(rawHeaders)),
      });

      return {
        logger: telemetry.logger,
        component: { name: "process telemetry", stop: () => telemetry.shutdown() },
      };
    });
}

/**
 * LangWatch's own telemetry never rides the product's ingest: `langwatch` is
 * disabled and the collector, when there is one, takes the spans instead.
 */
function telemetrySetup(
  settings: TelemetrySettings,
  headers: Readonly<Record<string, string>>,
): SetupOptions {
  const spanProcessors = otlpSpanProcessors({ endpoint: settings.otlpEndpoint, headers });
  const sampler = tracesSampler(settings.tracesSampleRatio);

  return {
    langwatch: "disabled",
    attributes: { "deployment.environment.name": settings.environment },
    ...(spanProcessors.length > 0 ? { spanProcessors } : {}),
    ...(sampler === undefined ? {} : { sampler }),
  };
}

function loggerConfiguration(settings: TelemetrySettings, serviceName: string) {
  return {
    serviceName,
    serviceVersion: settings.serviceVersion,
    environment: settings.environment,
    deploymentEnvironment: settings.environment,
    format: settings.logs.format,
    level: settings.logs.level,
    consoleLevel: settings.logs.consoleLevel,
    otelLevel: settings.logs.otelLevel,
    otelExportEnabled: settings.logs.otelExport,
  };
}
