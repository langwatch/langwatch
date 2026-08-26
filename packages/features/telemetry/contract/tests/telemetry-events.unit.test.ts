import { describe, expect, it } from "vitest";
import { telemetryEventEnvelopeSchema } from "../src/telemetry.events";

const envelope = {
  id: "event_1",
  aggregateId: "log_1",
  aggregateType: "log",
  tenantId: "project_1",
  createdAt: 1_774_560_000_000,
  occurredAt: 1_774_560_000_000,
  type: "lw.obs.log.record_received",
  version: "2026-08-27",
  data: { recordId: "log_1" },
};

describe("telemetry event envelope", () => {
  it("preserves tenant and idempotency data at the portable boundary", () => {
    const parsed = telemetryEventEnvelopeSchema.parse({
      ...envelope,
      idempotencyKey: "project_1:log_1",
      metadata: { processingTraceparent: "00-trace-span-01", attempt: 2 },
    });

    expect(parsed).toMatchObject({
      tenantId: "project_1",
      idempotencyKey: "project_1:log_1",
      metadata: { processingTraceparent: "00-trace-span-01", attempt: 2 },
    });
  });

  it.each([
    { field: "tenantId", value: "" },
    { field: "aggregateType", value: " " },
    { field: "version", value: "v1" },
    { field: "occurredAt", value: -1 },
  ])("rejects an invalid $field", ({ field, value }) => {
    expect(() =>
      telemetryEventEnvelopeSchema.parse({ ...envelope, [field]: value }),
    ).toThrow();
  });
});
