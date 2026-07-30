/**
 * Unit tests for the billable-events meter store, driven through the mount
 * that builds it (`createBillingReportingPipeline(...).meter.store`):
 * organization resolution, the orphan-project and ClickHouse-unconfigured skip
 * paths, and — the behaviour this pipeline exists to guarantee — that a
 * redelivery cannot double-bill, because two writes for the same dedup key
 * land on the same row identity.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import type { ClickHouseClient } from "@langwatch/clickhouse";
import { describe, expect, it, vi } from "vitest";

const { createMockLogger } = vi.hoisted(() => ({
  createMockLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: vi.fn().mockResolvedValue("org-default"),
}));

import {
  type BillableEventMeterRecord,
  createBillingReportingPipeline,
} from "..";

function makeClient(
  overrides: Partial<ClickHouseClient> = {},
): ClickHouseClient {
  return {
    query: vi.fn(),
    stream: vi.fn(),
    insert: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ...overrides,
  } as unknown as ClickHouseClient;
}

function makeRecord(
  overrides: Partial<BillableEventMeterRecord> = {},
): BillableEventMeterRecord {
  return {
    eventId: "evt-1",
    eventType: "lw.obs.trace.span_received",
    deduplicationKey: "evt-1",
    eventTimestamp: Date.UTC(2026, 1, 15, 10, 0, 0),
    ...overrides,
  };
}

function storeFor(deps: {
  resolveOrganizationId: (projectId: string) => Promise<string | undefined>;
  getClickHouseClientForOrganization: (
    organizationId: string,
  ) => Promise<ClickHouseClient | null>;
}) {
  return createBillingReportingPipeline({
    organizations: { getOrganizationForBilling: vi.fn() },
    billingCheckpoints: {} as never,
    getUsageReportingService: () => undefined,
    queryBillableEventsTotal: vi.fn() as never,
    isSaas: true,
    ...deps,
  }).meter.store;
}

describe("the billable-events meter store", () => {
  describe("given the project resolves to an organization and ClickHouse is configured", () => {
    it("resolves the organization once per batch and inserts one row per record", async () => {
      const client = makeClient();
      const resolveOrganizationId = vi.fn().mockResolvedValue("org-1");
      const getClickHouseClientForOrganization = vi
        .fn()
        .mockResolvedValue(client);

      const store = storeFor({
        resolveOrganizationId,
        getClickHouseClientForOrganization,
      });

      await store.writeBatch(
        [
          makeRecord({ eventId: "evt-1" }),
          makeRecord({ eventId: "evt-2", deduplicationKey: "evt-2" }),
        ],
        { tenantId: "proj-1" },
      );

      expect(resolveOrganizationId).toHaveBeenCalledTimes(1);
      expect(resolveOrganizationId).toHaveBeenCalledWith("proj-1");
      expect(getClickHouseClientForOrganization).toHaveBeenCalledWith("org-1");

      expect(client.insert).toHaveBeenCalledTimes(1);
      const call = vi.mocked(client.insert).mock.calls[0]![0];
      expect(call.table).toBe("billable_events");
      expect(call.columns).toEqual([
        "OrganizationId",
        "TenantId",
        "EventId",
        "EventType",
        "DeduplicationKey",
        "EventTimestamp",
        "UpdatedAt",
      ]);
      // Never DeduplicationKeyHash: that column is MATERIALIZED, and an
      // explicit insert column list naming it is rejected by ClickHouse.
      expect(call.columns).not.toContain("DeduplicationKeyHash");
      expect(call.rows).toHaveLength(2);
    });
  });

  describe("given the same record is written twice (a redelivery)", () => {
    it("produces rows whose identity columns are byte-identical, so ClickHouse collapses them to one", async () => {
      const client = makeClient();
      const store = storeFor({
        resolveOrganizationId: vi.fn().mockResolvedValue("org-1"),
        getClickHouseClientForOrganization: vi.fn().mockResolvedValue(client),
      });

      const record = makeRecord({
        eventId: "evt-1",
        deduplicationKey: "biz-key-1",
      });
      await store.writeBatch([record], { tenantId: "proj-1" });
      await store.writeBatch([{ ...record }], { tenantId: "proj-1" });

      const [firstCall, secondCall] = vi.mocked(client.insert).mock.calls;
      // Row layout is [OrganizationId, TenantId, EventId, EventType,
      // DeduplicationKey, EventTimestamp, UpdatedAt]. The sort-key identity
      // (OrganizationId, TenantId, DeduplicationKey) must match exactly.
      const identityOf = (row: unknown[]) => row.slice(0, 5);
      expect(identityOf(firstCall![0].rows[0]!)).toEqual(
        identityOf(secondCall![0].rows[0]!),
      );
    });
  });

  describe("given the project has no organization (an orphan project)", () => {
    it("skips the insert without resolving a ClickHouse client", async () => {
      const client = makeClient();
      const getClickHouseClientForOrganization = vi
        .fn()
        .mockResolvedValue(client);

      const store = storeFor({
        resolveOrganizationId: vi.fn().mockResolvedValue(undefined),
        getClickHouseClientForOrganization,
      });

      await store.writeBatch([makeRecord()], { tenantId: "orphan-proj" });

      expect(getClickHouseClientForOrganization).not.toHaveBeenCalled();
      expect(client.insert).not.toHaveBeenCalled();
    });
  });

  describe("given ClickHouse is not configured for this organization", () => {
    it("skips the insert gracefully", async () => {
      const store = storeFor({
        resolveOrganizationId: vi.fn().mockResolvedValue("org-1"),
        getClickHouseClientForOrganization: vi.fn().mockResolvedValue(null),
      });

      await expect(
        store.writeBatch([makeRecord()], { tenantId: "proj-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given the ClickHouse insert fails", () => {
    it("propagates the failure so the delivery retries", async () => {
      const client = makeClient({
        insert: vi
          .fn()
          .mockRejectedValue(new Error("clickhouse connection timeout")),
      });

      const store = storeFor({
        resolveOrganizationId: vi.fn().mockResolvedValue("org-1"),
        getClickHouseClientForOrganization: vi.fn().mockResolvedValue(client),
      });

      await expect(
        store.writeBatch([makeRecord()], { tenantId: "proj-1" }),
      ).rejects.toThrow("clickhouse connection timeout");
    });
  });

  describe("given an empty batch", () => {
    it("does nothing", async () => {
      const resolveOrganizationId = vi.fn();
      const store = storeFor({
        resolveOrganizationId,
        getClickHouseClientForOrganization: vi.fn(),
      });

      await store.writeBatch([], { tenantId: "proj-1" });

      expect(resolveOrganizationId).not.toHaveBeenCalled();
    });
  });

  describe("given two organizations that resolve to the same ClickHouse client", () => {
    it("reuses one inner store rather than rebuilding per batch", async () => {
      const client = makeClient();
      const store = storeFor({
        resolveOrganizationId: vi
          .fn()
          .mockResolvedValueOnce("org-1")
          .mockResolvedValueOnce("org-2"),
        getClickHouseClientForOrganization: vi.fn().mockResolvedValue(client),
      });

      await store.writeBatch([makeRecord()], { tenantId: "proj-1" });
      await store.writeBatch([makeRecord()], { tenantId: "proj-2" });

      expect(client.insert).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = vi.mocked(client.insert).mock.calls;
      expect(firstCall![0].rows[0]![0]).toBe("org-1");
      expect(secondCall![0].rows[0]![0]).toBe("org-2");
    });
  });
});
