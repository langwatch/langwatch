/**
 * Refuses an @opentelemetry/api older than 1.10 with a message, before the OpenTelemetry JS 3.x
 * packages load and die on it with an unexplained TypeError. Each public entry imports this first.
 * @module otel-api-guard
 */
import * as installedOtelApi from "@opentelemetry/api";

/** The SDK's @opentelemetry/api peer range. */
export const SUPPORTED_OTEL_API_RANGE = ">=1.10.0 <1.11.0";

/** api 1.10 is the first to carry the logs API; the 3.x packages read it at load. */
export function assertSupportedOtelApi({ otelApi }: { otelApi: object }): void {
  if ("logs" in otelApi && "SeverityNumber" in otelApi) return;

  throw new Error(
    `langwatch needs @opentelemetry/api ${SUPPORTED_OTEL_API_RANGE}, but an older one is installed. ` +
      `Install @opentelemetry/api@~1.10.0, or stay on langwatch 2.x while your app runs OpenTelemetry JS 2.x.`,
  );
}

assertSupportedOtelApi({ otelApi: installedOtelApi });
