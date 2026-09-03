import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillableEventsMeterClickHouseRepository } from "../clickhouse.billable-events-meter.repository";

function record() {
  return {
    organizationId: "",
    tenantId: "proj-1",
    eventId: "evt-1",
    eventType: "lw.obs.trace.span_received",
    deduplicationKey: "trace-abc:span-123",
    eventTimestamp: 1739613600000,
  };
}

describe("BillableEventsMeterClickHouseRepository", () => {
  const resolveClient = vi.fn();
  const mockClickHouseInsert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a resolved ClickHouse client", () => {
    describe("when a billable event is inserted", () => {
      it("inserts the row into billable_events", async () => {
        resolveClient.mockResolvedValue({ insert: mockClickHouseInsert });
        mockClickHouseInsert.mockResolvedValue(undefined);
        const repository = BillableEventsMeterClickHouseRepository.create({ resolveClient });

        await repository.insert({ record: record(), organizationId: "org-1" });

        expect(resolveClient).toHaveBeenCalledWith("org-1");
        expect(mockClickHouseInsert).toHaveBeenCalledWith({
          table: "billable_events",
          values: [
            expect.objectContaining({
              OrganizationId: "org-1",
              TenantId: "proj-1",
              EventId: "evt-1",
              EventType: "lw.obs.trace.span_received",
              DeduplicationKey: "trace-abc:span-123",
            }),
          ],
          format: "JSONEachRow",
          clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
        });
      });
    });
  });

  describe("given the resolver returns no client (ClickHouse not configured)", () => {
    describe("when a billable event is inserted", () => {
      it("skips the insert without throwing", async () => {
        resolveClient.mockResolvedValue(null);
        const repository = BillableEventsMeterClickHouseRepository.create({ resolveClient });

        await repository.insert({ record: record(), organizationId: "org-1" });

        expect(mockClickHouseInsert).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the ClickHouse insert rejects", () => {
    describe("when a billable event is inserted", () => {
      it("propagates the error", async () => {
        resolveClient.mockResolvedValue({ insert: mockClickHouseInsert });
        mockClickHouseInsert.mockRejectedValue(new Error("ClickHouse connection timeout"));
        const repository = BillableEventsMeterClickHouseRepository.create({ resolveClient });

        await expect(
          repository.insert({ record: record(), organizationId: "org-1" }),
        ).rejects.toThrow("ClickHouse connection timeout");
      });
    });
  });
});
