import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { version } from "../../../package.json";
import { getApiKey, getEndpoint } from "../../client";

/**
 * LangWatchExporter extends the OpenTelemetry OTLP HTTP trace exporter
 * to send trace data to LangWatch with proper authentication and metadata headers.
 *
 * This exporter automatically configures:
 * - Authorization headers using the provided API key or environment variables/fallback
 * - SDK version and language identification headers
 * - Proper endpoint configuration for LangWatch ingestion using provided URL or environment variables/fallback
 *
 * @example
 * ```typescript
 * import { LangWatchExporter } from '@langwatch/observability';
 *
 * // Using environment variables/fallback configuration
 * const exporter = new LangWatchExporter();
 *
 * // Using custom API key and endpoint
 *
 * // With environment variables/fallback configuration
 * const exporter = new LangWatchExporter();
 *
 * // With custom API key and endpoint
 * const exporter = new LangWatchExporter('api-key', 'https://custom.langwatch.com');
 * ```
 */
export class LangWatchExporter extends OTLPTraceExporter {
    /**
   * Creates a new LangWatchExporter instance.
   *
   * @param apiKey - Optional API key for LangWatch authentication. If not provided,
   *                 will use environment variables or fallback configuration.
   * @param endpointURL - Optional custom endpoint URL for LangWatch ingestion.
   *                     If not provided, will use environment variables or fallback configuration.
   */
  constructor(apiKey?: string, endpointURL?: string) {
    const setApiKey = apiKey ?? getApiKey();
    const setEndpoint = endpointURL ?? getEndpoint();

    super({
      headers: {
        "Authorization": `Bearer ${setApiKey}`,
        "X-LangWatch-SDK-Version": version,
        "X-LangWatch-SDK-Language": `typescript-${typeof process !== "undefined" ? "node" : "browser"}`,
        "X-LangWatch-SDK-Name": "langwatch-observability-sdk",
      },
      url: setEndpoint,
    });
  }
}
