import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FilterableBatchSpanExporter, SpanProcessingExcludeRule } from '../filterable-batch-span-exporter';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

function makeSpan({ name, instrumentationScopeName }: { name: string; instrumentationScopeName: string }): ReadableSpan {
  return {
    name,
    instrumentationScope: { name: instrumentationScopeName },
  } as any;
}

describe('FilterableBatchSpanExporter', () => {
  let exporter: SpanExporter;
  let onEndSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onEndSpy = vi.fn();
    exporter = { export: vi.fn(), shutdown: vi.fn() } as any;
    // Patch BatchSpanProcessor's onEnd to spy on calls
    (FilterableBatchSpanExporter.prototype as any).__proto__.onEnd = onEndSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should export span if no filters match', () => {
    const filters: SpanProcessingExcludeRule[] = [
      { fieldName: 'span_name', matchValue: 'foo', matchOperation: 'exact_match' },
    ];
    const processor = new FilterableBatchSpanExporter(exporter, filters);
    const span = makeSpan({ name: 'bar', instrumentationScopeName: 'scope' });
    processor.onEnd(span);
    expect(onEndSpy).toHaveBeenCalledWith(span);
  });

  it('should not export span if span_name exact_match filter matches', () => {
    const filters: SpanProcessingExcludeRule[] = [
      { fieldName: 'span_name', matchValue: 'heartbeat', matchOperation: 'exact_match' },
    ];
    const processor = new FilterableBatchSpanExporter(exporter, filters);
    const span = makeSpan({ name: 'heartbeat', instrumentationScopeName: 'scope' });
    processor.onEnd(span);
    expect(onEndSpy).not.toHaveBeenCalled();
  });

  it('should not export span if instrumentation_scope_name starts_with filter matches', () => {
    const filters: SpanProcessingExcludeRule[] = [
      { fieldName: 'instrumentation_scope_name', matchValue: 'internal', matchOperation: 'starts_with' },
    ];
    const processor = new FilterableBatchSpanExporter(exporter, filters);
    const span = makeSpan({ name: 'foo', instrumentationScopeName: 'internal-logger' });
    processor.onEnd(span);
    expect(onEndSpy).not.toHaveBeenCalled();
  });

  it('should not export span if span_name includes filter matches', () => {
    const filters: SpanProcessingExcludeRule[] = [
      { fieldName: 'span_name', matchValue: 'api', matchOperation: 'includes' },
    ];
    const processor = new FilterableBatchSpanExporter(exporter, filters);
    const span = makeSpan({ name: 'call-api-endpoint', instrumentationScopeName: 'scope' });
    processor.onEnd(span);
    expect(onEndSpy).not.toHaveBeenCalled();
  });

  it('should not export span if span_name ends_with filter matches', () => {
    const filters: SpanProcessingExcludeRule[] = [
      { fieldName: 'span_name', matchValue: 'end', matchOperation: 'ends_with' },
    ];
    const processor = new FilterableBatchSpanExporter(exporter, filters);
    const span = makeSpan({ name: 'process-end', instrumentationScopeName: 'scope' });
    processor.onEnd(span);
    expect(onEndSpy).not.toHaveBeenCalled();
  });

  it('should export span if multiple filters and none match', () => {
    const filters: SpanProcessingExcludeRule[] = [
      { fieldName: 'span_name', matchValue: 'foo', matchOperation: 'exact_match' },
      { fieldName: 'instrumentation_scope_name', matchValue: 'bar', matchOperation: 'includes' },
    ];
    const processor = new FilterableBatchSpanExporter(exporter, filters);
    const span = makeSpan({ name: 'baz', instrumentationScopeName: 'scope' });
    processor.onEnd(span);
    expect(onEndSpy).toHaveBeenCalledWith(span);
  });

  it('should not export span if any filter matches (OR logic)', () => {
    const filters: SpanProcessingExcludeRule[] = [
      { fieldName: 'span_name', matchValue: 'baz', matchOperation: 'exact_match' },
      { fieldName: 'instrumentation_scope_name', matchValue: 'scope', matchOperation: 'exact_match' },
    ];
    const processor = new FilterableBatchSpanExporter(exporter, filters);
    const span = makeSpan({ name: 'baz', instrumentationScopeName: 'scope' });
    processor.onEnd(span);
    expect(onEndSpy).not.toHaveBeenCalled();
  });
});
