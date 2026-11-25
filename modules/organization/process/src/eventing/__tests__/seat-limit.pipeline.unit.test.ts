import { createTenantId } from "@langwatch/eventing";
/**
 * @vitest-environment node
 *
 * organization_seat_limit: organization records a reached seat limit as a fact;
 * billing reacts from its side (ARCHITECTURE §9).
 * @see specs/licensing/resource-limit-notifications.feature
 */
import { SEAT_LIMIT_REACHED_EVENT_TYPE } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { RecordSeatLimitReachedCommand } from "../seat-limit.commands.ts";
import type { RecordSeatLimitReachedCommandData } from "../seat-limit.events.ts";
import { buildSeatLimitPipeline } from "../seat-limit.pipeline.ts";

const REACHED: RecordSeatLimitReachedCommandData = {
  tenantId: "org_acme",
  organizationId: "org_acme",
  limitType: "members",
  current: 5,
  max: 5,
  occurredAt: Date.UTC(2026, 8, 28, 12),
};

async function recordedEvent() {
  const [event] = await new RecordSeatLimitReachedCommand().handle({
    tenantId: createTenantId("org_acme"),
    aggregateId: "org_acme",
    type: RecordSeatLimitReachedCommand.schema.type,
    data: REACHED,
  });
  if (!event) throw new Error("the command recorded no event");
  return event;
}

describe("organization's seat-limit pipeline", () => {
  it("records one seat-limit-reached event on the organization", async () => {
    const event = await recordedEvent();

    expect(event.type).toBe(SEAT_LIMIT_REACHED_EVENT_TYPE);
    expect(event.aggregateId).toBe("org_acme");
    expect(event.data).toEqual(REACHED);
  });

  it("holds no subscriber, since peers react from their own side", () => {
    expect(buildSeatLimitPipeline().eventSubscribers.size).toBe(0);
  });
});
