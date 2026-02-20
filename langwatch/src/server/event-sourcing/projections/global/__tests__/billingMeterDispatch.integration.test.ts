/**
 * Integration tests for the billing meter dispatch store.
 *
 * Mocks boundaries: Prisma (project lookup), BullMQ queue, and logger.
 *
 * @see specs/licensing/billing-meter-dispatch.feature "Billing Dispatch Handler - Event to Queue"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockPrisma, mockQueueAdd, mockLoggerWarn, createMockLogger } =
  vi.hoisted(() => {
    const mockQueueAdd = vi.fn();
    const mockLoggerWarn = vi.fn();

    const createMockLogger = () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: mockLoggerWarn,
      error: vi.fn(),
      child: vi.fn(() => createMockLogger()),
    });

    const mockPrisma = {
      project: {
        findUnique: vi.fn(),
      },
    };

    return { mockPrisma, mockQueueAdd, mockLoggerWarn, createMockLogger };
  });

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("~/server/db", () => ({ prisma: mockPrisma }));

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

vi.mock("~/server/background/queues/usageReportingQueue", () => ({
  usageReportingQueue: { add: mockQueueAdd },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dummyContext = {
  aggregateId: "test-aggregate",
  tenantId: "test-tenant",
} as ProjectionStoreContext;

function makeRecord(tenantId: string) {
  return { tenantId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("billingMeterDispatchStore", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("given projectId without cache", () => {
    it("queries DB, caches, and enqueues", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });
      mockQueueAdd.mockResolvedValue({});

      const { billingMeterDispatchStore, clearOrgCache } = await import(
        "../billingMeterDispatch.store"
      );
      clearOrgCache();

      await billingMeterDispatchStore.append(
        makeRecord("proj-1"),
        dummyContext,
      );

      // Queried DB for project -> org mapping
      expect(mockPrisma.project.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "proj-1" },
        }),
      );

      // Enqueued a job for the organization
      expect(mockQueueAdd).toHaveBeenCalledWith(
        "usage_reporting",
        { organizationId: "org-1" },
        expect.objectContaining({
          jobId: "usage_report:org-1",
          delay: expect.any(Number),
        }),
      );
    });
  });

  describe("given projectId with cached org", () => {
    it("enqueues without DB query", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });
      mockQueueAdd.mockResolvedValue({});

      const { billingMeterDispatchStore, clearOrgCache } = await import(
        "../billingMeterDispatch.store"
      );
      clearOrgCache();

      // First call: populates cache
      await billingMeterDispatchStore.append(
        makeRecord("proj-1"),
        dummyContext,
      );

      // Reset mock call counts after cache warm-up
      mockPrisma.project.findUnique.mockClear();
      mockQueueAdd.mockClear();

      // Second call: should use cache
      await billingMeterDispatchStore.append(
        makeRecord("proj-1"),
        dummyContext,
      );

      expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
      expect(mockQueueAdd).toHaveBeenCalledWith(
        "usage_reporting",
        { organizationId: "org-1" },
        expect.objectContaining({ jobId: "usage_report:org-1" }),
      );
    });
  });

  describe("given orphan project", () => {
    it("logs warning and skips enqueue", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: null,
      });

      const { billingMeterDispatchStore, clearOrgCache } = await import(
        "../billingMeterDispatch.store"
      );
      clearOrgCache();

      await billingMeterDispatchStore.append(
        makeRecord("orphan-proj"),
        dummyContext,
      );

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        { projectId: "orphan-proj" },
        expect.stringContaining("orphan project detected"),
      );
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  describe("given null queue (no Redis)", () => {
    it("silently skips", async () => {
      // Override the queue mock to return null for this test
      vi.doMock("~/server/background/queues/usageReportingQueue", () => ({
        usageReportingQueue: null,
      }));

      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      // Re-import to pick up the null queue (resetModules in beforeEach ensures fresh load)
      const { billingMeterDispatchStore, clearOrgCache } = await import(
        "../billingMeterDispatch.store"
      );
      clearOrgCache();

      await billingMeterDispatchStore.append(
        makeRecord("proj-1"),
        dummyContext,
      );

      // No error thrown, no queue add called
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  describe("given duplicate org events", () => {
    it("uses BullMQ dedup via jobId", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });
      mockQueueAdd.mockResolvedValue({});

      const { billingMeterDispatchStore, clearOrgCache } = await import(
        "../billingMeterDispatch.store"
      );
      clearOrgCache();

      // Dispatch two events for projects belonging to the same org
      await billingMeterDispatchStore.append(
        makeRecord("proj-1"),
        dummyContext,
      );
      await billingMeterDispatchStore.append(
        makeRecord("proj-2"),
        dummyContext,
      );

      // Both calls use the same jobId, so BullMQ deduplicates
      const jobIds = mockQueueAdd.mock.calls.map(
        (call: unknown[]) => (call[2] as { jobId: string }).jobId,
      );
      expect(jobIds.every((id: string) => id === "usage_report:org-1")).toBe(
        true,
      );
    });
  });
});
