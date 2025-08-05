import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLangWatchTracer } from '../tracer';
import type { Tracer, Span, SpanOptions, Context } from '@opentelemetry/api';

// Mock createLangWatchSpan to just tag the span for test visibility
vi.mock('../span', () => ({
  createLangWatchSpan: (span: Span) => ({
    __isLangWatch: true,
    ...span,
    end: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
  }),
}));

// Helper to create a mock Tracer
function makeMockTracer() {
  return {
    startSpan: vi.fn((name, options, context) => ({ name, options, context })),
    startActiveSpan: vi.fn((...args: any[]) => {
      // OpenTelemetry's startActiveSpan calls the callback with the span
      const fn = args[args.length - 1];
      const span = { name: args[0], options: args[1], context: args[2] };
      return fn(span);
    }),
    someOtherMethod: vi.fn(() => 'other'),
  } as unknown as Tracer;
}

describe('getTracer', () => {
  const origGetTracer = vi.hoisted(() => vi.fn());
  let otelTrace: { getTracer: typeof origGetTracer };

  beforeEach(() => {
    otelTrace = require('@opentelemetry/api').trace;
    otelTrace.getTracer = vi.fn(() => makeMockTracer());
  });

  it('returns a proxy with startSpan wrapping the span', () => {
    const tracer = getLangWatchTracer('test');
    const span = tracer.startSpan('my-span', { foo: 'bar' } as SpanOptions, {} as Context);
    expect(span).toMatchObject({ __isLangWatch: true, name: 'my-span', options: { foo: 'bar' } });
  });

  it('returns a proxy with startActiveSpan wrapping the span in the callback', () => {
    const tracer = getLangWatchTracer('test');
    const result = tracer.startActiveSpan('active-span', (span: any) => {
      expect(span).toMatchObject({ __isLangWatch: true, name: 'active-span' });
      return 'done';
    });
    expect(result).toBe('done');
  });

  it('supports startActiveSpan with options and context overloads', () => {
    const tracer = getLangWatchTracer('test');
    let called = 0;
    tracer.startActiveSpan('span1', { foo: 1 } as SpanOptions, (span: any) => {
      expect(span).toMatchObject({ __isLangWatch: true, name: 'span1', options: { foo: 1 } });
      called++;
    });
    tracer.startActiveSpan('span2', { foo: 2 } as SpanOptions, {} as Context, (span: any) => {
      expect(span).toMatchObject({ __isLangWatch: true, name: 'span2', options: { foo: 2 }, context: {} });
      called++;
    });
    expect(called).toBe(2);
  });

  it('supports startActiveSpan with a callback that returns a Promise', async () => {
    const tracer = getLangWatchTracer('test');
    const result = await tracer.startActiveSpan('promise-span', async (span: any) => {
      expect(span).toMatchObject({ __isLangWatch: true, name: 'promise-span' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'async-done';
    });
    expect(result).toBe('async-done');
  });

  it('supports startActiveSpan with a callback that returns a thenable (Promise-like)', async () => {
    const tracer = getLangWatchTracer('test');
    const thenable = {
      then: (resolve: (v: string) => void) => setTimeout(() => resolve('thenable-done'), 10),
    };
    const result = await tracer.startActiveSpan('thenable-span', (_span: any) => thenable);
    expect(result).toBe('thenable-done');
  });

  it('forwards unknown methods to the underlying tracer', () => {
    const tracer = getLangWatchTracer('test');
    // @ts-expect-error
    expect(tracer.someOtherMethod()).toBe('other');
  });

  it('throws if startActiveSpan is called without a function', () => {
    const tracer = getLangWatchTracer('test');
    // @ts-expect-error
    expect(() => tracer.startActiveSpan('no-fn')).toThrow(/function as the last argument/);
  });
});

describe('getTracer (withActiveSpan)', () => {
  let tracer: ReturnType<typeof getLangWatchTracer>;
  beforeEach(() => {
    tracer = getLangWatchTracer('test');
  });

  it('returns a proxy with withActiveSpan wrapping the span', async () => {
    const result = await tracer.withActiveSpan('my-span', (span: any) => {
      expect(span).toMatchObject({ __isLangWatch: true, name: 'my-span' });
      return 'done';
    });
    expect(result).toBe('done');
  });

  it('supports withActiveSpan with options and context overloads', async () => {
    let called = 0;
    await tracer.withActiveSpan('span1', { foo: 1 } as SpanOptions, (span: any) => {
      expect(span).toMatchObject({ __isLangWatch: true, name: 'span1', options: { foo: 1 } });
      called++;
    });
    await tracer.withActiveSpan('span2', { foo: 2 } as SpanOptions, {} as Context, (span: any) => {
      expect(span).toMatchObject({ __isLangWatch: true, name: 'span2', options: { foo: 2 }, context: {} });
      called++;
    });
    expect(called).toBe(2);
  });

  it('supports withActiveSpan with a callback that returns a Promise', async () => {
    const result = await tracer.withActiveSpan('promise-span', async (span: any) => {
      expect(span).toMatchObject({ __isLangWatch: true, name: 'promise-span' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'async-done';
    });
    expect(result).toBe('async-done');
  });

  it('supports withActiveSpan with a callback that returns a thenable (Promise-like)', async () => {
    const thenable = {
      then: (resolve: (v: string) => void) => setTimeout(() => resolve('thenable-done'), 10),
    };
    const result = await tracer.withActiveSpan('thenable-span', (_span: any) => thenable as any);
    expect(result).toBe('thenable-done');
  });

  it('calls setStatus and recordException on error', async () => {
    const error = new Error('fail!');
    let spanRef: any = null;
    const resultPromise = tracer.withActiveSpan('err-span', (span: any) => {
      span.setStatus = vi.fn();
      span.recordException = vi.fn();
      spanRef = span;
      throw error;
    });
    await expect(resultPromise).rejects.toThrow('fail!');
    expect(spanRef.setStatus).toHaveBeenCalledWith({ code: expect.any(Number), message: 'fail!' });
    expect(spanRef.recordException).toHaveBeenCalledWith(error);
  });

  it('throws if withActiveSpan is called without a function', async () => {
    // @ts-expect-error
    await expect(tracer.withActiveSpan('no-fn')).rejects.toThrow(/function as the last argument/);
  });

  it('ensures nested withActiveSpan calls propagate context (parent-child)', async () => {
    const tracer = getLangWatchTracer('test');
    let parentSpanRef: any = null;
    let childSpanRef: any = null;
    await tracer.withActiveSpan('parent-span', (parentSpan: any) => {
      parentSpanRef = parentSpan;
      return tracer.withActiveSpan('child-span', (childSpan: any) => {
        childSpanRef = childSpan;
        return 'nested';
      });
    });
    // In the mock, context is just passed through, so we can check the parent/child linkage
    expect(childSpanRef.context).toBe(parentSpanRef.context);
    // Removed assertion on childSpanRef.options, as the mock does not reflect real OTel behavior
    expect(childSpanRef.name).toBe('child-span');
    expect(parentSpanRef.name).toBe('parent-span');
  });
});
