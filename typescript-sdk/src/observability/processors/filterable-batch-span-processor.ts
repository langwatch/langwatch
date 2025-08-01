/**
 * Filterable Batch Span Exporter for OpenTelemetry
 *
 * This module provides a BatchSpanProcessor subclass that allows filtering of spans before export
 * based on configurable rules. Spans matching any exclude rule are dropped and not exported.
 *
 * @module filterable-batch-span-exporter
 */

import {
  BatchSpanProcessor,
  ReadableSpan,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';

/**
 * A rule for excluding spans from export based on their name or instrumentation scope name.
 *
 * @property fieldName - The span field to match against ('span_name' or 'instrumentation_scope_name').
 * @property matchValue - The value to match against the field.
 * @property matchOperation - The operation to use for matching ('includes', 'exact_match', 'starts_with', 'ends_with').
 *
 * @example
 * const rule: SpanProcessingExcludeRule = {
 *   fieldName: 'span_name',
 *   matchValue: 'heartbeat',
 *   matchOperation: 'exact_match',
 * };
 */
export interface SpanProcessingExcludeRule {
  fieldName: "span_name" | "instrumentation_scope_name";
  matchValue: string;
  matchOperation: "includes" | "exact_match" | "starts_with" | "ends_with";
}

/**
 * A BatchSpanProcessor that filters out spans matching any of the provided exclude rules before export.
 *
 * This is useful for dropping noisy or irrelevant spans (e.g., health checks, heartbeats) from being exported to your tracing backend.
 *
 * @example
 * import { FilterableBatchSpanProcessor } from './filterable-batch-span-exporter';
 * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
 *
 * const exporter = new OTLPTraceExporter({ url: '...' });
 * const filters = [
 *   { fieldName: 'span_name', matchValue: 'heartbeat', matchOperation: 'exact_match' },
 *   { fieldName: 'instrumentation_scope_name', matchValue: 'internal', matchOperation: 'starts_with' },
 * ];
 * provider.addSpanProcessor(new FilterableBatchSpanProcessor(exporter, filters));
 */
export class FilterableBatchSpanProcessor extends BatchSpanProcessor {
  private readonly _filters: SpanProcessingExcludeRule[];

  /**
   * Create a new FilterableBatchSpanProcessor.
   *
   * @param exporter - The underlying SpanExporter to use for exporting spans.
   * @param filters - An array of rules for excluding spans from export.
   */
  constructor(exporter: SpanExporter, filters: SpanProcessingExcludeRule[]) {
    super(exporter);
    this._filters = filters;
  }

  /**
   * Called when a span ends. If the span matches any exclude rule, it is dropped and not exported.
   *
   * @param span - The ReadableSpan that has ended.
   */
  override onEnd(span: ReadableSpan): void {
    for (const filter of this._filters) {
      let sourceValue: string;

      if (filter.fieldName === "span_name") {
        sourceValue = span.name;
      } else if (filter.fieldName === "instrumentation_scope_name") {
        sourceValue = span.instrumentationScope.name;
      } else {
        continue;
      }

      const matchValue = filter.matchValue;
      const matchOperation = filter.matchOperation;

      switch (true) {
        case matchOperation === "exact_match" && sourceValue === matchValue:
        case matchOperation === "includes" && sourceValue.includes(matchValue):
        case matchOperation === "starts_with" && sourceValue.startsWith(matchValue):
        case matchOperation === "ends_with" && sourceValue.endsWith(matchValue):
          return;

        default: break;
      }
    }

    super.onEnd(span);
  }
}
