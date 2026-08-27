import { createTenantId, type Command, type TenantId } from "@langwatch/eventing";
import {
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  spanReceivedEventSchema,
  type OtlpResource,
  type OtlpSpan,
  type PIIRedactionLevel,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { EventingRecordSpanAdapter } from "../../src/adapters/eventing.record-span.adapter";
import {
  TraceSpanContentDropPort,
  TraceSpanCostEnrichmentPort,
  TraceSpanPiiRedactionPort,
  TraceSpanTokenEstimationPort,
} from "../../src/ports/trace-span-preparation.port";
import {
  TraceSpanSpoolPort,
  type TraceSpanSpoolIdentity,
} from "../../src/ports/trace-span-spool.port";

class PiiRedactionFake extends TraceSpanPiiRedactionPort {
  readonly redact = vi.fn(
    async (
      _span: OtlpSpan,
      _resource: OtlpResource | null,
      _level: PIIRedactionLevel,
      _tenantId: TenantId,
    ) => {},
  );
}

class CostEnrichmentFake extends TraceSpanCostEnrichmentPort {
  readonly enrich = vi.fn(async (_span: OtlpSpan, _tenantId: string) => {});
}

class TokenEstimationFake extends TraceSpanTokenEstimationPort {
  readonly estimate = vi.fn(async (_span: OtlpSpan, _tenantId: string) => {});
}

class ContentDropFake extends TraceSpanContentDropPort {
  readonly drop = vi.fn(async (_span: OtlpSpan, _projectId: string) => ({
    droppedCount: 0,
    droppedCategories: [] as string[],
  }));
}

class SpoolFake extends TraceSpanSpoolPort {
  readonly read = vi.fn(async (_identity: TraceSpanSpoolIdentity) => "");
  readonly delete = vi.fn(async (_identity: TraceSpanSpoolIdentity) => {});
}

function commandData(overrides: Partial<RecordSpanCommandData> = {}): RecordSpanCommandData {
  return {
    tenantId: "project-1",
    occurredAt: 1_700_000_000_000,
    span: {
      traceId: "trace-1",
      spanId: "span-1",
      name: "test-span",
      kind: 1,
      startTimeUnixNano: "1000000",
      endTimeUnixNano: "2000000",
      attributes: [],
      events: [],
      links: [],
      status: {},
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: null,
    instrumentationScope: null,
    ...overrides,
  };
}

function command(data: RecordSpanCommandData = commandData()): Command<RecordSpanCommandData> {
  return {
    type: RECORD_SPAN_COMMAND_TYPE,
    tenantId: createTenantId(data.tenantId),
    aggregateId: data.span.traceId,
    data,
  };
}

function harness(spool?: TraceSpanSpoolPort) {
  const piiRedaction = new PiiRedactionFake();
  const costEnrichment = new CostEnrichmentFake();
  const tokenEstimation = new TokenEstimationFake();
  const contentDrop = new ContentDropFake();
  const handler = EventingRecordSpanAdapter.create({
    piiRedaction,
    costEnrichment,
    tokenEstimation,
    contentDrop,
    spool,
  });

  return {
    handler,
    piiRedaction,
    costEnrichment,
    tokenEstimation,
    contentDrop,
  };
}

describe("RecordSpanCommand", () => {
  it("emits the stable span event identity after preparing a cloned span", async () => {
    const input = commandData({
      span: {
        ...commandData().span,
        attributes: [
          { key: "customer", value: { stringValue: "kept" } },
          {
            key: "langwatch.reserved.customer",
            value: { stringValue: "removed" },
          },
          {
            key: "langwatch.reserved.causality_depth",
            value: { intValue: 1 },
          },
        ],
      },
    });
    const { handler, piiRedaction, costEnrichment, tokenEstimation } = harness();

    const events = await handler.handle(command(input));
    const spanReceivedEvent = spanReceivedEventSchema.parse(
      events.find((event) => event.type === SPAN_RECEIVED_EVENT_TYPE),
    );

    expect(spanReceivedEvent).toMatchObject({
      aggregateType: "trace",
      aggregateId: "trace-1",
      tenantId: "project-1",
      type: SPAN_RECEIVED_EVENT_TYPE,
      data: { piiRedactionLevel: "ESSENTIAL" },
      metadata: { traceId: "trace-1", spanId: "span-1" },
      occurredAt: input.occurredAt,
      idempotencyKey: "project-1:trace-1:span-1",
    });
    expect(spanReceivedEvent.data.span.attributes.map(({ key }) => key)).toEqual([
      "customer",
      "langwatch.reserved.causality_depth",
    ]);
    expect(input.span.attributes).toHaveLength(3);
    expect(piiRedaction.redact).toHaveBeenCalledOnce();
    expect(costEnrichment.enrich).toHaveBeenCalledOnce();
    expect(tokenEstimation.estimate).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
  });

  it("aborts when critical PII redaction fails", async () => {
    const test = harness();
    test.piiRedaction.redact.mockRejectedValueOnce(new Error("redaction failed"));

    await expect(test.handler.handle(command())).rejects.toThrow("redaction failed");
  });

  it("continues when cost and token enrichment fail", async () => {
    const test = harness();
    test.costEnrichment.enrich.mockRejectedValueOnce(new Error("cost failed"));
    test.tokenEstimation.estimate.mockRejectedValueOnce(new Error("token failed"));

    await expect(test.handler.handle(command())).resolves.toHaveLength(1);
  });

  it("reconstitutes a spooled span and deletes it only after durable storage", async () => {
    const spool = new SpoolFake();
    const full = commandData({
      span: {
        ...commandData().span,
        attributes: [{ key: "large", value: { stringValue: "full" } }],
      },
    });
    spool.read.mockResolvedValueOnce(JSON.stringify(full));
    const test = harness(spool);
    const queued = command(
      commandData({
        spoolRef: "sha256:abc",
        span: { ...full.span, attributes: [] },
      }),
    );

    const events = await test.handler.handle(queued);
    const event = spanReceivedEventSchema.parse(
      events.find((candidate) => candidate.type === SPAN_RECEIVED_EVENT_TYPE),
    );

    expect(event.data.span.attributes).toEqual(full.span.attributes);
    expect(spool.delete).not.toHaveBeenCalled();

    await test.handler.cleanupAfterStore(queued);
    expect(spool.delete).toHaveBeenCalledWith({
      spoolRef: "sha256:abc",
      projectId: "project-1",
      traceId: "trace-1",
      spanId: "span-1",
    });
  });

  it("rejects a spool marker when spool infrastructure is absent", async () => {
    const { handler } = harness();
    const queued = command(commandData({ spoolRef: "sha256:abc" }));

    await expect(handler.handle(queued)).rejects.toThrow("no blobStore configured");
  });
});
