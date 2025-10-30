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

export interface LangWatchTraceExporterOptions {
  endpoint?: string;
  apiKey?: string;
  filters?: TraceFilter[];
}

export type TraceFilter =
  | { preset: "aiOnly" | "excludeHttpRequests" }
  | { include: Criteria }
  | { exclude: Criteria };

export interface Criteria {
  instrumentationScopeName?: string | Match | Match[];
  name?: string | Match | Match[];
}

export interface Match {
  equals?: string;
  startsWith?: string;
  matches?: RegExp;
  ignoreCase?: boolean;
}

/**
 * LangWatchTraceExporter extends the OpenTelemetry OTLP HTTP trace exporter
 * to send trace data to LangWatch with proper authentication and metadata headers.
 *
 * This exporter automatically configures:
 * - Authorization headers using the provided API key or environment variables/fallback
 * - SDK version and language identification headers
 * - Proper endpoint configuration for LangWatch ingestion using provided URL or environment variables/fallback
 * - Optional intent-based span filtering via `filters`, applied sequentially (AND semantics)
 *
 * @example
 * ```typescript
 * import { LangWatchTraceExporter } from '@langwatch/observability';
 *
 * // 1) Using environment variables/fallback configuration (no filtering)
 * const exporter = new LangWatchTraceExporter();
 *
 * // 2) Vercel AI only
 * const exporterAiOnly = new LangWatchTraceExporter({
 *   filters: [{ preset: 'aiOnly' }],
 * });
 *
 * // 3) Reduce framework noise (exclude HTTP request spans)
 * const exporterNoiseReduced = new LangWatchTraceExporter({
 *   filters: [{ preset: 'excludeHttpRequests' }],
 * });
 *
 * // 4) Advanced pipeline: keep only AI spans that are not HTTP requests
 * const exporterPipeline = new LangWatchTraceExporter({
 *   filters: [
 *     { include: { instrumentationScopeName: 'ai' } },
 *     { preset: 'excludeHttpRequests' },
 *   ],
 * });
 * ```
 */
export class LangWatchTraceExporter extends OTLPTraceExporter {
  private readonly filters: TraceFilter[];
  /**
   * Creates a new LangWatchExporter instance.
   *
   * @param opts - Optional configuration options for the exporter
   * @param opts.apiKey - Optional API key for LangWatch authentication. If not provided,
   *                     will use environment variables or fallback configuration.
   * @param opts.endpoint - Optional custom endpoint URL for LangWatch ingestion.
   *                       If not provided, will use environment variables or fallback configuration.
  * @param opts.filters - Optional array of intent-based filters applied sequentially (AND semantics).
  *                       When omitted or empty, no filtering is applied.
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

    this.filters = Array.isArray(opts?.filters) ? opts.filters : [{ preset: "excludeHttpRequests" }];
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const filtered = applyFilters(this.filters, spans);
    super.export(filtered, resultCallback);
  }
}

function applyFilters(filters: TraceFilter[] | undefined, spans: ReadableSpan[]): ReadableSpan[] {
  if (!filters || filters.length === 0) return spans;
  return filters.reduce((current, rule) => applyFilterRule(rule, current), spans);
}

function applyFilterRule(rule: TraceFilter, spans: ReadableSpan[]): ReadableSpan[] {
  if ('preset' in rule && rule.preset) {
    return applyPreset((rule as { preset: TraceFilter extends { preset: infer P } ? P : never }).preset as any, spans);
  }

  if ('include' in rule && rule.include) {
    const criteria = (rule as { include: Criteria }).include;
    return spans.filter((s) => matchesCriteria(s, criteria));
  }

  if ('exclude' in rule && rule.exclude) {
    const criteria = (rule as { exclude: Criteria }).exclude;
    return spans.filter((s) => !matchesCriteria(s, criteria));
  }

  return spans;
}

function applyPreset(
  preset: "aiOnly" | "excludeHttpRequests",
  spans: ReadableSpan[],
): ReadableSpan[] {
  if (preset === "aiOnly") return spans.filter((s) => isVercelAiSpan(s));
  if (preset === "excludeHttpRequests") return spans.filter((s) => !isHttpRequestSpan(s));

  return spans;
}

function matchesCriteria(span: ReadableSpan, criteria: Criteria): boolean {
  if (criteria.instrumentationScopeName !== void 0) {
    const matchers = normalizeToMatchers(criteria.instrumentationScopeName);
    const scopeName = span.instrumentationScope?.name ?? "";
    const ok = matchers.some((m) => valueMatches(scopeName, m, { defaultIgnoreCase: true }));
    if (!ok) return false;
  }

  if (criteria.name !== void 0) {
    const matchers = normalizeToMatchers(criteria.name);
    const ok = matchers.some((m) => valueMatches(span.name ?? "", m, { defaultIgnoreCase: false }));
    if (!ok) return false;
  }

  return true;
}

function normalizeToMatchers(input: string | Match | Match[]): Match[] {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") return [{ equals: input }];

  return [input];
}

function valueMatches(value: string, rule: Match, opts: { defaultIgnoreCase: boolean }): boolean {
  const raw = value ?? "";
  const ignoreCase = rule.ignoreCase ?? opts.defaultIgnoreCase;

  if (rule.equals !== void 0) {
    return ignoreCase
      ? raw.localeCompare(rule.equals, void 0, { sensitivity: "base" }) === 0
      : raw === rule.equals;
  }

  if (rule.startsWith !== void 0) {
    return ignoreCase
      ? raw.toLowerCase().startsWith(rule.startsWith.toLowerCase())
      : raw.startsWith(rule.startsWith);
  }

  if (rule.matches instanceof RegExp) {
    const re = ignoreCase && !rule.matches.flags.includes("i")
      ? new RegExp(rule.matches.source, (rule.matches.flags || "") + "i")
      : rule.matches;
    return re.test(raw);
  }

  return false;
}

function isVercelAiSpan(span: ReadableSpan): boolean {
  const scope = span.instrumentationScope?.name?.toLowerCase?.() ?? "";

  return scope === "ai";
}

function isHttpRequestSpan(span: ReadableSpan): boolean {
  const name = span.name ?? "";
  const verbMatch = /^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/i.test(name);

  return verbMatch;
}
