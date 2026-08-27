import type { OtlpSpan, PIIRedactionLevel, RecordSpanCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import {
  TraceIngressCommandPort,
  TraceIngestionService,
  TraceSpanDedupPort,
} from "../src/services/trace-ingestion.service";
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

function span(): OtlpSpan {
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
  };
}

function fixture() {
  const dedup = new TestTraceSpanDedup();
  const commands = new TestTraceIngressCommand();
  const service = TraceIngestionService.create({
    codingAgents: new TestCodingAgentService(),
    codingAgentSpanFilterEnabled: false,
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

describe("TraceIngestionService", () => {
  it("dispatches and confirms an acquired span", async () => {
    const { commands, dedup, service } = fixture();

    await expect(service.ingestNormalizedSpan(input())).resolves.toMatchObject({
      status: "collected",
    });
    expect(commands.record).toHaveBeenCalledOnce();
    expect(dedup.confirm).toHaveBeenCalledOnce();
  });

  it("does not dispatch a span already claimed by dedup", async () => {
    const { commands, dedup, service } = fixture();
    dedup.acquire.mockResolvedValueOnce(false);

    await expect(service.ingestNormalizedSpan(input())).resolves.toEqual({
      status: "deduped",
    });
    expect(commands.record).not.toHaveBeenCalled();
    expect(dedup.confirm).not.toHaveBeenCalled();
  });

  it("releases an acquired lock when command dispatch fails", async () => {
    const { commands, dedup, service } = fixture();
    commands.record.mockRejectedValueOnce(new Error("dispatch failed"));

    await expect(service.ingestNormalizedSpan(input())).resolves.toMatchObject({
      status: "failed",
      error: "dispatch failed",
    });
    expect(dedup.release).toHaveBeenCalledOnce();
  });

  it("fails open when the dedup store is unavailable", async () => {
    const { commands, dedup, service } = fixture();
    dedup.acquire.mockResolvedValueOnce(null);

    await expect(service.ingestNormalizedSpan(input())).resolves.toMatchObject({
      status: "collected",
    });
    expect(commands.record).toHaveBeenCalledOnce();
  });
});
