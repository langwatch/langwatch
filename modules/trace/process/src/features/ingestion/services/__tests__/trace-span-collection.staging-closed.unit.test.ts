/** Shutdown closing queue staging under a running request is one warning, not one per span. */
import { QueueStagingClosedError } from "@langwatch/group-queue";
import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import { createTestLogger } from "@langwatch/test-harness";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  type SpanDedupClaim,
  type SpanDedupRef,
  TraceSpanDedupRepository,
} from "../../../../repositories/trace-span-dedup.repository.ts";
import {
  type RecordSpanOutcome,
  TraceIngressCommand,
  TraceSpanCollectionService,
} from "../trace-span-collection.service.ts";

const captured = vi.hoisted(() => ({ logger: undefined as unknown }));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLogger: () => captured.logger,
}));

class RefusingCommand extends TraceIngressCommand {
  constructor(private readonly refusal: () => Error) {
    super();
  }

  recordSpan(): Promise<void> {
    return Promise.reject(this.refusal());
  }

  async recordSpans(data: readonly RecordSpanCommandData[]): Promise<RecordSpanOutcome[]> {
    return data.map(() => ({ status: "failed", error: this.refusal() }));
  }
}

class FreeDedup extends TraceSpanDedupRepository {
  claimProcessing(spans: readonly SpanDedupRef[]): Promise<SpanDedupClaim[]> {
    return Promise.resolve(spans.map(() => ({ outcome: "acquired" as const })));
  }
  confirmProcessed(): Promise<void> {
    return Promise.resolve();
  }
  releaseOnFailure(): Promise<void> {
    return Promise.resolve();
  }
  claimUsageRecord(): Promise<SpanDedupClaim> {
    return Promise.resolve({ outcome: "acquired" });
  }
  releaseUsageRecord(): Promise<void> {
    return Promise.resolve();
  }
}

function spanInput(spanId: string) {
  const now = String(Date.now() * 1_000_000);
  const span = {
    traceId: "trace-1",
    spanId,
    parentSpanId: "",
    name: "span",
    kind: 1,
    startTimeUnixNano: now,
    endTimeUnixNano: now,
    attributes: [],
    droppedAttributesCount: 0,
    events: [],
    droppedEventsCount: 0,
    links: [],
    droppedLinksCount: 0,
    status: { code: 0, message: "" },
    traceState: "",
    flags: 0,
  } as OtlpSpan;
  return {
    tenantId: "project-1",
    span,
    resource: null,
    instrumentationScope: null,
    piiRedactionLevel: "ESSENTIAL" as const,
  };
}

function collecting(refusal: () => Error) {
  const { logger, lines } = createTestLogger();
  captured.logger = logger;
  const service = TraceSpanCollectionService.create({
    dedup: new FreeDedup(),
    commands: new RefusingCommand(refusal),
  });
  return { service, lines };
}

const stagingClosed = () =>
  new QueueStagingClosedError({ queueName: "{event-sourcing/jobs}", operation: "sendEach" });

describe("given shutdown closed queue staging while a request was still handing off spans", () => {
  /** @scenario "Spans refused because shutdown closed queue staging are logged once per request" */
  it("fails every span and logs the request once, at warn", async () => {
    const { service, lines } = collecting(stagingClosed);

    const results = await service.ingestNormalizedSpans(
      Array.from({ length: 3 }, (_, index) => spanInput(`span-${index}`)),
    );

    expect(results.map((result) => result.status)).toEqual(["failed", "failed", "failed"]);
    expect(lines.filter((line) => line.level >= 50)).toEqual([]);
    expect(lines.filter((line) => line.level === 40)).toEqual([
      expect.objectContaining({ spans: 3, tenantId: "project-1" }),
    ]);
  });

  /** @scenario "Spans refused because shutdown closed queue staging are logged once per request" */
  it("logs a single span's refusal once, at warn", async () => {
    const { service, lines } = collecting(stagingClosed);

    await service.ingestNormalizedSpan(spanInput("span-1"));

    expect(lines.filter((line) => line.level >= 50)).toEqual([]);
    expect(lines.filter((line) => line.level === 40)).toHaveLength(1);
  });
});

describe("given the hand-off fails for any other reason", () => {
  /** @scenario "Spans the pipeline fails for any other reason are each logged as an error" */
  it("still logs each span at error", async () => {
    const { service, lines } = collecting(() => new Error("redis unreachable"));

    await service.ingestNormalizedSpans([spanInput("span-1"), spanInput("span-2")]);

    expect(lines.filter((line) => line.level === 50)).toHaveLength(2);
    expect(lines.filter((line) => line.level === 40)).toEqual([]);
  });
});
