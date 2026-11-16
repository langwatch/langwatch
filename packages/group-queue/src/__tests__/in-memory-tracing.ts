/** An in-memory OTel tracer and async-local context manager, as the Node SDK installs them. */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

import {
  type Attributes,
  type Context,
  type ContextManager,
  context as otelContext,
  type Link,
  ROOT_CONTEXT,
  type Span,
  type SpanContext,
  type SpanOptions,
  type SpanStatus,
  type TimeInput,
  TraceFlags,
  type Tracer,
  trace,
} from "@opentelemetry/api";

export interface ExportedSpan {
  name: string;
  traceId: string;
  parent: SpanContext | undefined;
  startTime: TimeInput | undefined;
  attributes: Attributes;
  links: Link[];
  events: string[];
  status: SpanStatus | undefined;
}

class LocalContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<Context>();
  active(): Context {
    return this.storage.getStore() ?? ROOT_CONTEXT;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(context, () => fn.apply(thisArg, args));
  }
  bind<T>(_context: Context, target: T): T {
    return target;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    this.storage.disable();
    return this;
  }
}

/** ParentBased sampling: a parent's flag decides; a root is kept only when `rootSampled`. */
function inMemoryTracer({
  exported,
  rootSampled,
}: {
  exported: ExportedSpan[];
  rootSampled: boolean;
}): Tracer {
  const startSpan = (name: string, options: SpanOptions = {}, context?: Context): Span => {
    const parent = trace.getSpanContext(context ?? otelContext.active());
    const traceId = parent?.traceId ?? randomBytes(16).toString("hex");
    const spanContext = { traceId, spanId: randomBytes(8).toString("hex") };
    const sampled = parent ? (parent.traceFlags & TraceFlags.SAMPLED) !== 0 : rootSampled;
    if (!sampled) return trace.wrapSpanContext({ ...spanContext, traceFlags: TraceFlags.NONE });
    const record: ExportedSpan = {
      name,
      traceId,
      parent,
      startTime: options.startTime,
      attributes: { ...options.attributes },
      links: [...(options.links ?? [])],
      events: [],
      status: undefined,
    };
    const span: Span = {
      spanContext: () => ({ ...spanContext, traceFlags: TraceFlags.SAMPLED }),
      setAttribute: (key, value) => ((record.attributes[key] = value), span),
      setAttributes: (attributes) => (Object.assign(record.attributes, attributes), span),
      addEvent: (event) => (record.events.push(event), span),
      addLink: (link) => (record.links.push(link), span),
      addLinks: (links) => (record.links.push(...links), span),
      setStatus: (status) => ((record.status = status), span),
      updateName: () => span,
      end: () => void exported.push(record),
      isRecording: () => true,
      recordException: () => void record.events.push("exception"),
    };
    return span;
  };
  const startActiveSpan = (
    name: string,
    optionsOrFn: SpanOptions | ((span: Span) => unknown),
    fn?: (span: Span) => unknown,
  ) => {
    const run = typeof optionsOrFn === "function" ? optionsOrFn : fn;
    const span = startSpan(name, typeof optionsOrFn === "function" ? {} : optionsOrFn);
    return otelContext.with(trace.setSpan(otelContext.active(), span), () => run?.(span));
  };
  return { startSpan, startActiveSpan } as Tracer;
}

/** Installs the in-memory tracer globally; `rootSampled: false` models a root ratio of 0. */
export function installInMemoryTracing({
  exported,
  rootSampled = true,
}: {
  exported: ExportedSpan[];
  rootSampled?: boolean;
}): void {
  otelContext.setGlobalContextManager(new LocalContextManager());
  trace.setGlobalTracerProvider({ getTracer: () => inMemoryTracer({ exported, rootSampled }) });
}

export function uninstallInMemoryTracing(): void {
  trace.disable();
  otelContext.disable();
}
