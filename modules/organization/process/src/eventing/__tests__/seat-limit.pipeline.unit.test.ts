/**
 * @vitest-environment node
 *
 * organization_seat_limit: the api records a reached seat limit; the worker's
 * subscriber on this pipeline tells billing through its Api (ARCHITECTURE §9).
 * @see specs/licensing/resource-limit-notifications.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type {
  BillingApi,
  ResourceLimitNotifierInput,
} from "@langwatch/enterprise-billing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordSeatLimitReachedCommand } from "../seat-limit.commands.ts";
import type { RecordSeatLimitReachedCommandData } from "../seat-limit.events.ts";
import { SEAT_LIMIT_REACHED_EVENT_TYPE } from "../seat-limit.events.ts";
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

  it("builds no reaction in the api role", () => {
    expect(buildSeatLimitPipeline({}).eventSubscribers.size).toBe(0);
  });

  /** @scenario "Organization's seat-limit event tells billing" */
  it("tells billing the limit type, current and max once the worker handles the event", async () => {
    const told: ResourceLimitNotifierInput[] = [];
    const billing = createApiFixture<BillingApi>({
      notifyResourceLimitReached: async (input) => {
        told.push(input);
      },
    });
    const subscriber = buildSeatLimitPipeline({ billing }).eventSubscribers.get("notifyBilling");

    await subscriber?.handle(await recordedEvent(), {
      tenantId: createTenantId("org_acme"),
      aggregateId: "org_acme",
    });

    expect(subscriber?.eventTypes).toEqual([SEAT_LIMIT_REACHED_EVENT_TYPE]);
    expect(told).toEqual([
      { organizationId: "org_acme", limitType: "members", current: 5, max: 5 },
    ]);
  });
});
