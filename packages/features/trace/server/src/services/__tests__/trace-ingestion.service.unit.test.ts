/**
 * What the OTLP receiver does with one export request.
 *
 * Two things here are worth guarding closely. The first is the tally: the
 * transport turns `rejectedSpans` into the customer's HTTP answer, and only
 * two of the five outcomes are a rejection. A span the coding-agent filter
 * dropped on purpose, or one dedup recognised as already seen, is a success
 * from the sender's point of view — counting either as rejected would tell a
 * healthy SDK it is failing.
 *
 * The second is that one bad span does not spoil the batch. A span that fails
 * validation, or arrived from too far in the past, is dropped and reported;
 * its neighbours in the same scope still reach the pipeline.
 */

import type { OtlpSpan, PIIRedactionLevel, RecordSpanCommandData } from "@langwatch/trace-contract";
import { SPAN_MAX_PAST_MS } from "@langwatch/trace-contract";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { describe, expect, it, vi } from "vitest";
import {
  TraceIngressCommandPort,
  TraceIngestionService,
  TraceSpanDedupPort,
} from "../trace-ingestion.service";
import { TestCodingAgentService } from "./support/coding-agent.service.fake";

class TestTraceIngressCommand extends TraceIngressCommandPort {
  readonly record = vi.fn(async (_data: RecordSpanCommandData) => void 0);

  recordSpan(data: RecordSpanCommandData): Promise<void> {
    return this.record(data);
  }
}

class TestTraceSpanDedup extends TraceSpanDedupPort {
  readonly acquire = vi.fn<() => Promise<boolean | null>>(async () => true);
  readonly confirm = vi.fn(async () => void 0);
  readonly release = vi.fn(async () => void 0);

  tryAcquireProcessingLock(): Promise<boolean | null> {
    return this.acquire();
  }

  tryConfirmProcessed(): Promise<void> {
    return this.confirm();
  }

  tryReleaseOnFailure(): Promise<void> {
    return this.release();
  }
}

/** Says yes to every span, so the test exercises the service's use of the filter. */
class FilterEverythingCodingAgentService extends TestCodingAgentService {
  shouldFilterSpan(): boolean {
    return true;
  }
}

function span(over: Partial<OtlpSpan> = {}): OtlpSpan {
  const now = Date.now();
  return {
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: "",
    name: "span",
    kind: 1,
    startTimeUnixNano: String(now * 1_000_000),
    endTimeUnixNano: String(now * 1_000_000),
    attributes: [],
    droppedAttributesCount: 0,
    events: [],
    droppedEventsCount: 0,
    links: [],
    droppedLinksCount: 0,
    status: { code: 0, message: "" },
    traceState: "",
    flags: 0,
    ...over,
  };
}

function fixture(
  options: { codingAgentSpanFilterEnabled?: boolean; filterEverything?: boolean } = {},
) {
  const dedup = new TestTraceSpanDedup();
  const commands = new TestTraceIngressCommand();
  const service = TraceIngestionService.create({
    codingAgents: options.filterEverything
      ? new FilterEverythingCodingAgentService()
      : new TestCodingAgentService(),
    codingAgentSpanFilterEnabled: options.codingAgentSpanFilterEnabled ?? false,
    dedup,
    commands,
  });
  return { commands, dedup, service };
}

const piiRedactionLevel: PIIRedactionLevel = "ESSENTIAL";

const input = () => ({
  tenantId: "project-1",
  span: span(),
  resource: null,
  instrumentationScope: null,
  piiRedactionLevel,
});

/** One export request holding the given spans in a single resource and scope. */
const request = (spans: unknown[]): IExportTraceServiceRequest =>
  ({
    resourceSpans: [
      {
        resource: { attributes: [], droppedAttributesCount: 0 },
        scopeSpans: [{ scope: { name: "test", version: "1" }, spans }],
      },
    ],
  }) as never;

const handle = (service: TraceIngestionService, spans: unknown[]) =>
  service.handleOtlpTraceRequest("project-1", request(spans), piiRedactionLevel);

