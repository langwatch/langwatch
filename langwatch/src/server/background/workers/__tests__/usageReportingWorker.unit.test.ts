/**
 * Integration tests for the usage reporting worker.
 *
 * Mocks boundaries: Prisma, Stripe UsageReportingService, BullMQ queue,
 * env.IS_SAAS, metrics, and error capture.
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
  createMockLogger,
} = vi.hoisted(() => {
  const mockReportUsageDelta = vi.fn();
  const mockQueueAdd = vi.fn();
  const mockCaptureException = vi.fn();
  const mockIsSaas = { value: true };

  const createMockLogger = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  });

  const mockPrisma = {
    organization: { findUnique: vi.fn() },
    billingMeterCheckpoint: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    projectDailyBillableEvents: { aggregate: vi.fn() },
  };

  return {
    mockPrisma,
    mockReportUsageDelta,
    mockQueueAdd,
    mockCaptureException,
    mockIsSaas,
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
  projectIds = ["proj-1"],
  pricingModel = "SEAT_EVENT",
}: {
  id?: string;
  stripeCustomerId?: string | null;
  hasSubscription?: boolean;
  projectIds?: string[];
  pricingModel?: string;
} = {}) {
  return {
    id,
    stripeCustomerId,
    pricingModel,
    subscriptions: hasSubscription ? [{ id: "sub-1" }] : [],
    teams: [{ projects: projectIds.map((pid) => ({ id: pid })) }],
  };
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

      expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given org has no stripeCustomerId", () => {
    it("skips reporting", async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(
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
      mockPrisma.organization.findUnique.mockResolvedValue(
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
      mockPrisma.organization.findUnique.mockResolvedValue(
        makeOrg({ pricingModel: "TIERED" }),
      );
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given org has no projects", () => {
    it("skips reporting", async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(
        makeOrg({ projectIds: [] }),
      );
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given delta is zero", () => {
    it("skips reporting", async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
      });
      mockPrisma.projectDailyBillableEvents.aggregate.mockResolvedValue({
        _sum: { count: 100 },
      });
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
      mockPrisma.organization.findUnique.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
      });
      mockPrisma.projectDailyBillableEvents.aggregate.mockResolvedValue({
        _sum: { count: 150 },
      });
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
      mockPrisma.organization.findUnique.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue(null);
      mockPrisma.projectDailyBillableEvents.aggregate.mockResolvedValue({
        _sum: { count: 50 },
      });
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

  describe("given multiple projects", () => {
    it("aggregates across all projects", async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(
        makeOrg({ projectIds: ["proj-a", "proj-b", "proj-c"] }),
      );
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue(null);
      // Aggregate returns the sum of all projects
      mockPrisma.projectDailyBillableEvents.aggregate.mockResolvedValue({
        _sum: { count: 100 },
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockPrisma.billingMeterCheckpoint.upsert.mockResolvedValue({});
      const { runUsageReportingJob } = await import(
        "../usageReportingWorker"
      );

      await runUsageReportingJob(makeJob("org-1"));

      // Aggregate query includes all project IDs
      expect(
        mockPrisma.projectDailyBillableEvents.aggregate,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: { in: ["proj-a", "proj-b", "proj-c"] },
          }),
        }),
      );

      // Reports total 100
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({ value: 100 }),
          ]),
        }),
      );
    });
  });

  // ========================================================================
  // Self-re-trigger
  // ========================================================================

  describe("given delta > 0", () => {
    it("self-re-triggers with delayed job", async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
      });
      mockPrisma.projectDailyBillableEvents.aggregate.mockResolvedValue({
        _sum: { count: 10 },
      });
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
      mockPrisma.organization.findUnique.mockResolvedValue(makeOrg());
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

      // Does NOT re-aggregate from DB; uses pending value directly
      expect(
        mockPrisma.projectDailyBillableEvents.aggregate,
      ).not.toHaveBeenCalled();

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
      mockPrisma.organization.findUnique.mockResolvedValue(makeOrg());
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
      mockPrisma.organization.findUnique.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
      });
      mockPrisma.projectDailyBillableEvents.aggregate.mockResolvedValue({
        _sum: { count: 150 },
      });
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
      mockPrisma.organization.findUnique.mockResolvedValue(makeOrg());
      mockPrisma.billingMeterCheckpoint.findUnique.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
      });
      mockPrisma.projectDailyBillableEvents.aggregate.mockResolvedValue({
        _sum: { count: 10 },
      });
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
});
