/**
 * Unit tests for the reportStorageForHour command handler.
 *
 * Mocks boundaries: OrganizationService, StorageBillingCheckpointService,
 * StorageUsageHourlyRepository, Stripe (UsageReportingService), selfDispatch,
 * and error capture.
 *
 * @see specs/data-retention/storage-billing-hour-reporting.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../../../../";
import { createTenantId } from "../../../../domain/tenantId";
import type { ReportStorageForHourCommandData } from "../../schemas/commands";

const {
  mockOrganizations,
  mockStorageBillingCheckpoints,
  mockStorageUsageHourly,
  mockReportUsageDelta,
  mockSelfDispatch,
  mockCaptureException,
  createMockLogger,
} = vi.hoisted(() => {
  const mockReportUsageDelta = vi.fn();
  const mockSelfDispatch = vi.fn();
  const mockCaptureException = vi.fn();

  const createMockLogger = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  });

  return {
    mockOrganizations: { getOrganizationForBilling: vi.fn() },
    mockStorageBillingCheckpoints: {
      getCheckpoint: vi.fn(),
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    },
    mockStorageUsageHourly: { findHour: vi.fn(), markReported: vi.fn() },
    mockReportUsageDelta,
    mockSelfDispatch,
    mockCaptureException,
    createMockLogger,
  };
});

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

// Disable the org-level TtlCache so tests don't share cached org data.
vi.mock("~/server/utils/ttlCache", () => ({
  TtlCache: class {
    async get() {
      return undefined;
    }
    async set() {
      return;
    }
    async delete() {
      return;
    }
  },
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: mockCaptureException,
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
  withScope: vi.fn((cb: (scope: Record<string, unknown>) => void) => {
    cb({ setTag: vi.fn(), setExtra: vi.fn() });
  }),
}));

const SEALED_HOUR = "2026-02-15T12:00:00.000Z";
const EXPECTED_IDENTIFIER = "storage_mb:org-1:2026-02-15T12";
const EXPECTED_MONTH = "2026-02";

function makeCommand(
  organizationId = "org-1",
  sealedHour = SEALED_HOUR,
): Command<ReportStorageForHourCommandData> {
  return {
    tenantId: createTenantId(organizationId),
    aggregateId: organizationId,
    type: "lw.billing_report.report_storage_for_hour" as any,
    data: {
      organizationId,
      sealedHour,
      tenantId: organizationId,
      occurredAt: Date.now(),
    },
  };
}

function makeOrg({
  id = "org-1",
  stripeCustomerId = "cus_123" as string | null,
  hasSubscription = true,
} = {}) {
  return {
    id,
    stripeCustomerId,
    subscriptions: hasSubscription ? [{ id: "sub-1" }] : [],
  };
}

async function createHandler() {
  const { ReportStorageForHourCommand } = await import(
    "../reportStorageForHour.command"
  );
  return new ReportStorageForHourCommand({
    organizations: mockOrganizations as any,
    storageBillingCheckpoints: mockStorageBillingCheckpoints as any,
    storageUsageHourly: mockStorageUsageHourly as any,
    getUsageReportingService: () => ({
      reportUsageDelta: mockReportUsageDelta,
      reportUsageSet: vi.fn(),
      getUsageSummary: vi.fn(),
    }),
    selfDispatch: mockSelfDispatch,
  });
}

describe("ReportStorageForHourCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
    mockStorageBillingCheckpoints.getCheckpoint.mockResolvedValue(null);
  });

  describe("given an unreported measured hour", () => {
    /** @scenario An unreported hour is reported additively and marked reported */
    it("sends one additive meter event for the hour and stamps the cursor", async () => {
      mockStorageUsageHourly.findHour.mockResolvedValue({
        megabytes: 42,
        reportedAt: null,
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeCustomerId: "cus_123",
          events: [
            expect.objectContaining({
              eventName: "langwatch_storage_megabytes_hourly",
              identifier: EXPECTED_IDENTIFIER,
              value: 42,
              timestamp: Math.floor(new Date(SEALED_HOUR).getTime() / 1000),
            }),
          ],
        }),
      );
      expect(mockStorageUsageHourly.markReported).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          sealedHour: new Date(SEALED_HOUR),
        }),
      );
      // Success on a clean breaker: no checkpoint write, no self-dispatch.
      expect(
        mockStorageBillingCheckpoints.recordSuccess,
      ).not.toHaveBeenCalled();
      expect(
        mockStorageBillingCheckpoints.recordFailure,
      ).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });

    /** @scenario The reported value is the hour's integer megabytes */
    it("sends the raw integer megabytes with no conversion", async () => {
      mockStorageUsageHourly.findHour.mockResolvedValue({
        megabytes: 12345,
        reportedAt: null,
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      const sentValue = mockReportUsageDelta.mock.calls[0]![0].events[0].value;
      expect(sentValue).toBe(12345);
      expect(Number.isInteger(sentValue)).toBe(true);
    });

    /** @scenario The billing identifier is deterministic per organization and hour */
    it("builds a deterministic identifier from organization and hour", async () => {
      mockStorageUsageHourly.findHour.mockResolvedValue({
        megabytes: 1,
        reportedAt: null,
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);

      await (await createHandler()).handle(makeCommand());
      await (await createHandler()).handle(makeCommand());

      const ids = mockReportUsageDelta.mock.calls.map(
        ([arg]) => arg.events[0].identifier,
      );
      expect(ids).toEqual([EXPECTED_IDENTIFIER, EXPECTED_IDENTIFIER]);
    });
  });

  describe("given the hour is already reported", () => {
    /** @scenario An hour already marked reported is not reported again */
    it("sends nothing and leaves the cursor unchanged", async () => {
      mockStorageUsageHourly.findHour.mockResolvedValue({
        megabytes: 42,
        reportedAt: new Date("2026-02-15T13:00:00.000Z"),
      });
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockStorageUsageHourly.markReported).not.toHaveBeenCalled();
    });
  });

  describe("given a zero-megabyte hour", () => {
    /** @scenario A zero-megabyte hour is marked reported without a billing call */
    it("stamps the cursor without calling Stripe", async () => {
      mockStorageUsageHourly.findHour.mockResolvedValue({
        megabytes: 0,
        reportedAt: null,
      });
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockStorageUsageHourly.markReported).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the meter event already exists on Stripe", () => {
    /** @scenario A Stripe duplicate is treated as already reported */
    it("treats the duplicate as reported and stamps the cursor without a failure", async () => {
      mockStorageUsageHourly.findHour.mockResolvedValue({
        megabytes: 42,
        reportedAt: null,
      });
      // The usage service maps resource_already_exists to reported: true.
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockStorageUsageHourly.markReported).toHaveBeenCalledTimes(1);
      expect(
        mockStorageBillingCheckpoints.recordFailure,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when Stripe permanently rejects the event", () => {
    /** @scenario A permanent rejection does not mark the hour reported */
    it("leaves the hour unreported, increments failures, and does not self-dispatch", async () => {
      mockStorageUsageHourly.findHour.mockResolvedValue({
        megabytes: 42,
        reportedAt: null,
      });
      mockReportUsageDelta.mockResolvedValue([
        { reported: false, error: "invalid_request" },
      ]);
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockStorageUsageHourly.markReported).not.toHaveBeenCalled();
      expect(mockStorageBillingCheckpoints.recordFailure).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: EXPECTED_MONTH,
        consecutiveFailures: 1,
      });
      expect(mockSelfDispatch).not.toHaveBeenCalled();
      expect(mockCaptureException).toHaveBeenCalled();
    });
  });

  describe("when the report hits a transient error", () => {
    /** @scenario A transient error increases the failure count and retries */
    it("increments failures, self-dispatches a retry, and does not throw", async () => {
      mockStorageUsageHourly.findHour.mockResolvedValue({
        megabytes: 42,
        reportedAt: null,
      });
      mockReportUsageDelta.mockRejectedValue(new Error("rate limited"));
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockStorageBillingCheckpoints.recordFailure).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: EXPECTED_MONTH,
        consecutiveFailures: 1,
      });
      expect(mockStorageUsageHourly.markReported).not.toHaveBeenCalled();
      expect(mockSelfDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          sealedHour: SEALED_HOUR,
        }),
      );
    });
  });

  describe("given the breaker is at the failure threshold", () => {
    /** @scenario The breaker stops reporting after too many consecutive failures */
    it("does not read the hour, report, or self-dispatch", async () => {
      mockStorageBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
        consecutiveFailures: 5,
      });
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockStorageUsageHourly.findHour).not.toHaveBeenCalled();
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given prior failures below the threshold then a success", () => {
    /** @scenario A success below the breaker threshold clears the failure count */
    it("clears the failure count on success", async () => {
      mockStorageBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
        consecutiveFailures: 3,
      });
      mockStorageUsageHourly.findHour.mockResolvedValue({
        megabytes: 42,
        reportedAt: null,
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockStorageUsageHourly.markReported).toHaveBeenCalledTimes(1);
      expect(mockStorageBillingCheckpoints.recordSuccess).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: EXPECTED_MONTH,
      });
      expect(
        mockStorageBillingCheckpoints.recordFailure,
      ).not.toHaveBeenCalled();
    });
  });

  describe("given a single permanently-rejected hour then a healthy hour", () => {
    // Anti-starvation guard: one poison hour cannot trip the breaker. A permanent
    // rejection is one-shot (no self-dispatch), and nothing re-drives an
    // unreported hour — the dispatcher advances by max(measured hour), not by
    // reportedAt — so the failure count only ever reaches 1 from it, and the next
    // healthy hour clears it. The breaker only trips on *systemic* failure.
    it("bumps the breaker to one, then the next success clears it", async () => {
      // 1st hour: permanent rejection from a clean breaker → failures = 1.
      mockStorageBillingCheckpoints.getCheckpoint.mockResolvedValueOnce(null);
      mockStorageUsageHourly.findHour.mockResolvedValueOnce({
        megabytes: 42,
        reportedAt: null,
      });
      mockReportUsageDelta.mockResolvedValueOnce([
        { reported: false, error: "invalid_request" },
      ]);

      await (await createHandler()).handle(makeCommand("org-1", SEALED_HOUR));

      expect(mockStorageBillingCheckpoints.recordFailure).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: EXPECTED_MONTH,
        consecutiveFailures: 1,
      });

      // 2nd hour: healthy, breaker now at 1 → success clears it to 0.
      mockStorageBillingCheckpoints.getCheckpoint.mockResolvedValueOnce({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
        consecutiveFailures: 1,
      });
      mockStorageUsageHourly.findHour.mockResolvedValueOnce({
        megabytes: 7,
        reportedAt: null,
      });
      mockReportUsageDelta.mockResolvedValueOnce([{ reported: true }]);

      await (await createHandler()).handle(
        makeCommand("org-1", "2026-02-15T13:00:00.000Z"),
      );

      expect(mockStorageBillingCheckpoints.recordSuccess).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: EXPECTED_MONTH,
      });
    });
  });

  describe("given an organization that cannot be billed", () => {
    /** @scenario Reporting is skipped for an organization that cannot be billed */
    it("sends nothing when there is no Stripe customer", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        makeOrg({ stripeCustomerId: null }),
      );
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given no measured row for the requested hour", () => {
    /** @scenario Reporting is a no-op when no measured hour exists */
    it("sends nothing and stamps nothing", async () => {
      mockStorageUsageHourly.findHour.mockResolvedValue(null);
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockStorageUsageHourly.markReported).not.toHaveBeenCalled();
    });
  });

  describe("static metadata", () => {
    it("exposes the command type, aggregate id, and span attributes", async () => {
      const { ReportStorageForHourCommand } = await import(
        "../reportStorageForHour.command"
      );
      expect(ReportStorageForHourCommand.schema.type).toBe(
        "lw.billing_report.report_storage_for_hour",
      );
      expect(
        ReportStorageForHourCommand.getAggregateId(makeCommand().data),
      ).toBe("org-1");
      expect(
        ReportStorageForHourCommand.getSpanAttributes(makeCommand().data),
      ).toMatchObject({ "payload.organizationId": "org-1" });
    });
  });
});
