import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../memory.billable-events-meter.repository.ts";
import { MemoryBillableEventsRepository } from "../memory.billable-events.repository.ts";
import { MemoryBillingStore } from "../memory.billing.store.ts";

const WINDOW = {
  startDate: "2026-02-01 00:00:00.000",
  endDate: "2026-03-01 00:00:00.000",
};

function event(
  input: Partial<{
    tenantId: string;
    eventId: string;
    deduplicationKey: string;
    eventTimestamp: number;
  }> = {},
) {
  return {
    organizationId: "ignored-by-meter",
    tenantId: input.tenantId ?? "project-1",
    eventId: input.eventId ?? "event-1",
    eventType: "lw.obs.trace.span_received",
    deduplicationKey: input.deduplicationKey ?? "trace-1:span-1",
    eventTimestamp: input.eventTimestamp ?? Date.parse("2026-02-10T12:00:00.000Z"),
  };
}

function repositories() {
  const store = MemoryBillingStore.create();
  return {
    store,
    meter: MemoryBillableEventsMeterRepository.create(store),
    reader: MemoryBillableEventsRepository.create(store),
  };
}

describe("MemoryBillableEventsRepository", () => {
  describe("when the meter writes a billing month", () => {
    /** @scenario "Memory billable events keep organization, time-window, and deduplication semantics" */
    it("counts the input organization, distinct keys, and a half-open UTC window", async () => {
      const { meter, reader } = repositories();
      const start = Date.parse("2026-02-01T00:00:00.000Z");
      const end = Date.parse("2026-03-01T00:00:00.000Z");

      await meter.insert({ record: event({ eventTimestamp: start }), organizationId: "org-1" });
      await meter.insert({
        record: event({ eventId: "retry", eventTimestamp: start }),
        organizationId: "org-1",
      });
      await meter.insert({
        record: event({
          tenantId: "project-2",
          eventId: "event-2",
          deduplicationKey: "trace-2:span-1",
          eventTimestamp: end - 1,
        }),
        organizationId: "org-1",
      });
      await meter.insert({
        record: event({ eventId: "next-month", deduplicationKey: "march", eventTimestamp: end }),
        organizationId: "org-1",
      });
      await meter.insert({
        record: event({ eventId: "other-org", deduplicationKey: "other-org:trace-1:span-1" }),
        organizationId: "org-2",
      });

      await expect(reader.findTotal({ organizationId: "org-1", ...WINDOW })).resolves.toBe(2);
      await expect(reader.findTotal({ organizationId: "org-2", ...WINDOW })).resolves.toBe(1);
      await expect(reader.findTotalUniq({ organizationId: "org-1", ...WINDOW })).resolves.toBe(2);
      await expect(reader.findByProject({ organizationId: "org-1", ...WINDOW })).resolves.toEqual([
        { projectId: "project-1", count: 1 },
        { projectId: "project-2", count: 1 },
      ]);
      await expect(
        reader.findByProjectApprox({ organizationId: "org-1", ...WINDOW }),
      ).resolves.toEqual([
        { projectId: "project-1", count: 1 },
        { projectId: "project-2", count: 1 },
      ]);
    });
  });
});
