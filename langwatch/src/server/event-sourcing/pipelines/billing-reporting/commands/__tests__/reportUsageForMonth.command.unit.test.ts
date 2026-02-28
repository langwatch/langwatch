/**
 * Unit tests for the reportUsageForMonth command handler.
 *
 * Mocks boundaries: Prisma, ClickHouse (queryBillableEventsTotal),
 * Stripe (UsageReportingService), selfDispatch, and error capture.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../../../../";
import { createTenantId } from "../../../../domain/tenantId";
import type { ReportUsageForMonthCommandData } from "../../schemas/commands";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockPrisma,
  mockReportUsageDelta,
  mockSelfDispatch,
  mockCaptureException,
  mockQueryBillableEventsTotal,
  createMockLogger,
} = vi.hoisted(() => {
  const mockReportUsageDelta = vi.fn();
  const mockSelfDispatch = vi.fn();
  const mockCaptureException = vi.fn();
  const mockQueryBillableEventsTotal = vi.fn();

  const createMockLogger = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  });

  const mockPrisma = {
    organization: { findFirst: vi.fn() },
    billingMeterCheckpoint: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    mockPrisma,
    mockReportUsageDelta,
    mockSelfDispatch,
    mockCaptureException,
    mockQueryBillableEventsTotal,
    createMockLogger,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: mockCaptureException,
  withScope: vi.fn((cb: (scope: Record<string, unknown>) => void) => {
    cb({ setTag: vi.fn(), setExtra: vi.fn() });
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommand(
  organizationId = "org-1",
  billingMonth = "2026-02",
): Command<ReportUsageForMonthCommandData> {
  return {
    tenantId: createTenantId(organizationId),
    aggregateId: organizationId,
    type: "lw.billing_report.report_usage_for_month" as any,
    data: {
      organizationId,
      billingMonth,
      tenantId: organizationId,
      occurredAt: Date.now(),
    },
  };
}

function makeOrg({
  id = "org-1",
  stripeCustomerId = "cus_123",
  hasSubscription = true,
}: {
  id?: string;
  stripeCustomerId?: string | null;
  hasSubscription?: boolean;
} = {}) {
  return {
    id,
    stripeCustomerId,
    subscriptions: hasSubscription ? [{ id: "sub-1" }] : [],
  };
}

async function createHandler() {
  const { createReportUsageForMonthCommandClass } = await import(
    "../reportUsageForMonth.command"
  );

  const CommandClass = createReportUsageForMonthCommandClass({
    prisma: mockPrisma as any,
    getUsageReportingService: () => ({
      reportUsageDelta: mockReportUsageDelta,
      reportUsageSet: vi.fn(),
      getUsageSummary: vi.fn(),
    }),
    queryBillableEventsTotal: mockQueryBillableEventsTotal,
    selfDispatch: mockSelfDispatch,
  });

  return new CommandClass();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReportUsageForMonthCommand", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearOrgCache } = await import(
      "../reportUsageForMonth.command"
    );
    clearOrgCache();
  });

  // ========================================================================
  // Skip conditions
  // ========================================================================

  describe("given org not found", () => {
    it("returns empty events without reporting", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given org has no stripeCustomerId", () => {
    it("returns empty events without reporting", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(
        makeOrg({ stripeCustomerId: null }),
      );
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given org has no active subscription", () => {
    it("returns empty events without reporting", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(
        makeOrg({ hasSubscription: false }),
      );
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given ClickHouse not available", () => {
    it("returns empty events without reporting", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockResolvedValue(null);
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given delta is zero", () => {
    it("returns empty events without reporting", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(100);
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Happy path
  // ========================================================================

  describe("given org with billable events and active subscription", () => {
    it("reports delta, updates checkpoint, and self-dispatches", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(150);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);

      // Reports delta of 50
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeCustomerId: "cus_123",
          events: expect.arrayContaining([
            expect.objectContaining({ value: 50 }),
          ]),
        }),
      );

      // Phase 1: writes pending intent
      expect(mockPrisma.billingMeterCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { pendingReportedTotal: 150 },
        }),
      );

      // Phase 2: confirms checkpoint with consecutiveFailures reset
      expect(mockPrisma.billingMeterCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            lastReportedTotal: 150,
            pendingReportedTotal: null,
            consecutiveFailures: 0,
          },
        }),
      );

      // Self-dispatch fires
      expect(mockSelfDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
      );
    });
  });

  describe("given first run for new org (no checkpoint)", () => {
    it("creates checkpoint at reported total", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockResolvedValue(50);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      // Reports full 50 (lastReportedTotal defaults to 0)
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({ value: 50 }),
          ]),
        }),
      );

      // Phase 2: creates checkpoint at 50
      expect(mockPrisma.billingMeterCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            lastReportedTotal: 50,
            pendingReportedTotal: null,
            consecutiveFailures: 0,
          }),
          update: {
            lastReportedTotal: 50,
            pendingReportedTotal: null,
            consecutiveFailures: 0,
          },
        }),
      );
    });
  });

  // ========================================================================
  // Crash recovery (two-phase checkpoint)
  // ========================================================================

  describe("given pending checkpoint (crash recovery)", () => {
    it("uses pending value with same idempotency key", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: 200,
        consecutiveFailures: 0,
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      // Does NOT query ClickHouse; uses pending value directly
      expect(mockQueryBillableEventsTotal).not.toHaveBeenCalled();

      // Reports delta of 100 (200 - 100)
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({
              value: 100,
              identifier: expect.stringContaining("from:100:to:200"),
            }),
          ]),
        }),
      );
    });
  });

  // ========================================================================
  // Error handling — never throws
  // ========================================================================

  describe("given permanent Stripe rejection", () => {
    it("clears pending, increments failures, does NOT self-dispatch", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(150);
      mockReportUsageDelta.mockResolvedValue([
        { reported: false, error: "meter_event_invalid" },
      ]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      mockPrisma.billingMeterCheckpoint.update.mockResolvedValue({});
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      // Never throws — returns empty events
      expect(result).toEqual([]);

      // No self-dispatch on permanent rejection
      expect(mockSelfDispatch).not.toHaveBeenCalled();

      // pendingReportedTotal cleared, consecutiveFailures incremented
      expect(mockPrisma.billingMeterCheckpoint.update).toHaveBeenCalledWith({
        where: {
          organizationId_billingMonth: {
            organizationId: "org-1",
            billingMonth: "2026-02",
          },
        },
        data: {
          pendingReportedTotal: null,
          consecutiveFailures: 1,
        },
      });

      // Error captured
      expect(mockCaptureException).toHaveBeenCalled();
    });
  });

  describe("given transient Stripe error", () => {
    it("catches error, increments failures, and self-dispatches for retry", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(10);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      mockReportUsageDelta.mockRejectedValue(new Error("Stripe rate limit"));
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      // Never throws — handler catches all errors
      const result = await handler.handle(makeCommand());
      expect(result).toEqual([]);

      // Self-dispatch fires for convergence loop
      expect(mockSelfDispatch).toHaveBeenCalled();

      // consecutiveFailures incremented
      expect(mockPrisma.billingMeterCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { consecutiveFailures: 1 },
        }),
      );
    });
  });

  describe("given unexpected error in skip conditions", () => {
    it("catches error and returns empty events", async () => {
      mockPrisma.organization.findFirst.mockRejectedValue(
        new Error("database offline"),
      );
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockCaptureException).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Circuit-breaker
  // ========================================================================

  describe("given 5 consecutive failures (circuit-breaker threshold)", () => {
    it("does NOT self-dispatch and logs alarm", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 5,
      });
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      // No ClickHouse query, no Stripe call, no self-dispatch
      expect(mockQueryBillableEventsTotal).not.toHaveBeenCalled();
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given circuit-breaker reset after successful report", () => {
    it("resets consecutiveFailures to 0 on success", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 3,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(200);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      // Phase 2 confirms with reset counter
      expect(mockPrisma.billingMeterCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            lastReportedTotal: 200,
            pendingReportedTotal: null,
            consecutiveFailures: 0,
          },
        }),
      );
    });
  });

  // ========================================================================
  // Static properties
  // ========================================================================

  describe("static properties", () => {
    it("exposes schema, getAggregateId, and getSpanAttributes", async () => {
      const { createReportUsageForMonthCommandClass } = await import(
        "../reportUsageForMonth.command"
      );

      const CommandClass = createReportUsageForMonthCommandClass({
        prisma: mockPrisma as any,
        getUsageReportingService: () => ({
          reportUsageDelta: vi.fn(),
          reportUsageSet: vi.fn(),
          getUsageSummary: vi.fn(),
        }),
        queryBillableEventsTotal: vi.fn(),
        selfDispatch: vi.fn(),
      });

      expect(CommandClass.schema.type).toBe(
        "lw.billing_report.report_usage_for_month",
      );

      const payload = {
        organizationId: "org-1",
        billingMonth: "2026-02",
        tenantId: "org-1",
        occurredAt: Date.now(),
      };

      expect(CommandClass.getAggregateId(payload)).toBe("org-1");
      expect(CommandClass.getSpanAttributes(payload)).toEqual({
        "payload.organizationId": "org-1",
        "payload.billingMonth": "2026-02",
      });
    });
  });
});
