import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { type ExportResult } from '@opentelemetry/core';
import {
  DEFAULT_ENDPOINT,
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_NAME_OBSERVABILITY,
  LANGWATCH_SDK_RUNTIME,
  LANGWATCH_SDK_VERSION,
  TRACES_PATH,
} from "../../internal/constants";
import {
  type TraceFilter,
  type Criteria,
  type Match,
  applyFilters,
} from "./trace-filters";

/**
 * Configuration options for the LangWatchTraceExporter.
 *
 * @property endpoint - Custom LangWatch endpoint URL. Falls back to LANGWATCH_ENDPOINT env var or default.
 * @property apiKey - API key for authentication. Falls back to LANGWATCH_API_KEY env var.
 * @property filters - Array of filters applied sequentially to spans before export.
 *                     Default: `[{ preset: "excludeHttpRequests" }]` to reduce framework noise.
 *                     Pass `null` or `[]` to disable all filtering.
 */
export interface LangWatchTraceExporterOptions {
  endpoint?: string;
  apiKey?: string;
  filters?: TraceFilter[] | null;
}

export type { TraceFilter, Criteria, Match };

/**
 * LangWatchTraceExporter extends the OpenTelemetry OTLP HTTP trace exporter
 * to send trace data to LangWatch with proper authentication and metadata headers.
 *
 * ## Features
 * - Automatic authorization header configuration via API key
 * - SDK version and runtime identification headers
 * - Proper endpoint URL construction for LangWatch ingestion
 * - Intent-based span filtering with presets and custom criteria
 *
 * ## Filtering Behavior
 * - **Default**: HTTP request spans are excluded to reduce framework noise
 * - **Pipeline**: Filters are applied sequentially with AND semantics
 * - **Matching**: All string comparisons are case-sensitive by default
 * - **Array Syntax**: All criteria require arrays of Match objects for explicit filtering
 *
 * ## Filter Types
 * - **Presets**: Pre-configured common filters (`vercelAIOnly`, `excludeHttpRequests`)
 * - **Include**: Keep only spans matching criteria (OR within field, AND across fields)
 * - **Exclude**: Remove spans matching criteria (OR within field, AND across fields)
 *
 * @example Basic usage with default filtering
 * ```typescript
 * import { LangWatchTraceExporter } from '@langwatch/observability';
 *
 * // Default: excludes HTTP request spans
 * const exporter = new LangWatchTraceExporter();
 * ```
 *
 * @example Using presets
 * ```typescript
 * // Keep only Vercel AI SDK spans
 * const exporterAI = new LangWatchTraceExporter({
 *   filters: [{ preset: 'vercelAIOnly' }],
 * });
 *
 * // Explicitly exclude HTTP requests (same as default)
 * const exporterNoHttp = new LangWatchTraceExporter({
 *   filters: [{ preset: 'excludeHttpRequests' }],
 * });
 *
 * // No filtering at all (send all spans)
 * const exporterAll = new LangWatchTraceExporter({
 *   filters: null, // or filters: []
 * });
 * ```
 *
 * @example Custom filtering with criteria
 * ```typescript
 * // Include only spans with specific scope
 * const exporter1 = new LangWatchTraceExporter({
 *   filters: [
 *     { include: { instrumentationScopeName: [{ equals: 'ai' }] } }
 *   ],
 * });
 *
 * // Exclude spans by name pattern
 * const exporter2 = new LangWatchTraceExporter({
 *   filters: [
 *     { exclude: { name: [{ startsWith: 'internal.' }] } }
 *   ],
 * });
 *
 * // Case-insensitive matching
 * const exporter3 = new LangWatchTraceExporter({
 *   filters: [
 *     { include: { name: [{ equals: 'chat.completion', ignoreCase: true }] } }
 *   ],
 * });
 * ```
 *
 * @example Filter pipelines (AND semantics)
 * ```typescript
 * // Keep AI spans, then remove HTTP requests
 * const exporter = new LangWatchTraceExporter({
 *   filters: [
 *     { include: { instrumentationScopeName: [{ equals: 'ai' }] } },
 *     { preset: 'excludeHttpRequests' },
 *   ],
 * });
 * ```
 *
 * @example OR semantics within a field
 * ```typescript
 * // Include spans with name starting with 'chat.' OR 'llm.'
 * const exporter = new LangWatchTraceExporter({
 *   filters: [
 *     {
 *       include: {
 *         name: [
 *           { startsWith: 'chat.' },
 *           { startsWith: 'llm.' }
 *         ]
 *       }
 *     }
 *   ],
 * });
 * ```
 *
 * @example Using regex patterns
 * ```typescript
 * const exporter = new LangWatchTraceExporter({
 *   filters: [
 *     {
 *       include: {
 *         name: [{ matches: /^(chat|llm)\./i }]
 *       }
 *     }
 *   ],
 * });
 * ```
 */
export class LangWatchTraceExporter extends OTLPTraceExporter {
  private readonly filters: TraceFilter[];
  /**
   * Creates a new LangWatchTraceExporter instance.
   *
   * @param opts - Configuration options for the exporter
   * @param opts.apiKey - API key for LangWatch authentication.
   *                     Falls back to `LANGWATCH_API_KEY` environment variable, then empty string.
   * @param opts.endpoint - Custom endpoint URL for LangWatch ingestion.
   *                       Falls back to `LANGWATCH_ENDPOINT` environment variable, then default endpoint.
   * @param opts.filters - Array of filters applied sequentially to spans before export (AND semantics).
   *                      When omitted, defaults to `[{ preset: "excludeHttpRequests" }]`.
   *                      Pass `null` or `[]` to disable all filtering and send all spans.
   *
   * @example
   * ```typescript
   * // With API key and default filtering
   * const exporter = new LangWatchTraceExporter({
   *   apiKey: 'your-api-key'
   * });
   *
   * // With custom endpoint and no filtering
   * const exporter = new LangWatchTraceExporter({
   *   endpoint: 'https://custom.langwatch.ai',
   *   filters: null
   * });
   * ```
   */
  constructor(opts?: LangWatchTraceExporterOptions) {
    const apiKey = opts?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint =
      opts?.endpoint ??
      process.env.LANGWATCH_ENDPOINT ??
      DEFAULT_ENDPOINT;

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

    // Handle filters: null or [] = no filtering, undefined = default, array = use provided
    if (opts?.filters === null || (Array.isArray(opts?.filters) && opts.filters.length === 0)) {
      this.filters = [];
    } else if (Array.isArray(opts?.filters)) {
      this.filters = opts.filters;
    } else {
      this.filters = [{ preset: "excludeHttpRequests" }];
    }
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const filtered = applyFilters(this.filters, spans);
    super.export(filtered, resultCallback);
  }
}
