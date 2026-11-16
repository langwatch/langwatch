/** Which claimed jobs keep their consumer span. specs/job-span-sampling.feature */
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
  SpanKind,
  type SpanOptions,
  type SpanStatus,
  SpanStatusCode,
  type TimeInput,
  TraceFlags,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type JobSpanSampling,
  JOB_SPAN_SAMPLE_RATIO,
  isJobSpanSampled,
  withJobSpan,
} from "../jobSpanSampling.ts";

interface ExportedSpan {
  name: string;
  parent: SpanContext | undefined;
  startTime: TimeInput | undefined;
  attributes: Attributes;
  links: Link[];
  events: string[];
  status: SpanStatus | undefined;
}

/** An async-local context manager, as the Node SDK installs. */
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

/** An in-memory tracer with the SDK's default ParentBased(AlwaysOn) sampling. */
function inMemoryTracer(exported: ExportedSpan[]): Tracer {
  const startSpan = (name: string, options: SpanOptions = {}, context?: Context): Span => {
    const parent = trace.getSpanContext(context ?? otelContext.active());
    const traceId = parent?.traceId ?? randomBytes(16).toString("hex");
    const spanContext = { traceId, spanId: randomBytes(8).toString("hex") };
    if (parent && (parent.traceFlags & TraceFlags.SAMPLED) === 0) {
      return trace.wrapSpanContext({ ...spanContext, traceFlags: TraceFlags.NONE });
    }
    const record: ExportedSpan = {
      name,
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

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const BASE = { "queue.name": "q", "queue.job_name": "j" };

describe("job span sampling", () => {
  const exported: ExportedSpan[] = [];
  let customCalls = 0;
  const customAttributes = () => {
    customCalls++;
    return { "tenant.custom": "x" };
  };

  beforeEach(() => {
    exported.length = 0;
    customCalls = 0;
    otelContext.setGlobalContextManager(new LocalContextManager());
    trace.setGlobalTracerProvider({ getTracer: () => inMemoryTracer(exported) });
  });

  afterEach(() => {
    trace.disable();
    otelContext.disable();
  });

  function runJob(operation: (span: Span) => Promise<void>, sampled = false) {
    return withJobSpan({
      name: "q/j",
      kind: SpanKind.CONSUMER,
      attributes: BASE,
      customAttributes,
      sampled,
      operation,
    });
  }

  /** @scenario "An unsampled successful job creates no span and computes no custom attributes" */
  it("exports nothing and never asks for custom attributes for an unsampled success", async () => {
    await runJob(async (span) => {
      span.setAttribute("organization.id", "org");
      span.addEvent("queue.group_batch_bisected");
    });
    expect(exported).toEqual([]);
    expect(customCalls).toBe(0);
  });

  it("exports a sampled success with its custom attributes", async () => {
    await runJob(async () => {}, true);
    expect(exported).toHaveLength(1);
    expect(exported[0]?.attributes).toMatchObject({ ...BASE, "tenant.custom": "x" });
  });

  /** @scenario "A failed job always has a span carrying its error" */
  it("starts an unsampled failing job's span at the job start with its error", async () => {
    const link = { context: { traceId: TRACE, spanId: "00f067aa0ba902b7", traceFlags: 1 } };
    let startedBefore = 0;
    await runJob(async (span) => {
      startedBefore = Date.now();
      span.addLink(link);
      span.setAttribute("organization.id", "org");
      span.addEvent("queue.group_batch_bisected");
      span.recordException(new Error("boom"));
      span.setStatus({ code: SpanStatusCode.ERROR });
    });
    expect(exported).toHaveLength(1);
    const [failed] = exported;
    expect(failed?.parent).toBeUndefined();
    expect(failed?.startTime).toBeLessThanOrEqual(startedBefore);
    expect(failed?.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(failed?.events).toEqual(["queue.group_batch_bisected", "exception"]);
    expect(failed?.links).toEqual([link]);
    expect(failed?.attributes).toMatchObject({
      ...BASE,
      "tenant.custom": "x",
      "organization.id": "org",
    });
  });

  /** @scenario "A retried attempt always has a span" */
  it("samples every attempt after the first, whatever the ratio", () => {
    const never: JobSpanSampling = { ratio: 0, random: () => 0 };
    expect(isJobSpanSampled({ sampling: never, traceId: undefined, attempt: 2 })).toBe(true);
    expect(isJobSpanSampled({ sampling: never, traceId: TRACE, attempt: 7 })).toBe(true);
    expect(isJobSpanSampled({ sampling: never, traceId: undefined, attempt: 1 })).toBe(false);
  });

  /** @scenario "The sampled share of first attempts is the configured ratio" */
  it("samples the configured share of jobs without a producer trace", () => {
    const draws = 10_000;
    let index = 0;
    const sampling: JobSpanSampling = {
      ratio: JOB_SPAN_SAMPLE_RATIO,
      random: () => (index++ + 0.5) / draws,
    };
    let sampled = 0;
    for (let job = 0; job < draws; job++) {
      if (isJobSpanSampled({ sampling, traceId: undefined, attempt: 1 })) sampled++;
    }
    expect(JOB_SPAN_SAMPLE_RATIO).toBe(0.1);
    expect(sampled).toBe(draws * JOB_SPAN_SAMPLE_RATIO);
  });

  /** @scenario "Jobs in one producer trace share one decision" */
  it("decides by the producer trace id, never the random draw", () => {
    let flip = 0;
    const sampling: JobSpanSampling = { ratio: 0.5, random: () => (flip++ % 2 ? 0 : 0.99) };
    const decisions = [1, 2, 3, 4].map(() =>
      isJobSpanSampled({ sampling, traceId: TRACE, attempt: 1 }),
    );
    expect(new Set(decisions).size).toBe(1);
    expect(flip).toBe(0);
    const low = `${"f".repeat(24)}00000001`;
    const high = `${"0".repeat(24)}ffffffff`;
    expect(isJobSpanSampled({ sampling, traceId: low, attempt: 1 })).toBe(true);
    expect(isJobSpanSampled({ sampling, traceId: high, attempt: 1 })).toBe(false);
  });

  /** @scenario "An unsampled job's child spans are not exported as roots" */
  it("drops the child spans an unsampled handler starts", async () => {
    await runJob(async () => {
      const child = trace.getTracer("handler").startSpan("child");
      child.end();
      await trace.getTracer("handler").startActiveSpan("active-child", async (span) => {
        trace.getTracer("handler").startSpan("grandchild").end();
        span.end();
      });
    });
    expect(exported).toEqual([]);
  });

  it("parents a sampled job's child spans on the job span", async () => {
    await runJob(async () => {
      trace.getTracer("handler").startSpan("child").end();
    }, true);
    expect(exported.map((span) => span.name)).toEqual(["child", "q/j"]);
    expect(exported[0]?.parent).toBeDefined();
  });
});
