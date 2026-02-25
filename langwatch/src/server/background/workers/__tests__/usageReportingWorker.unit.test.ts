/**
 * Unit tests for the usage reporting worker.
 *
 * Mocks boundaries: Prisma, ClickHouse, Stripe UsageReportingService,
 * BullMQ queue, env.IS_SAAS, metrics, and error capture.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { UsageReportingJob } from "~/server/background/types";

// ---------------------------------------------------------------------------
// Hoisted mocks (available when vi.mock factories execute)
// ---------------------------------------------------------------------------

const {
  mockPrisma,
  mockReportUsageDelta,
  mockQueueAdd,
  mockCaptureException,
  mockIsSaas,
  mockClickHouseQuery,
  mockGetClickHouseClient,
  createMockLogger,
} = vi.hoisted(() => {
  const mockReportUsageDelta = vi.fn();
  const mockQueueAdd = vi.fn();
  const mockCaptureException = vi.fn();
  const mockIsSaas = { value: true };
  const mockClickHouseQuery = vi.fn();
  const mockGetClickHouseClient = vi.fn();

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
    mockQueueAdd,
    mockCaptureException,
    mockIsSaas,
    mockClickHouseQuery,
    mockGetClickHouseClient,
    createMockLogger,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("~/env.mjs", () => ({
  env: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "IS_SAAS") return mockIsSaas.value;
        return undefined;
      },
    },
  ),
}));

vi.mock("~/server/db", () => ({ prisma: mockPrisma }));

vi.mock("~/server/clickhouse/client", () => ({
  getClickHouseClient: mockGetClickHouseClient,
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: mockCaptureException,
  withScope: vi.fn((cb: (scope: Record<string, unknown>) => void) => {
    cb({ setTag: vi.fn(), setExtra: vi.fn() });
  }),
}));

vi.mock("~/server/metrics", () => ({
  recordJobWaitDuration: vi.fn(),
  getJobProcessingCounter: vi.fn(() => ({ inc: vi.fn() })),
  getJobProcessingDurationHistogram: vi.fn(() => ({ observe: vi.fn() })),
}));

vi.mock("~/server/redis", () => ({
  connection: { host: "localhost", port: 6379 },
}));

vi.mock("../../../../../ee/billing/index", () => ({
  getUsageReportingService: () => ({
    reportUsageDelta: mockReportUsageDelta,
  }),
}));

vi.mock("~/server/background/queues/usageReportingQueue", () => ({
  usageReportingQueue: { add: mockQueueAdd },
}));

vi.mock("~/server/context/asyncContext", () => ({
  withJobContext: vi.fn((fn: unknown) => fn),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(
  organizationId: string,
): Job<UsageReportingJob, void, string> {
  return {
    id: `test-job-${organizationId}`,
    data: { organizationId },
    timestamp: Date.now(),
  } as unknown as Job<UsageReportingJob, void, string>;
}

function makeOrg({
  id = "org-1",
  stripeCustomerId = "cus_123",
  hasSubscription = true,
  pricingModel = "SEAT_EVENT",
}: {
  id?: string;
  stripeCustomerId?: string | null;
  hasSubscription?: boolean;
  pricingModel?: string;
} = {}) {
  return {
    id,
    stripeCustomerId,
    pricingModel,
    subscriptions: hasSubscription ? [{ id: "sub-1" }] : [],
  };
}

function mockClickHouseTotal(total: number) {
  mockGetClickHouseClient.mockReturnValue({
    query: mockClickHouseQuery,
  });
  mockClickHouseQuery.mockResolvedValue({
    json: vi.fn().mockResolvedValue([{ total: String(total) }]),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runUsageReportingJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSaas.value = true;
  });

  // ========================================================================
  // Skip conditions
  // ========================================================================

  describe("when not SaaS", () => {
    it("skips without querying the database", async () => {
      mockIsSaas.value = false;
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      expect(mockPrisma.organization.findFirst).not.toHaveBeenCalled();
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given org has no stripeCustomerId", () => {
    it("skips reporting", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(
        makeOrg({ stripeCustomerId: null }),
      );
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given org has no active subscription", () => {
    it("skips reporting", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(
        makeOrg({ hasSubscription: false }),
      );
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given org not on SEAT_EVENT pricing", () => {
    it("skips reporting", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(
        makeOrg({ pricingModel: "TIERED" }),
      );
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given ClickHouse not available", () => {
    it("skips usage reporting", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockGetClickHouseClient.mockReturnValue(null);
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue(null);
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given delta is zero", () => {
    it("skips reporting", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
      });
      mockClickHouseTotal(100);
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Happy path
  // ========================================================================

  describe("given org with billable events and active subscription", () => {
    it("reports delta and updates checkpoint", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
      });
      mockClickHouseTotal(150);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

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

      // Phase 2: confirms checkpoint
      expect(mockPrisma.billingMeterCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { lastReportedTotal: 150, pendingReportedTotal: null },
        }),
      );
    });
  });

  describe("given first run for new org (no checkpoint)", () => {
    it("creates checkpoint at reported total", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue(null);
      mockClickHouseTotal(50);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

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
          }),
          update: { lastReportedTotal: 50, pendingReportedTotal: null },
        }),
      );
    });
  });

  // ========================================================================
  // ClickHouse query
  // ========================================================================

  describe("given ClickHouse returns deduped count", () => {
    it("queries by organizationId and date range", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue(null);
      mockClickHouseTotal(75);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      expect(mockClickHouseQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("countDistinct(DeduplicationKeyHash)"),
          query_params: expect.objectContaining({
            organizationId: "org-1",
          }),
          format: "JSONEachRow",
        }),
      );
    });
  });

  // ========================================================================
  // Self-re-trigger
  // ========================================================================

  describe("given delta > 0", () => {
    it("self-re-triggers with delayed job", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
      });
      mockClickHouseTotal(10);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      mockQueueAdd.mockResolvedValue({});
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      expect(mockQueueAdd).toHaveBeenCalledWith(
        expect.any(String),
        { organizationId: "org-1" },
        expect.objectContaining({
          jobId: "usage_report_org-1",
          delay: 5 * 60 * 1000,
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
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      // Does NOT query ClickHouse; uses pending value directly
      expect(mockClickHouseQuery).not.toHaveBeenCalled();

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

  describe("given successful report", () => {
    it("clears pending and updates lastReportedTotal", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: 200,
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      // Phase 2 upsert: promote lastReportedTotal, clear pending
      expect(mockPrisma.billingMeterCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { lastReportedTotal: 200, pendingReportedTotal: null },
        }),
      );
    });
  });

  // ========================================================================
  // Error handling
  // ========================================================================

  describe("given permanent Stripe rejection", () => {
    it("clears pending checkpoint without advancing lastReportedTotal and captures error", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
      });
      mockClickHouseTotal(150);
      mockReportUsageDelta.mockResolvedValue([
        { reported: false, error: "meter_event_invalid" },
      ]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      mockPrisma.billingMeterCheckpoint.update.mockResolvedValue({});
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      // Phase 1 writes pending intent (1 upsert only)
      expect(mockPrisma.billingMeterCheckpoint.upsert).toHaveBeenCalledTimes(
        1,
      );
      // Phase 2 never happens (no lastReportedTotal update)
      expect(mockPrisma.billingMeterCheckpoint.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ lastReportedTotal: 150 }),
        }),
      );

      // pendingReportedTotal is cleared to prevent infinite replay
      expect(mockPrisma.billingMeterCheckpoint.update).toHaveBeenCalledWith({
        where: {
          organizationId_billingMonth: {
            organizationId: "org-1",
            billingMonth: expect.stringMatching(/^\d{4}-\d{2}$/),
          },
        },
        data: {
          pendingReportedTotal: null,
        },
      });

      // Error is captured
      expect(mockCaptureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Stripe rejected meter event"),
        }),
      );
    });
  });

  describe("when service throws retryable error", () => {
    it("re-throws for BullMQ retry", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
      });
      mockClickHouseTotal(10);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      const transientError = new Error("Stripe rate limit");
      mockReportUsageDelta.mockRejectedValue(transientError);
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await expect(
        runUsageReportingJob(makeJob("org-1")),
      ).rejects.toThrow("Stripe rate limit");
    });
  });

  // ========================================================================
  // Month-boundary grace period
  // ========================================================================

  describe("given first day of month", () => {
    it("reports both previous and current month", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      // Return null checkpoint for all months
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue(null);
      mockClickHouseTotal(25);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});

      const { runUsageReportingJob, getBillingMonth, getPreviousBillingMonth } =
        await import("../usageReportingWorker");

      // Mock Date to be first day of month
      const firstDayOfMonth = new Date(Date.UTC(2026, 2, 1, 12, 0, 0)); // March 1, 2026
      vi.useFakeTimers();
      vi.setSystemTime(firstDayOfMonth);

      try {
        await runUsageReportingJob(makeJob("org-1"));

        // Should have queried ClickHouse twice (once per month)
        expect(mockClickHouseQuery).toHaveBeenCalledTimes(2);

        // Should have reported for both months
        expect(mockReportUsageDelta).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("given third day of month (within grace period)", () => {
    it("reports both previous and current month", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue(null);
      mockClickHouseTotal(25);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});

      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      // Mock Date to be third day of month (within 3-day grace period)
      const thirdDayOfMonth = new Date(Date.UTC(2026, 2, 3, 12, 0, 0)); // March 3, 2026
      vi.useFakeTimers();
      vi.setSystemTime(thirdDayOfMonth);

      try {
        await runUsageReportingJob(makeJob("org-1"));

        // Should have queried ClickHouse twice (once per month)
        expect(mockClickHouseQuery).toHaveBeenCalledTimes(2);

        // Should have reported for both months
        expect(mockReportUsageDelta).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("given fourth day of month (past grace period)", () => {
    it("reports only current month", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue(null);
      mockClickHouseTotal(25);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});

      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      // Mock Date to be fourth day of month (past 3-day grace period)
      const fourthDayOfMonth = new Date(Date.UTC(2026, 2, 4, 12, 0, 0)); // March 4, 2026
      vi.useFakeTimers();
      vi.setSystemTime(fourthDayOfMonth);

      try {
        await runUsageReportingJob(makeJob("org-1"));

        // Should have queried ClickHouse once (current month only)
        expect(mockClickHouseQuery).toHaveBeenCalledTimes(1);

        // Should have reported once
        expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

describe("billingMonthDateRange", () => {
  it("converts billing month to date range", async () => {
    const { billingMonthDateRange } = await import(
      "../usageReportingWorker"
    );

    expect(billingMonthDateRange("2026-02")).toEqual([
      "2026-02-01 00:00:00.000",
      "2026-03-01 00:00:00.000",
    ]);
    expect(billingMonthDateRange("2026-12")).toEqual([
      "2026-12-01 00:00:00.000",
      "2027-01-01 00:00:00.000",
    ]);
  });
});

describe("getPreviousBillingMonth", () => {
  it("returns previous month", async () => {
    const { getPreviousBillingMonth } = await import(
      "../usageReportingWorker"
    );

    expect(getPreviousBillingMonth(new Date(Date.UTC(2026, 2, 1)))).toBe(
      "2026-02",
    );
    expect(getPreviousBillingMonth(new Date(Date.UTC(2026, 0, 15)))).toBe(
      "2025-12",
    );
  });
});
