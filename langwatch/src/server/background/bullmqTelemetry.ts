import {
  type Context,
  ROOT_CONTEXT,
  context,
  propagation,
  trace,
} from "@opentelemetry/api";
import type {
  Attributes,
  ContextManager,
  Exception,
  Span,
  SpanOptions,
  Telemetry,
  Time,
  Tracer,
} from "bullmq";

/**
 * BullMQ telemetry provider. Replaces the broken bullmq-otel package.
 *
 * bullmq-otel's contextManager.active() returns the global context.active(),
 * which in a long-lived worker means every job inherits the worker's ambient
 * root span — creating unbounded "mega traces" that crash Tempo.
 *
 * Additionally, when BullMQ processes a job without propagated metadata it
 * passes `undefined` as the context to startSpan, causing OTel to fall back
 * to the global active context — bypassing the contextManager entirely.
 *
 * Two variants:
 * - createQueueTelemetry (producer): uses real context so the caller's trace
 *   is propagated into job metadata.
 * - createWorkerTelemetry (consumer): uses ROOT_CONTEXT so each job starts a
 *   fresh trace. If the producer propagated context, fromMetadata() restores
 *   it and the job becomes a child of the original request trace.
 */

function wrapSpan(span: ReturnType<ReturnType<typeof trace.getTracer>["startSpan"]>): Span<Context> {
  return {
    setSpanOnContext(ctx: Context): Context {
      return trace.setSpan(ctx, span);
    },
    setAttribute(key: string, value: Span extends { setAttribute: (k: string, v: infer V) => void } ? V : never) {
      span.setAttribute(key, value);
    },
    setAttributes(attributes: Attributes) {
      span.setAttributes(attributes);
    },
    addEvent(name: string, attributes?: Attributes) {
      span.addEvent(name, attributes);
    },
    recordException(exception: Exception, time?: Time) {
      span.recordException(exception, time as number | undefined);
    },
    end() {
      span.end();
    },
  };
}

function createContextManager(getActiveContext: () => Context): ContextManager<Context> {
  return {
    getMetadata(ctx: Context): string {
      const metadata: Record<string, string> = {};
      propagation.inject(ctx, metadata);
      return JSON.stringify(metadata);
    },
    fromMetadata(activeCtx: Context, metadata: string): Context {
      return propagation.extract(activeCtx, JSON.parse(metadata));
    },
    with<A extends (...args: any[]) => any>(ctx: Context, fn: A): ReturnType<A> {
      return context.with(ctx, fn);
    },
    active: getActiveContext,
  };
}

function createTelemetry(
  queueName: string,
  getActiveContext: () => Context,
): Telemetry<Context> {
  const otelTracer = trace.getTracer(`bullmq:${queueName}`);

  const tracer: Tracer<Context> = {
    startSpan(name: string, options?: SpanOptions, ctx?: Context): Span<Context> {
      // When BullMQ has no propagated metadata it passes ctx=undefined, which
      // makes OTel fall back to the global api.context.active() — bypassing
      // our contextManager.active() override. Default to our active context.
      const effectiveCtx = ctx ?? getActiveContext();
      const span = otelTracer.startSpan(
        name,
        { kind: options?.kind },
        effectiveCtx,
      );
      span.setAttribute("messaging.system", "bullmq");
      span.setAttribute("messaging.destination.name", queueName);
      return wrapSpan(span);
    },
  };

  return {
    tracer,
    contextManager: createContextManager(getActiveContext),
  };
}

/** For Queue (producer): propagates the caller's trace context into job metadata. */
export function createQueueTelemetry(queueName: string): Telemetry<Context> {
  return createTelemetry(queueName, () => context.active());
}

/** For Worker (consumer): isolates each job into its own trace. */
export function createWorkerTelemetry(queueName: string): Telemetry<Context> {
  return createTelemetry(queueName, () => ROOT_CONTEXT);
}
