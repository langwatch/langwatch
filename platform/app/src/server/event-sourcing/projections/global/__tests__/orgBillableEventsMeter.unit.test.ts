/**
 * Unit tests for the billable events meter projection and store.
 *
 * Mocks boundaries: the App's billing repository, Prisma (org lookup), logger.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../../domain/types";
import type { ProjectionStoreContext } from "../../projectionStoreContext";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockInsert, mockGetApp, mockPrisma, mockLoggerWarn, createMockLogger } =
  vi.hoisted(() => {
    const mockInsert = vi.fn();
    const mockGetApp = vi.fn();
    const mockLoggerWarn = vi.fn();

    const createMockLogger = () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: mockLoggerWarn,
      error: vi.fn(),
      child: vi.fn(() => createMockLogger()),
    });

    const mockPrisma = {
      project: { findUnique: vi.fn() },
    };

    return {
      mockInsert,
      mockGetApp,
      mockPrisma,
      mockLoggerWarn,
      createMockLogger,
    };
  });

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// The store takes the billable-events repository from the App, so standing
// in for the store means standing in for `getApp()`.
vi.mock("~/server/app-layer/app", () => ({
  getApp: mockGetApp,
  // Reached through the TtlCache these paths read; null keeps it in-memory.
  tryGetApp: () => null,
}));

vi.mock("~/server/db", () => ({ prisma: mockPrisma }));

vi.mock("@langwatch/observability", () => ({
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

      const result = extractDeduplicationKey(makeEvent({ id: "evt-42" }));

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
          type: "lw.evaluation.reported",
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "idem-key-abc",
          eventType: "lw.evaluation.reported",
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
    it("resolves organizationId and inserts via the App's billing repository", async () => {
      mockInsert.mockResolvedValue(undefined);
      mockGetApp.mockReturnValue({
        billing: { events: { insert: mockInsert } },
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const { orgBillableEventsMeterStore } = await import(
        "../orgBillableEventsMeter.store"
      );

      const record = {
        organizationId: "",
        tenantId: "proj-1",
        eventId: "evt-1",
        eventType: "lw.obs.trace.span_received",
        deduplicationKey: "trace-abc:span-123",
        eventTimestamp: 1739613600000,
      };

      await orgBillableEventsMeterStore.append(record, dummyContext);

      expect(mockInsert).toHaveBeenCalledWith({
        record,
        organizationId: "org-1",
      });
    });
  });

  describe("given the App's repository rejects (ClickHouse insert fails)", () => {
    it("throws so the queue retries", async () => {
      const insertError = new Error("ClickHouse connection timeout");
      mockInsert.mockRejectedValue(insertError);
      mockGetApp.mockReturnValue({
        billing: { events: { insert: mockInsert } },
      });
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
    it("skips gracefully with warn log, without reaching the App", async () => {
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

      expect(mockGetApp).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        { projectId: "orphan-proj" },
        expect.stringContaining("orphan project detected"),
      );
    });
  });
});