describe("TraceIngestionService.ingestNormalizedSpan", () => {
  describe("given the span's dedup lock is free", () => {
    it("dispatches and confirms it", async () => {
      const { commands, dedup, service } = fixture();

      await expect(service.ingestNormalizedSpan(input())).resolves.toMatchObject({
        status: "collected",
      });
      expect(commands.record).toHaveBeenCalledOnce();
      expect(dedup.confirm).toHaveBeenCalledOnce();
    });
  });

  describe("given another worker already claimed the span", () => {
    it("does not dispatch it a second time", async () => {
      const { commands, dedup, service } = fixture();
      dedup.acquire.mockResolvedValueOnce(false);

      await expect(service.ingestNormalizedSpan(input())).resolves.toEqual({
        status: "deduped",
      });
      expect(commands.record).not.toHaveBeenCalled();
      expect(dedup.confirm).not.toHaveBeenCalled();
    });
  });

  describe("given the command dispatch fails", () => {
    it("releases the lock it acquired, so a retry can claim it", async () => {
      const { commands, dedup, service } = fixture();
      commands.record.mockRejectedValueOnce(new Error("dispatch failed"));

      await expect(service.ingestNormalizedSpan(input())).resolves.toMatchObject({
        status: "failed",
        error: "dispatch failed",
      });
      expect(dedup.release).toHaveBeenCalledOnce();
    });
  });

  describe("given the dedup store is unavailable", () => {
    it("fails open and ingests the span anyway", async () => {
      const { commands, dedup, service } = fixture();
      dedup.acquire.mockResolvedValueOnce(null);

      await expect(service.ingestNormalizedSpan(input())).resolves.toMatchObject({
        status: "collected",
      });
      expect(commands.record).toHaveBeenCalledOnce();
    });
  });
});

