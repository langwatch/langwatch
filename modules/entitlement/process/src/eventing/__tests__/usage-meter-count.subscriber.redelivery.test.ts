import { EventSchema } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { usageMeterCountSubscriber } from "../usage-meter-count.subscriber.ts";
import type { CountMonthCommandData } from "../usage.events.ts";

const meteredEvent = EventSchema.parse({
  id: "evt_1",
  aggregateId: "trace_1",
  aggregateType: "trace",
  tenantId: "project_alpha",
  createdAt: 1_772_539_200_000,
  occurredAt: 1_772_539_200_000,
  type: "lw.obs.trace.span_received",
  version: "2026-01-01",
  data: {},
});

describe("usageMeterCount redelivery", () => {
  it("asks for the same month counts when one event is handled twice", async () => {
    // countMonth collapses on `${organizationId}:${month}`, as usage.pipeline.ts deduplicates.
    const pending = new Map<string, CountMonthCommandData>();
    const subscriber = usageMeterCountSubscriber({
      projects: { findOrganizationId: async () => "org_1" },
      countMonth: async (data: CountMonthCommandData) => {
        pending.set(`${data.organizationId}:${data.month}`, data);
      },
    });
    const context = { tenantId: "project_alpha", aggregateId: "trace_1", foldState: undefined };

    await subscriber.handle(meteredEvent, context);
    const once = [...pending.keys()];
    await subscriber.handle(meteredEvent, context);

    expect([...pending.keys()]).toEqual(once);
    expect(once.length).toBeGreaterThan(0);
  });
});
