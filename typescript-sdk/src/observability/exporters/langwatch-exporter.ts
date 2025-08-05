import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { version } from "../../../package.json";
import { getApiKey, getEndpoint } from "../../client";

export interface LangWatchExporterOptions {
  endpoint?: string;
  apiKey?: string;
  includeAllSpans?: boolean;
  debug?: boolean;
}

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
 * // Using custom options
 * const exporter = new LangWatchExporter({
 *   apiKey: 'your-api-key',
 *   endpoint: 'https://custom.langwatch.com'
 * });
 * ```
 */
export class LangWatchExporter extends OTLPTraceExporter {
    /**
   * Creates a new LangWatchExporter instance.
   *
   * @param opts - Optional configuration options for the exporter
   * @param opts.apiKey - Optional API key for LangWatch authentication. If not provided,
   *                     will use environment variables or fallback configuration.
   * @param opts.endpoint - Optional custom endpoint URL for LangWatch ingestion.
   *                       If not provided, will use environment variables or fallback configuration.
   * @param opts.includeAllSpans - Deprecated: This option is deprecated and will be removed in a future version
   * @param opts.debug - Deprecated: This option is deprecated and will be removed in a future version
   */
  constructor(opts?: LangWatchExporterOptions) {
    const setApiKey = opts?.apiKey ?? getApiKey();
    const setEndpoint = opts?.endpoint ?? getEndpoint();

    if (opts && opts.includeAllSpans !== void 0) {
      console.warn("[LangWatchExporter] The behavior of `includeAllSpans` is deprecated and will be removed in a future version");
    }
    if (opts && opts.debug !== void 0) {
      console.warn("[LangWatchExporter] The behavior of `debug` is deprecated and will be removed in a future version");
    }

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
