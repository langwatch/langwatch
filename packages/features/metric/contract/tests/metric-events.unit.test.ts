import { describe, expect, it } from "vitest";
import { metricEventEnvelopeSchema } from "../src/metric.events";

const envelope = {
  id: "event_1",
  aggregateId: "metric_1",
  aggregateType: "metric",
  tenantId: "project_1",
  createdAt: 1_774_560_000_000,
  occurredAt: 1_774_560_000_000,
  type: "lw.obs.metric.data_point_received",
  version: "2026-08-27",
  data: { pointId: "metric_1" },
};

describe("metric event envelope", () => {
  it("preserves tenant and idempotency data at the portable boundary", () => {
    const parsed = metricEventEnvelopeSchema.parse({
      ...envelope,
      idempotencyKey: "project_1:metric_1",
      metadata: { processingTraceparent: "00-trace-span-01", attempt: 2 },
    });

    expect(parsed).toMatchObject({
      tenantId: "project_1",
      idempotencyKey: "project_1:metric_1",
      metadata: { processingTraceparent: "00-trace-span-01", attempt: 2 },
    });
  });

  it.each([
    { field: "tenantId", value: "" },
    { field: "aggregateType", value: " " },
    { field: "version", value: "v1" },
    { field: "occurredAt", value: -1 },
  ])("rejects an invalid $field", ({ field, value }) => {
    expect(() => metricEventEnvelopeSchema.parse({ ...envelope, [field]: value })).toThrow();
  });
});
