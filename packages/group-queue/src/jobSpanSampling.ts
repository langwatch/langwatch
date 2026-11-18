/**
 * Which claimed jobs keep their consumer span: 1 in 10 successes, every failure and retry.
 * specs/job-span-sampling.feature
 */
import { randomBytes } from "node:crypto";

import { nowEpochMs } from "@langwatch/time";
import {
  type Attributes,
  type AttributeValue,
  context as otelContext,
  type Exception,
  type Link,
  ROOT_CONTEXT,
  type Span,
  type SpanContext,
  type SpanKind,
  type SpanStatus,
  SpanStatusCode,
  type TimeInput,
  TraceFlags,
  trace,
} from "@opentelemetry/api";

/** The share of first-attempt jobs that keep their consumer span when they succeed. */
export const JOB_SPAN_SAMPLE_RATIO = 0.1;

export interface JobSpanSampling {
  /** Share of first-attempt jobs sampled, 0 to 1. */
  ratio: number;
  /** The draw for a job that carries no producer trace. */
  random: () => number;
}

export const DEFAULT_JOB_SPAN_SAMPLING: JobSpanSampling = {
  ratio: JOB_SPAN_SAMPLE_RATIO,
  random: Math.random,
};

const TRACE_ID = /^[0-9a-f]{32}$/;

/** A trace id's low 32 bits as a fraction, so every job in one producer trace draws alike. */
function traceIdDraw(traceId: string): number {
  return Number.parseInt(traceId.slice(-8), 16) / 0x1_00_00_00_00;
}

/** Whether a job's span is built up front. A retried attempt always is. */
export function isJobSpanSampled({
  sampling,
  traceId,
  attempt,
}: {
  sampling: JobSpanSampling;
  traceId: string | undefined;
  attempt: number;
}): boolean {
  if (attempt > 1 || sampling.ratio >= 1) return true;
  if (sampling.ratio <= 0) return false;
  const draw = traceId && TRACE_ID.test(traceId) ? traceIdDraw(traceId) : sampling.random();
  return draw < sampling.ratio;
}

interface BufferedEvent {
  name: string;
  attributes: Attributes | undefined;
  time: TimeInput;
}

/**
 * An unsampled job's span: records nothing and parents no sampled child, until the job fails.
 * An error status or exception starts the real span at the job's start and replays the buffer,
 * in the stand-in's trace so logs written before the failure join it. Ignored once ended.
 */
class DeferredJobSpan implements Span {
  private readonly startTime = nowEpochMs();
  private readonly unsampledContext: SpanContext = {
    traceId: randomBytes(16).toString("hex"),
    spanId: randomBytes(8).toString("hex"),
    traceFlags: TraceFlags.NONE,
  };
  private readonly initialAttributes: Attributes;
  private readonly updatedAttributes: Attributes = {};
  private readonly links: Link[] = [];
  private readonly events: BufferedEvent[] = [];
  private status: SpanStatus | undefined;
  private real: Span | undefined;
  private ended = false;
  private name: string;
  private readonly kind: SpanKind;
  private readonly customAttributes: () => Attributes;

  constructor({
    name,
    kind,
    attributes,
    customAttributes,
  }: {
    name: string;
    kind: SpanKind;
    attributes: Attributes;
    customAttributes: () => Attributes;
  }) {
    this.name = name;
    this.kind = kind;
    this.initialAttributes = { ...attributes };
    this.customAttributes = customAttributes;
  }

  spanContext(): SpanContext {
    return this.real?.spanContext() ?? this.unsampledContext;
  }

  setAttribute(key: string, value: AttributeValue): this {
    if (this.real) this.real.setAttribute(key, value);
    else this.updatedAttributes[key] = value;
    return this;
  }

  setAttributes(attributes: Attributes): this {
    if (this.real) this.real.setAttributes(attributes);
    else Object.assign(this.updatedAttributes, attributes);
    return this;
  }

  addEvent(name: string, attributesOrTime?: Attributes | TimeInput, time?: TimeInput): this {
    if (this.real) {
      this.real.addEvent(name, attributesOrTime, time);
      return this;
    }
    const timed = isTimeInput(attributesOrTime);
    this.events.push({
      name,
      attributes: timed ? undefined : attributesOrTime,
      time: (timed ? attributesOrTime : time) ?? nowEpochMs(),
    });
    return this;
  }

  addLink(link: Link): this {
    if (this.real) this.real.addLink(link);
    else this.links.push(link);
    return this;
  }

  addLinks(links: Link[]): this {
    for (const link of links) this.addLink(link);
    return this;
  }

  setStatus(status: SpanStatus): this {
    if (status.code === SpanStatusCode.ERROR) this.materialise();
    if (this.ended) return this;
    if (this.real) this.real.setStatus(status);
    else this.status = status;
    return this;
  }

  updateName(name: string): this {
    if (this.real) this.real.updateName(name);
    else this.name = name;
    return this;
  }

  end(endTime?: TimeInput): void {
    if (this.ended) return;
    this.ended = true;
    this.real?.end(endTime);
  }

  isRecording(): boolean {
    return this.real?.isRecording() ?? false;
  }

  recordException(exception: Exception, time?: TimeInput): void {
    this.materialise()?.recordException(exception, time);
  }

  /** The real span, started at the job's start under a sampled remote stand-in parent. */
  private materialise(): Span | undefined {
    if (this.real || this.ended) return this.real;
    const parent = keptParent(this.unsampledContext);
    const real = trace.getTracer("langwatch.group-queue").startSpan(
      this.name,
      {
        kind: this.kind,
        startTime: this.startTime,
        attributes: {
          ...this.initialAttributes,
          ...this.customAttributes(),
          ...this.updatedAttributes,
        },
        links: this.links,
      },
      parent,
    );
    for (const event of this.events) real.addEvent(event.name, event.attributes, event.time);
    if (this.status) real.setStatus(this.status);
    this.real = real;
    return real;
  }
}

/** A failure span's sampled remote parent: ParentBased keeps it whatever the root ratio. */
function keptParent({ traceId, spanId }: { traceId: string; spanId: string }) {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

function isTimeInput(value: Attributes | TimeInput | undefined): value is TimeInput {
  return typeof value === "number" || Array.isArray(value) || value instanceof Date;
}

/**
 * Runs a job under its consumer span. A sampled job gets a real trace-root span with its custom
 * attributes; an unsampled one runs under a deferred span whose context is not sampled, so its
 * children drop. An escaping error is recorded on the span before it is rethrown.
 */
export async function withJobSpan<T>({
  name,
  kind,
  attributes,
  customAttributes,
  sampled,
  operation,
}: {
  name: string;
  kind: SpanKind;
  attributes: Attributes;
  customAttributes: () => Attributes;
  sampled: boolean;
  operation: (span: Span) => Promise<T>;
}): Promise<T> {
  const span = sampled
    ? trace
        .getTracer("langwatch.group-queue")
        .startSpan(name, { kind, attributes: { ...attributes, ...customAttributes() } })
    : new DeferredJobSpan({ name, kind, attributes, customAttributes });
  try {
    return await otelContext.with(trace.setSpan(otelContext.active(), span), () => operation(span));
  } catch (err) {
    recordEscapedError({ span, err });
    throw err;
  } finally {
    span.end();
  }
}

function recordEscapedError({ span, err }: { span: Span; err: unknown }): void {
  span.recordException(err instanceof Error ? err : String(err));
  span.setStatus({ code: SpanStatusCode.ERROR });
}
