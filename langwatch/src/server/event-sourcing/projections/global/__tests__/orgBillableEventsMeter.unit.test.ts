/**
 * Unit tests for the billable events meter projection and store.
 *
 * Mocks boundaries: ClickHouse client, Prisma (org lookup), logger.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../../domain/types";
import type { ProjectionStoreContext } from "../../projectionStoreContext";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockClickHouseInsert,
  mockGetClickHouseClientForOrganization,
  mockPrisma,
  mockLoggerWarn,
  mockLoggerDebug,
  createMockLogger,
} = vi.hoisted(() => {
  const mockClickHouseInsert = vi.fn();
  const mockGetClickHouseClientForOrganization = vi.fn();
  const mockLoggerWarn = vi.fn();
  const mockLoggerDebug = vi.fn();

  const createMockLogger = () => ({
    info: vi.fn(),
    debug: mockLoggerDebug,
    warn: mockLoggerWarn,
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  });

  const mockPrisma = {
    project: { findUnique: vi.fn() },
  };

  return {
    mockClickHouseInsert,
    mockGetClickHouseClientForOrganization,
    mockPrisma,
    mockLoggerWarn,
    mockLoggerDebug,
    createMockLogger,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForOrganization: mockGetClickHouseClientForOrganization,
}));

vi.mock("~/server/db", () => ({ prisma: mockPrisma }));

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dummyContext = {
  aggregateId: "test-aggregate",
  tenantId: "test-tenant",
} as ProjectionStoreContext;

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-1",
    aggregateId: "agg-1",
    aggregateType: "trace",
    tenantId: "proj-1",
    createdAt: Date.UTC(2026, 1, 15, 10, 0, 0),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: "2025-12-14",
    data: {},
    metadata: {},
    ...overrides,
  } as Event;
}

// ---------------------------------------------------------------------------
// Tests: extractDeduplicationKey
// ---------------------------------------------------------------------------

describe("extractDeduplicationKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("when event has idempotencyKey", () => {
    it("uses idempotencyKey", async () => {
      const { extractDeduplicationKey } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = extractDeduplicationKey(
        makeEvent({ id: "evt-1", idempotencyKey: "business-key-123" }),
      );

      expect(result).toBe("business-key-123");
    });
  });

  describe("when event has no idempotencyKey", () => {
    it("falls back to event.id", async () => {
      const { extractDeduplicationKey } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = extractDeduplicationKey(
        makeEvent({ id: "evt-42" }),
      );

      expect(result).toBe("evt-42");
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: MapProjection (map function)
// ---------------------------------------------------------------------------

describe("orgBillableEventsMeterProjection.map", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("given any billable event", () => {
    it("produces a record with event.id as dedup key", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeEvent({ id: "evt-1", type: "lw.obs.trace.span_received" }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "evt-1",
          eventType: "lw.obs.trace.span_received",
          tenantId: "proj-1",
          eventId: "evt-1",
        }),
      );
    });
  });

  describe("given event with idempotencyKey", () => {
    it("uses idempotencyKey as dedup key", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeEvent({
          id: "evt-1",
          idempotencyKey: "idem-key-abc",
          type: "lw.evaluation.started",
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "idem-key-abc",
          eventType: "lw.evaluation.started",
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: AppendStore
// ---------------------------------------------------------------------------

describe("orgBillableEventsMeterStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("given ClickHouse client is configured and org exists", () => {
    it("resolves organizationId and inserts into ClickHouse", async () => {
      mockGetClickHouseClientForOrganization.mockResolvedValue({
        insert: mockClickHouseInsert,
      });
      mockClickHouseInsert.mockResolvedValue(undefined);
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const { orgBillableEventsMeterStore } = await import(
        "../orgBillableEventsMeter.store"
      );


      await orgBillableEventsMeterStore.append(
        {
          organizationId: "",
          tenantId: "proj-1",
          eventId: "evt-1",

          eventType: "lw.obs.trace.span_received",
          deduplicationKey: "trace-abc:span-123",
          eventTimestamp: 1739613600000,
        },
        dummyContext,
      );

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

  describe("given ClickHouse client is null (not configured)", () => {
    it("skips gracefully", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });
      mockGetClickHouseClientForOrganization.mockResolvedValue(null);

      const { orgBillableEventsMeterStore } = await import(
        "../orgBillableEventsMeter.store"
      );


      await orgBillableEventsMeterStore.append(
        {
          organizationId: "",
          tenantId: "proj-1",
          eventId: "evt-1",

          eventType: "lw.obs.trace.span_received",
          deduplicationKey: "trace-abc:span-123",
          eventTimestamp: 1739613600000,
        },
        dummyContext,
      );

      expect(mockClickHouseInsert).not.toHaveBeenCalled();
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        "ClickHouse not configured, skipping billable event insert",
      );
    });
  });

  describe("given ClickHouse insert fails (transient error)", () => {
    it("throws for BullMQ retry", async () => {
      const insertError = new Error("ClickHouse connection timeout");
      mockGetClickHouseClientForOrganization.mockResolvedValue({
        insert: mockClickHouseInsert,
      });
      mockClickHouseInsert.mockRejectedValue(insertError);
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const { orgBillableEventsMeterStore } = await import(
        "../orgBillableEventsMeter.store"
      );
      await expect(
        orgBillableEventsMeterStore.append(
          {
            organizationId: "",
            tenantId: "proj-1",
            eventId: "evt-1",
  
            eventType: "lw.obs.trace.span_received",
            deduplicationKey: "trace-abc:span-123",
            eventTimestamp: 1739613600000,
          },
          dummyContext,
        ),
      ).rejects.toThrow("ClickHouse connection timeout");
    });
  });

  describe("given orphan project (org not found)", () => {
    it("skips gracefully with warn log", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: null,
      });

      const { orgBillableEventsMeterStore } = await import(
        "../orgBillableEventsMeter.store"
      );
      await orgBillableEventsMeterStore.append(
        {
          organizationId: "",
          tenantId: "orphan-proj",
          eventId: "evt-1",

          eventType: "lw.obs.trace.span_received",
          deduplicationKey: "trace-abc:span-123",
          eventTimestamp: 1739613600000,
        },
        dummyContext,
      );

      expect(mockClickHouseInsert).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        { projectId: "orphan-proj" },
        expect.stringContaining("orphan project detected"),
      );
    });
  });
});
