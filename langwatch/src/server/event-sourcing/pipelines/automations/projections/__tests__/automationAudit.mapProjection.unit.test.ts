import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "../../schemas/constants";
import { triggerMatchRecordedEventSchema } from "../../schemas/events";
import { createAutomationAuditMapProjection } from "../automationAudit.mapProjection";

describe("automation audit projection", () => {
  it("uses the logical idempotency key instead of a transient physical row id", () => {
    const projection = createAutomationAuditMapProjection({
      store: { append: vi.fn().mockResolvedValue(undefined) },
    });
    const event = triggerMatchRecordedEventSchema.parse({
      id: "physical-2",
      idempotencyKey: "trigger-1:trace-1:30000-0",
      aggregateId: "trigger-1",
      aggregateType: "trigger",
      tenantId: createTenantId("project-1"),
      createdAt: 1_000,
      occurredAt: 900,
      type: TRIGGER_MATCH_RECORDED_EVENT_TYPE,
      version: "2026-07-18",
      data: {
        triggerId: "trigger-1",
        traceId: "trace-1",
        action: "SEND_EMAIL",
        actionClass: "notify",
        traceDebounceMs: 30_000,
        notificationCadence: "immediate",
      },
    });

    expect(projection.map(event)).toMatchObject({
      eventId: "trigger-1:trace-1:30000-0",
      triggerId: "trigger-1",
      traceId: "trace-1",
    });
  });
});
