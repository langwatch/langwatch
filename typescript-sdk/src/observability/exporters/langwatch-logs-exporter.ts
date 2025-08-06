import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_NAME,
  LANGWATCH_SDK_RUNTIME,
  LANGWATCH_SDK_VERSION,
  LOGS_PATH,
} from "../setup/constants";

export interface LangWatchLogsExporterOptions {
  endpoint?: string;
  apiKey?: string;
}

/**
 * LangWatchLogsExporter extends the OpenTelemetry OTLP HTTP logs exporter
 * to send logs to LangWatch with proper authentication and metadata headers.
 *
 * This exporter automatically configures:
 * - Authorization headers using the provided API key or environment variables/fallback
 * - SDK version and language identification headers
 * - Proper endpoint configuration for LangWatch ingestion using provided URL or environment variables/fallback
 *
 * @example
 * ```typescript
 * import { LangWatchLogsExporter } from '@langwatch/observability';
 *
 * // Using environment variables/fallback configuration
 * const exporter = new LangWatchLogsExporter();
 *
 * // Using custom options
 * const exporter = new LangWatchLogsExporter({
 *   apiKey: 'your-api-key',
 *   endpoint: 'https://custom.langwatch.com'
 * });
 * ```
 */
export class LangWatchLogsExporter extends OTLPLogExporter {
  /**
   * Creates a new LangWatchLogsExporter instance.
   *
   * @param opts - Optional configuration options for the exporter.
   * @param opts.apiKey - Optional API key for LangWatch authentication. If not provided,
   *                     will use environment variables or fallback configuration.
   * @param opts.endpoint - Optional custom endpoint URL for LangWatch ingestion.
   *                       If not provided, will use environment variables or fallback configuration.
   */
  constructor(opts?: LangWatchLogsExporterOptions) {
    const apiKey = opts?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint =
      opts?.endpoint ??
      process.env.LANGWATCH_ENDPOINT ??
      "https://app.langwatch.ai";

    const url = new URL(LOGS_PATH, endpoint);
    const otelEndpoint = url.toString();

    super({
      headers: {
        "x-langwatch-sdk-name": LANGWATCH_SDK_NAME,
        "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
        "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
        "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME,
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      url: otelEndpoint.toString(),
    });
  }
}
