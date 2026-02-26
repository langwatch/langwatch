/**
 * Unit tests for the billing meter dispatch reactor.
 *
 * Mocks boundaries: Prisma (org resolution), BullMQ queue, and logger.
 *
 * @see specs/licensing/billing-meter-dispatch.feature "Billing Dispatch Reactor — Post-Fold Side Effect"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../../domain/tenantId";
import type { Event } from "../../../domain/types";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../../pipelines/trace-processing/schemas/constants";
import type { ReactorContext } from "../../../reactors/reactor.types";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockPrisma, mockLoggerWarn, createMockLogger } = vi.hoisted(() => {
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

  return { mockPrisma, mockLoggerWarn, createMockLogger };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("~/server/db", () => ({ prisma: mockPrisma }));

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(projectId: string): Event {
  return {
    id: `evt-${projectId}-${Date.now()}`,
    aggregateId: `trace-${projectId}`,
    aggregateType: "trace",
    tenantId: createTenantId(projectId),
    timestamp: Date.now(),
    occurredAt: Date.now(),
    version: "2026-02-17",
    type: SPAN_RECEIVED_EVENT_TYPE,
    data: {},
  };
}

function makeContext(projectId: string): ReactorContext {
  return {
    tenantId: projectId,
    aggregateId: `trace-${projectId}`,
    foldState: { count: 1 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("billingMeterDispatchReactor", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("given billable event", () => {
    it("resolves org and enqueues job with dedup jobId", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockQueueAdd = vi.fn().mockResolvedValue({});
      const mockQueue = { add: mockQueueAdd };

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getUsageReportingQueue: async () => mockQueue as any,
      });

      const event = makeEvent("proj-1");
      await reactor.handle(event, makeContext("proj-1"));

      expect(mockPrisma.project.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "proj-1" },
        }),
      );

      expect(mockQueueAdd).toHaveBeenCalledWith(
        "usage_reporting",
        { organizationId: "org-1" },
        expect.objectContaining({
          jobId: "usage_report_org-1",
          delay: expect.any(Number),
        }),
      );
    });
  });

  describe("given projectId with cached org", () => {
    it("enqueues without DB query on subsequent calls", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockQueueAdd = vi.fn().mockResolvedValue({});

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getUsageReportingQueue: async () => ({ add: mockQueueAdd }) as any,
      });

      // First call: populates cache
      await reactor.handle(makeEvent("proj-1"), makeContext("proj-1"));

      // Reset mock call counts after cache warm-up
      mockPrisma.project.findUnique.mockClear();
      mockQueueAdd.mockClear();

      // Second call: uses cache
      await reactor.handle(makeEvent("proj-1"), makeContext("proj-1"));

      expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
      expect(mockQueueAdd).toHaveBeenCalledWith(
        "usage_reporting",
        { organizationId: "org-1" },
        expect.objectContaining({ jobId: "usage_report_org-1" }),
      );
    });
  });

  describe("given duplicate org events", () => {
    it("uses BullMQ dedup via jobId", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockQueueAdd = vi.fn().mockResolvedValue({});

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getUsageReportingQueue: async () => ({ add: mockQueueAdd }) as any,
      });

      // Two events for projects belonging to the same org
      await reactor.handle(makeEvent("proj-1"), makeContext("proj-1"));
      await reactor.handle(makeEvent("proj-2"), makeContext("proj-2"));

      // Both calls use the same jobId, so BullMQ deduplicates
      const jobIds = mockQueueAdd.mock.calls.map(
        (call: unknown[]) => (call[2] as { jobId: string }).jobId,
      );
      expect(jobIds.every((id: string) => id === "usage_report_org-1")).toBe(
        true,
      );
    });
  });

  describe("given orphan project", () => {
    it("skips enqueue and logs warning", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: null,
      });

      const mockQueueAdd = vi.fn();

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getUsageReportingQueue: async () => ({ add: mockQueueAdd }) as any,
      });

      await reactor.handle(makeEvent("orphan-proj"), makeContext("orphan-proj"));

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        { projectId: "orphan-proj" },
        expect.stringContaining("orphan project detected"),
      );
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  describe("given null queue (no Redis)", () => {
    it("silently skips", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getUsageReportingQueue: async () => null,
      });

      // No error thrown
      await expect(
        reactor.handle(makeEvent("proj-1"), makeContext("proj-1")),
      ).resolves.not.toThrow();
    });
  });

  describe("given queue.add() throws", () => {
    it("catches error and logs warning without propagating", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockQueueAdd = vi.fn().mockRejectedValue(new Error("Redis down"));

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getUsageReportingQueue: async () => ({ add: mockQueueAdd }) as any,
      });

      await expect(
        reactor.handle(makeEvent("proj-1"), makeContext("proj-1")),
      ).resolves.not.toThrow();

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
        expect.stringContaining("failed to enqueue"),
      );
    });
  });

  describe("given lazy getter", () => {
    it("resolves queue at call time, not construction time", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockQueueAdd = vi.fn().mockResolvedValue({});
      const getter = vi.fn().mockResolvedValue({ add: mockQueueAdd });

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getUsageReportingQueue: getter,
      });

      // Queue getter not called at construction
      expect(getter).not.toHaveBeenCalled();

      await reactor.handle(makeEvent("proj-1"), makeContext("proj-1"));

      // Queue getter called at handle time
      expect(getter).toHaveBeenCalledTimes(1);
    });
  });

  describe("options", () => {
    it("configures runIn, makeJobId, and ttl", async () => {
      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );

      const reactor = createBillingMeterDispatchReactor({
        getUsageReportingQueue: async () => null,
      });

      expect(reactor.options?.runIn).toEqual(["worker"]);
      expect(reactor.options?.ttl).toBe(10_000);

      const payload = { event: makeEvent("proj-1"), foldState: {} };
      expect(reactor.options?.makeJobId?.(payload)).toBe(
        "billing_dispatch_proj-1",
      );
    });
  });
});
