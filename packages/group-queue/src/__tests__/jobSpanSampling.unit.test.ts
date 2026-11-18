/** Which claimed jobs keep their consumer span. specs/job-span-sampling.feature */
import { getLogContext } from "@langwatch/observability/context";
import { type Span, SpanKind, SpanStatusCode, TraceFlags, trace } from "@opentelemetry/api";
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type JobSpanSampling,
  JOB_SPAN_SAMPLE_RATIO,
  isJobSpanSampled,
  withJobSpan,
} from "../jobSpanSampling.ts";
import {
  hrTimeToEpochMs,
  installInMemoryTracing,
  uninstallInMemoryTracing,
} from "./in-memory-tracing.ts";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const BASE = { "queue.name": "q", "queue.job_name": "j" };

describe("job span sampling", () => {
  let exporter: InMemorySpanExporter;
  const exported = () => exporter.getFinishedSpans();
  let customCalls = 0;
  const customAttributes = () => {
    customCalls++;
    return { "tenant.custom": "x" };
  };

  beforeEach(() => {
    customCalls = 0;
    exporter = installInMemoryTracing();
  });

  afterEach(() => {
    uninstallInMemoryTracing();
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
    expect(exported()).toEqual([]);
    expect(customCalls).toBe(0);
  });

  it("exports a sampled success with its custom attributes", async () => {
    await runJob(async () => {}, true);
    expect(exported()).toHaveLength(1);
    expect(exported()[0]?.attributes).toMatchObject({ ...BASE, "tenant.custom": "x" });
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
    expect(exported()).toHaveLength(1);
    const [failed] = exported();
    expect(failed?.parentSpanContext?.isRemote).toBe(true);
    expect(hrTimeToEpochMs(failed!.startTime)).toBeLessThanOrEqual(startedBefore);
    expect(failed?.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(failed?.events.map((event) => event.name)).toEqual([
      "queue.group_batch_bisected",
      "exception",
    ]);
    expect(failed?.links).toMatchObject([link]);
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
    expect(exported()).toEqual([]);
  });

  it("parents a sampled job's child spans on the job span", async () => {
    await runJob(async () => {
      trace.getTracer("handler").startSpan("child").end();
    }, true);
    expect(exported().map((span) => span.name)).toEqual(["child", "q/j"]);
    expect(exported()[0]?.parentSpanContext?.spanId).toBe(exported()[1]?.spanContext().spanId);
  });

  /** @scenario "A failed job's span joins the logs written before the failure" */
  it("exports the failure span in the trace the job's earlier logs carry", async () => {
    let loggedTraceId: string | null = null;
    let loggedAfter: string | null = null;
    await runJob(async (span) => {
      loggedTraceId = getLogContext().traceId;
      span.recordException(new Error("boom"));
      loggedAfter = getLogContext().traceId;
    });
    expect(exported()).toHaveLength(1);
    expect(loggedTraceId).toBe(exported()[0]?.spanContext().traceId);
    expect(loggedAfter).toBe(exported()[0]?.spanContext().traceId);
  });

  /** @scenario "An unsampled job's failure span survives a process sampler that samples no root" */
  it("keeps an unsampled job's failure span when the process samples no root", async () => {
    uninstallInMemoryTracing();
    exporter = installInMemoryTracing({ rootSampled: false });
    await runJob(async (span) => {
      span.setStatus({ code: SpanStatusCode.ERROR });
    });
    expect(exported()).toHaveLength(1);
    expect(exported()[0]?.parentSpanContext).toMatchObject({
      isRemote: true,
      traceFlags: TraceFlags.SAMPLED,
    });
  });

  /** @scenario "A span kept up front starts its own trace" */
  it("starts a sampled job's span as a trace root, which a root ratio of 0 drops", async () => {
    await runJob(async () => {}, true);
    expect(exported()).toHaveLength(1);
    expect(exported()[0]?.parentSpanContext).toBeUndefined();

    uninstallInMemoryTracing();
    exporter = installInMemoryTracing({ rootSampled: false });
    await runJob(async (span) => {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }, true);
    expect(exported()).toEqual([]);
  });

  /** @scenario "A failure span keeps an attribute the job set over a custom attribute" */
  it("lets the job's own attribute win over a custom attribute on a failure span", async () => {
    await withJobSpan({
      name: "q/j",
      kind: SpanKind.CONSUMER,
      attributes: BASE,
      customAttributes: () => ({ "tenant.id": "custom" }),
      sampled: false,
      operation: async (span) => {
        span.setAttribute("tenant.id", "project");
        span.setStatus({ code: SpanStatusCode.ERROR });
      },
    });
    expect(exported()).toHaveLength(1);
    expect(exported()[0]?.attributes["tenant.id"]).toBe("project");
  });

  /** @scenario "A failure span keeps the events recorded before the failure" */
  it("replays a buffered event's attributes and time onto the failure span", async () => {
    const at = Date.now() + 5;
    let before = 0;
    let after = 0;
    await runJob(async (span) => {
      span.addEvent("queue.group_batch_bisected", { "queue.group_batch_size": 4 }, at);
      before = Date.now();
      span.addEvent("queue.untimed");
      after = Date.now();
      span.setStatus({ code: SpanStatusCode.ERROR });
    });
    const [bisected, untimed] = exported()[0]?.events ?? [];
    expect(bisected?.name).toBe("queue.group_batch_bisected");
    expect(bisected?.attributes).toEqual({ "queue.group_batch_size": 4 });
    expect(hrTimeToEpochMs(bisected!.time)).toBe(at);
    expect(hrTimeToEpochMs(untimed!.time)).toBeGreaterThanOrEqual(before);
    expect(hrTimeToEpochMs(untimed!.time)).toBeLessThanOrEqual(after);
  });

  /** @scenario "An error escaping the job is recorded on its span" */
  it("records an error that escapes the job on its span and rethrows it", async () => {
    const boom = new Error("escaped");
    await expect(runJob(async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(exported()).toHaveLength(1);
    expect(exported()[0]?.events.map((event) => event.name)).toEqual(["exception"]);
    expect(exported()[0]?.status).toEqual({ code: SpanStatusCode.ERROR });
  });

  it("records an escaping error on a sampled job's span too", async () => {
    await expect(runJob(async () => Promise.reject(new Error("x")), true)).rejects.toThrow("x");
    expect(exported()[0]?.status).toEqual({ code: SpanStatusCode.ERROR });
  });

  it("ignores an error recorded after the deferred span ended", async () => {
    let held: Span | undefined;
    await runJob(async (span) => {
      held = span;
    });
    held?.recordException(new Error("late"));
    held?.setStatus({ code: SpanStatusCode.ERROR });
    expect(exported()).toEqual([]);
    expect(customCalls).toBe(0);
  });
});
