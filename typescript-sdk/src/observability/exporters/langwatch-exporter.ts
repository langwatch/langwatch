import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { LANGWATCH_SDK_LANGUAGE, LANGWATCH_SDK_NAME, LANGWATCH_SDK_VERSION, TRACES_PATH } from "../setup/utils";

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
    const apiKey = opts?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = opts?.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

    if (opts && opts.includeAllSpans !== void 0) {
      console.warn("[LangWatchExporter] The behavior of `includeAllSpans` is deprecated and will be removed in a future version");
    }
    if (opts && opts.debug !== void 0) {
      console.warn("[LangWatchExporter] The behavior of `debug` is deprecated and will be removed in a future version");
    }

    const url = new URL(TRACES_PATH, endpoint);
    const otelEndpoint = url.toString();

    super({
      headers: {
        "x-langwatch-sdk-name": LANGWATCH_SDK_NAME,
        "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
        "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      url: otelEndpoint.toString(),
    });
  }
}
