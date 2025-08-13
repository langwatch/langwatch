import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_NAME_OBSERVABILITY,
  LANGWATCH_SDK_RUNTIME,
  LANGWATCH_SDK_VERSION,
  TRACES_PATH,
} from "../../internal/constants";

export interface LangWatchTraceExporterOptions {
  endpoint?: string;
  apiKey?: string;
  includeAllSpans?: boolean;
  debug?: boolean;
}

/**
 * LangWatchTraceExporter extends the OpenTelemetry OTLP HTTP trace exporter
 * to send trace data to LangWatch with proper authentication and metadata headers.
 *
 * This exporter automatically configures:
 * - Authorization headers using the provided API key or environment variables/fallback
 * - SDK version and language identification headers
 * - Proper endpoint configuration for LangWatch ingestion using provided URL or environment variables/fallback
 *
 * @example
 * ```typescript
 * import { LangWatchTraceExporter } from '@langwatch/observability';
 *
 * // Using environment variables/fallback configuration
 * const exporter = new LangWatchTraceExporter();
 *
 * // Using custom options
 * const exporter = new LangWatchTraceExporter({
 *   apiKey: 'your-api-key',
 *   endpoint: 'https://custom.langwatch.com'
 * });
 * ```
 */
export class LangWatchTraceExporter extends OTLPTraceExporter {
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
  constructor(opts?: LangWatchTraceExporterOptions) {
    const apiKey = opts?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint =
      opts?.endpoint ??
      process.env.LANGWATCH_ENDPOINT ??
      "https://app.langwatch.ai";

    if (opts && opts.includeAllSpans !== void 0) {
      console.warn(
        "[LangWatchExporter] The behavior of `includeAllSpans` is deprecated and will be removed in a future version",
      );
    }
    if (opts && opts.debug !== void 0) {
      console.warn(
        "[LangWatchExporter] The behavior of `debug` is deprecated and will be removed in a future version",
      );
    }

    const url = new URL(TRACES_PATH, endpoint);
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
    });
  }
}
