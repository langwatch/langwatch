/**
 * Unit tests for the billing meter dispatch reactor.
 *
 * Mocks boundaries: Prisma (org resolution), command dispatch, and logger.
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
    it("resolves org and dispatches command for current month", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockDispatch = vi.fn().mockResolvedValue(undefined);

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getDispatch: () => mockDispatch,
      });

      // Use a date in the middle of the month (past grace period)
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 1, 15, 12, 0, 0))); // Feb 15, 2026

      try {
        const event = makeEvent("proj-1");
        await reactor.handle(event, makeContext("proj-1"));

        expect(mockPrisma.project.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: "proj-1" },
          }),
        );

        // Only current month dispatched (not in grace period)
        expect(mockDispatch).toHaveBeenCalledTimes(1);
        expect(mockDispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-1",
            billingMonth: "2026-02",
            tenantId: "org-1",
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("given projectId with cached org", () => {
    it("dispatches without DB query on subsequent calls", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockDispatch = vi.fn().mockResolvedValue(undefined);

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getDispatch: () => mockDispatch,
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 1, 15, 12, 0, 0)));

      try {
        // First call: populates cache
        await reactor.handle(makeEvent("proj-1"), makeContext("proj-1"));

        // Reset mock call counts after cache warm-up
        mockPrisma.project.findUnique.mockClear();
        mockDispatch.mockClear();

        // Second call: uses cache
        await reactor.handle(makeEvent("proj-1"), makeContext("proj-1"));

        expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
        expect(mockDispatch).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: "org-1" }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("given orphan project", () => {
    it("skips dispatch and logs warning", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: null,
      });

      const mockDispatch = vi.fn();

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getDispatch: () => mockDispatch,
      });

      await reactor.handle(makeEvent("orphan-proj"), makeContext("orphan-proj"));

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        { projectId: "orphan-proj" },
        expect.stringContaining("orphan project detected"),
      );
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given dispatch throws", () => {
    it("catches error and logs warning without propagating", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockDispatch = vi.fn().mockRejectedValue(new Error("command dispatch failed"));

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getDispatch: () => mockDispatch,
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 1, 15, 12, 0, 0)));

      try {
        await expect(
          reactor.handle(makeEvent("proj-1"), makeContext("proj-1")),
        ).resolves.not.toThrow();

        expect(mockLoggerWarn).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: "org-1" }),
          expect.stringContaining("failed to dispatch"),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("given first day of month (within grace period)", () => {
    it("dispatches for both previous and current month", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockDispatch = vi.fn().mockResolvedValue(undefined);

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getDispatch: () => mockDispatch,
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 2, 1, 12, 0, 0))); // March 1, 2026

      try {
        await reactor.handle(makeEvent("proj-1"), makeContext("proj-1"));

        // Dispatched for both months
        expect(mockDispatch).toHaveBeenCalledTimes(2);

        // Previous month first
        expect(mockDispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-1",
            billingMonth: "2026-02",
          }),
        );

        // Then current month
        expect(mockDispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-1",
            billingMonth: "2026-03",
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("given third day of month (within grace period)", () => {
    it("dispatches for both previous and current month", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockDispatch = vi.fn().mockResolvedValue(undefined);

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getDispatch: () => mockDispatch,
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 2, 3, 12, 0, 0))); // March 3, 2026

      try {
        await reactor.handle(makeEvent("proj-1"), makeContext("proj-1"));
        expect(mockDispatch).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("given fourth day of month (past grace period)", () => {
    it("dispatches only for current month", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const mockDispatch = vi.fn().mockResolvedValue(undefined);

      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );
      const { clearOrgCache } = await import(
        "~/server/organizations/resolveOrganizationId"
      );
      clearOrgCache();

      const reactor = createBillingMeterDispatchReactor({
        getDispatch: () => mockDispatch,
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 2, 4, 12, 0, 0))); // March 4, 2026

      try {
        await reactor.handle(makeEvent("proj-1"), makeContext("proj-1"));
        expect(mockDispatch).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("options", () => {
    it("configures runIn, makeJobId, and ttl", async () => {
      const { createBillingMeterDispatchReactor } = await import(
        "../billingMeterDispatch.reactor"
      );

      const reactor = createBillingMeterDispatchReactor({
        getDispatch: () => vi.fn(),
      });

      expect(reactor.options?.runIn).toEqual(["worker"]);
      expect(reactor.options?.ttl).toBe(300_000);

      const payload = { event: makeEvent("proj-1"), foldState: {} };
      expect(reactor.options?.makeJobId?.(payload)).toBe(
        "billing_dispatch_proj-1",
      );
    });
  });
});
