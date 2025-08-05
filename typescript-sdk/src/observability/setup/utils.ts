import {
  ConsoleLogger,
  type Logger,
  NoOpLogger,
  PrefixedLogger,
} from "../../logger";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { version } from "../../../package.json";
import {
  defaultResource,
  Resource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { Attributes } from "@opentelemetry/api";
import * as semconv from "@opentelemetry/semantic-conventions/incubating";

// Constants
export const LANGWATCH_TRACER_NAME = "langwatch";
export const LANGWATCH_SDK_NAME = "langwatch-observability-sdk";
export const LANGWATCH_SDK_LANGUAGE = "typescript";
export const LANGWATCH_SDK_VERSION = version;

export const DEFAULT_ENDPOINT = "https://app.langwatch.ai/";
export const DEFAULT_SERVICE_NAME = "default-service";
export const TRACES_PATH = "/api/otel/v1/traces";
export const LOGS_PATH = "/api/otel/v1/logs";

export function createLogger(
  logger: Logger | undefined,
  debug: boolean | undefined,
): Logger {
  const baseLogger = logger || (debug ? new ConsoleLogger() : new NoOpLogger());
  return new PrefixedLogger(baseLogger, "LangWatch Observability");
}

export function createMergedResource(
  attributes: Attributes | undefined,
  serviceName: string | undefined,
  givenResource: Resource | undefined,
): Resource {
  const langwatchResource = resourceFromAttributes({
    [semconv.ATTR_TELEMETRY_SDK_NAME]: LANGWATCH_TRACER_NAME,
    [semconv.ATTR_TELEMETRY_SDK_LANGUAGE]: LANGWATCH_SDK_LANGUAGE,
    [semconv.ATTR_TELEMETRY_SDK_VERSION]: LANGWATCH_SDK_VERSION,
  });

  const userResource = resourceFromAttributes({
    [semconv.ATTR_SERVICE_NAME]: serviceName ?? DEFAULT_SERVICE_NAME,
    ...(attributes ?? {}),
  });

  return (givenResource ?? defaultResource())
    .merge(langwatchResource)
    .merge(userResource);
}

export function isNoopProvider(provider: unknown): boolean {
  if (!provider || typeof provider !== "object") return true;

  // Real providers have .addSpanProcessor (function)
  // API no-op provider does not.
  return typeof (provider as any).addSpanProcessor !== "function";
}
