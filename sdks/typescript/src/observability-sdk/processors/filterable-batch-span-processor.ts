/**
 * A BatchSpanProcessor subclass that filters spans before export by
 * configurable rules -- spans matching any exclude rule are dropped.
 * @module filterable-batch-span-exporter
 */

import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";

/**
 * A rule for excluding spans from export, matched on `fieldName` by
 * `matchOperation` against `matchValue`.
 */
export interface SpanProcessingExcludeRule {
  fieldName: "span_name" | "instrumentation_scope_name";
  matchValue: string;
  matchOperation: "includes" | "exact_match" | "starts_with" | "ends_with";
}

/**
 * A BatchSpanProcessor that filters out spans matching any exclude rule
 * before export — useful for dropping noisy spans like health checks.
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

        default:
          break;
      }
    }

    super.onEnd(span);
  }
}
