import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { type CompressionAlgorithm } from "@opentelemetry/otlp-exporter-base";

import {
  DEFAULT_ENDPOINT,
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_NAME_OBSERVABILITY,
  LANGWATCH_SDK_RUNTIME,
  LANGWATCH_SDK_VERSION,
  LOGS_PATH,
} from "../../internal/constants";
import { resolveOtlpCompression } from "../../internal/otlp-compression";

export interface LangWatchLogsExporterOptions {
  endpoint?: string;
  apiKey?: string;
  /** Request compression: gzip unless an OTEL_EXPORTER_OTLP_*COMPRESSION env var is set. */
  compression?: CompressionAlgorithm;
}

/** Extends OpenTelemetry OTLP HTTP logs exporter to send logs to LangWatch with authentication. */
export class LangWatchLogsExporter extends OTLPLogExporter {
  /** Configures auth headers and endpoint; reads defaults from environment if needed. */
  constructor(opts?: LangWatchLogsExporterOptions) {
    const apiKey = opts?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = opts?.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT;

    const url = new URL(LOGS_PATH, endpoint);
    const otelEndpoint = url.toString();

    super({
      headers: {
        "x-langwatch-sdk-name": LANGWATCH_SDK_NAME_OBSERVABILITY,
        "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
        "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
        "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME(),
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      url: otelEndpoint.toString(),
      compression: resolveOtlpCompression({ compression: opts?.compression, signal: "LOGS" }),
    });
  }
}