describe("TraceIngestionService.handleOtlpTraceRequest", () => {
  describe("given a request holding good spans", () => {
    it("reports nothing rejected", async () => {
      const { service } = fixture();

      await expect(handle(service, [span()])).resolves.toEqual({
        rejectedSpans: 0,
        errorMessage: "",
      });
    });

    it("dispatches every span it walks past", async () => {
      const { commands, service } = fixture();

      await handle(service, [span({ spanId: "span-1" }), span({ spanId: "span-2" })]);

      expect(commands.record).toHaveBeenCalledTimes(2);
    });

    it("walks every resource and every scope, not just the first", async () => {
      const { commands, service } = fixture();
      const oneScope = (spanId: string) => ({
        scope: { name: "test", version: "1" },
        spans: [span({ spanId })],
      });

      await service.handleOtlpTraceRequest(
        "project-1",
        {
          resourceSpans: [
            { resource: { attributes: [] }, scopeSpans: [oneScope("a"), oneScope("b")] },
            { resource: { attributes: [] }, scopeSpans: [oneScope("c")] },
          ],
        } as never,
        piiRedactionLevel,
      );

      expect(commands.record).toHaveBeenCalledTimes(3);
    });

    it("passes the tenant and the redaction level down to the command", async () => {
      const { commands, service } = fixture();

      await handle(service, [span()]);

      expect(commands.record.mock.calls[0]?.[0]).toMatchObject({
        tenantId: "project-1",
        piiRedactionLevel: "ESSENTIAL",
      });
    });
  });

  describe("given a request with nothing in it", () => {
    it("reports nothing rejected rather than failing", async () => {
      const { service } = fixture();

      await expect(
        service.handleOtlpTraceRequest("project-1", {} as never, piiRedactionLevel),
      ).resolves.toEqual({ rejectedSpans: 0, errorMessage: "" });
    });
  });

  describe("given a span that fails validation", () => {
    it("rejects it and says why", async () => {
      const { service } = fixture();

      const result = await handle(service, [{ traceId: "trace-1" }]);

      expect(result.rejectedSpans).toBe(1);
      expect(result.errorMessage).toContain("span validation failed");
    });

    it("still ingests its neighbours in the same scope", async () => {
      const { commands, service } = fixture();

      await handle(service, [{ traceId: "trace-1" }, span()]);

      expect(commands.record).toHaveBeenCalledOnce();
    });
  });

  describe("given a span that started more than 31 days ago", () => {
    it("rejects it and names the age as the reason", async () => {
      const { commands, service } = fixture();
      const tooOld = Date.now() - SPAN_MAX_PAST_MS - 60_000;

      const result = await handle(service, [
        span({ startTimeUnixNano: String(tooOld * 1_000_000) }),
      ]);

      expect(result.rejectedSpans).toBe(1);
      expect(result.errorMessage).toContain("31 days in the past");
      expect(commands.record).not.toHaveBeenCalled();
    });

    it("accepts one that is only just inside the window", async () => {
      const { commands, service } = fixture();
      const justInside = Date.now() - SPAN_MAX_PAST_MS + 60_000;

      await handle(service, [span({ startTimeUnixNano: String(justInside * 1_000_000) })]);

      expect(commands.record).toHaveBeenCalledOnce();
    });
  });

  describe("given the coding-agent filter is on and matches", () => {
    it("does not dispatch the span", async () => {
      const { commands, service } = fixture({
        codingAgentSpanFilterEnabled: true,
        filterEverything: true,
      });

      await handle(service, [span()]);

      expect(commands.record).not.toHaveBeenCalled();
    });

    it("does not count the span as rejected, because dropping it was the point", async () => {
      const { service } = fixture({
        codingAgentSpanFilterEnabled: true,
        filterEverything: true,
      });

      await expect(handle(service, [span()])).resolves.toEqual({
        rejectedSpans: 0,
        errorMessage: "",
      });
    });
  });

  describe("given the coding-agent filter matches but is switched off", () => {
    it("ingests the span anyway", async () => {
      const { commands, service } = fixture({
        codingAgentSpanFilterEnabled: false,
        filterEverything: true,
      });

      await handle(service, [span()]);

      expect(commands.record).toHaveBeenCalledOnce();
    });
  });

  describe("given a span dedup has already seen", () => {
    it("does not count it as rejected", async () => {
      const { dedup, service } = fixture();
      dedup.acquire.mockResolvedValue(false);

      await expect(handle(service, [span()])).resolves.toEqual({
        rejectedSpans: 0,
        errorMessage: "",
      });
    });
  });

  describe("given the pipeline throws on a span", () => {
    it("counts it as rejected and surfaces the message", async () => {
      const { commands, service } = fixture();
      commands.record.mockRejectedValueOnce(new Error("pipeline down"));

      await expect(handle(service, [span()])).resolves.toEqual({
        rejectedSpans: 1,
        errorMessage: "pipeline down",
      });
    });
  });

  describe("given several spans fail for different reasons", () => {
    it("counts them all and joins their messages", async () => {
      const { commands, service } = fixture();
      commands.record.mockRejectedValueOnce(new Error("pipeline down"));

      const result = await handle(service, [span(), { traceId: "bad" }]);

      expect(result.rejectedSpans).toBe(2);
      expect(result.errorMessage).toContain("pipeline down");
      expect(result.errorMessage).toContain("span validation failed");
      expect(result.errorMessage).toContain("; ");
    });
  });

  describe("given the resource or scope fails to parse", () => {
    it("still ingests the spans, with no resource attached", async () => {
      const { commands, service } = fixture();

      await service.handleOtlpTraceRequest(
        "project-1",
        {
          resourceSpans: [
            { resource: "not a resource", scopeSpans: [{ scope: 42, spans: [span()] }] },
          ],
        } as never,
        piiRedactionLevel,
      );

      expect(commands.record).toHaveBeenCalledOnce();
      expect(commands.record.mock.calls[0]?.[0]).toMatchObject({
        resource: null,
        instrumentationScope: null,
      });
    });
  });
});
