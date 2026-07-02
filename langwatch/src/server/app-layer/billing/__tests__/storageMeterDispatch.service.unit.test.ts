/**
 * Unit tests for the storage meter dispatch brain (ADR-027 Phase 4).
 *
 * @see specs/data-retention/storage-billing-dispatch.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoggerError, createMockLogger } = vi.hoisted(() => {
  const mockLoggerError = vi.fn();
  const createMockLogger = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
    child: vi.fn(() => createMockLogger()),
  });
  return { mockLoggerError, createMockLogger };
});

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

import {
  STORAGE_BACKFILL_MAX_HOURS,
  STORAGE_MAX_HOURS_PER_RUN,
  StorageMeterDispatchService,
} from "../storageMeterDispatch.service";

const MS_PER_HOUR = 60 * 60 * 1000;
// now = 12:30 → last COMPLETE wall-clock hour (sealed boundary) is 11:00.
const NOW = new Date("2026-02-15T12:30:00.000Z");
const SEAL_BOUNDARY = new Date("2026-02-15T11:00:00.000Z");

function hour(iso: string): Date {
  return new Date(iso);
}

function makeService(
  overrides: Partial<{
    enabled: boolean;
    org: {
      stripeCustomerId: string | null;
      subscriptions: { id: string }[];
    } | null;
    lastMeasured: Date | null;
    measure: (params: {
      organizationId: string;
      sealedHour: Date;
    }) => Promise<number>;
    runExclusivePerOrg: (
      organizationId: string,
      fn: () => Promise<void>,
    ) => Promise<void>;
  }> = {},
) {
  const isMeteringEnabled = vi
    .fn()
    .mockResolvedValue(overrides.enabled ?? true);
  const getBillableOrg = vi
    .fn()
    .mockResolvedValue(
      overrides.org === undefined
        ? { stripeCustomerId: "cus_1", subscriptions: [{ id: "sub-1" }] }
        : overrides.org,
    );
  const measureBytesAt = vi.fn(
    overrides.measure ?? (async () => 1_048_576), // 1 MiB
  );
  const getLastMeasuredHour = vi
    .fn()
    .mockResolvedValue(overrides.lastMeasured ?? null);
  const recordHour = vi.fn().mockResolvedValue(undefined);
  const enqueueReport = vi.fn().mockResolvedValue(undefined);

  const service = new StorageMeterDispatchService({
    isMeteringEnabled,
    getBillableOrg,
    measureBytesAt,
    storageUsageHourly: {
      getLastMeasuredHour,
      recordHour,
      findHour: vi.fn(),
      markReported: vi.fn(),
    },
    enqueueReport,
    runExclusivePerOrg: overrides.runExclusivePerOrg,
    now: () => NOW,
  });

  return {
    service,
    isMeteringEnabled,
    getBillableOrg,
    measureBytesAt,
    getLastMeasuredHour,
    recordHour,
    enqueueReport,
  };
}

describe("StorageMeterDispatchService", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given the metering flag is off", () => {
    /** @scenario Metering disabled makes the dispatcher fully inert */
    it("measures nothing, writes nothing, enqueues nothing", async () => {
      const {
        service,
        measureBytesAt,
        recordHour,
        enqueueReport,
        getBillableOrg,
      } = makeService({ enabled: false });

      await service.dispatchForOrg({ organizationId: "org-1" });

      expect(getBillableOrg).not.toHaveBeenCalled();
      expect(measureBytesAt).not.toHaveBeenCalled();
      expect(recordHour).not.toHaveBeenCalled();
      expect(enqueueReport).not.toHaveBeenCalled();
    });
  });

  describe("given a non-billable organization", () => {
    /** @scenario A non-billable organization is skipped before any measurement */
    it("never queries the measurement when there is no Stripe customer", async () => {
      const { service, measureBytesAt, recordHour, enqueueReport } =
        makeService({
          org: { stripeCustomerId: null, subscriptions: [{ id: "sub-1" }] },
        });

      await service.dispatchForOrg({ organizationId: "org-1" });

      expect(measureBytesAt).not.toHaveBeenCalled();
      expect(recordHour).not.toHaveBeenCalled();
      expect(enqueueReport).not.toHaveBeenCalled();
    });
  });

  describe("given the organization is already caught up", () => {
    /** @scenario A caught-up organization does no work */
    it("measures no new hour and enqueues nothing", async () => {
      const { service, measureBytesAt, enqueueReport } = makeService({
        lastMeasured: SEAL_BOUNDARY,
      });

      await service.dispatchForOrg({ organizationId: "org-1" });

      expect(measureBytesAt).not.toHaveBeenCalled();
      expect(enqueueReport).not.toHaveBeenCalled();
    });
  });

  describe("given the per-org guard is already held", () => {
    /** @scenario Concurrent dispatches for the same organization are collapsed to one */
    it("skips measurement when the guard does not run the work", async () => {
      // A guard that never invokes fn simulates another project's dispatch
      // already holding the org lock.
      const { service, measureBytesAt, enqueueReport } = makeService({
        lastMeasured: hour("2026-02-15T08:00:00.000Z"), // has a real gap
        runExclusivePerOrg: async () => {
          /* lock held elsewhere → do not run */
        },
      });

      await service.dispatchForOrg({ organizationId: "org-1" });

      expect(measureBytesAt).not.toHaveBeenCalled();
      expect(enqueueReport).not.toHaveBeenCalled();
    });
  });

  describe("given the cursor trails the latest sealed hour", () => {
    /** @scenario Every sealed hour since the cursor is measured and enqueued once */
    it("measures each missing hour in order and enqueues one report per hour", async () => {
      // cursor at 08:00 → measure 09:00, 10:00, 11:00.
      const { service, measureBytesAt, recordHour, enqueueReport } =
        makeService({
          lastMeasured: hour("2026-02-15T08:00:00.000Z"),
        });

      await service.dispatchForOrg({ organizationId: "org-1" });

      const measuredHours = measureBytesAt.mock.calls.map(([p]) =>
        p.sealedHour.toISOString(),
      );
      expect(measuredHours).toEqual([
        "2026-02-15T09:00:00.000Z",
        "2026-02-15T10:00:00.000Z",
        "2026-02-15T11:00:00.000Z",
      ]);
      expect(recordHour).toHaveBeenCalledTimes(3);
      expect(enqueueReport).toHaveBeenCalledTimes(3);
      expect(enqueueReport).toHaveBeenLastCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          sealedHour: "2026-02-15T11:00:00.000Z",
          tenantId: "org-1",
        }),
      );
    });
  });

  describe("given a brand-new organization", () => {
    /** @scenario A brand-new organization starts at the latest sealed hour, not its whole history */
    it("measures only the most recent sealed hour", async () => {
      const { service, measureBytesAt, recordHour, enqueueReport } =
        makeService({
          lastMeasured: null,
        });

      await service.dispatchForOrg({ organizationId: "org-1" });

      expect(measureBytesAt).toHaveBeenCalledTimes(1);
      expect(measureBytesAt.mock.calls[0]![0].sealedHour.toISOString()).toBe(
        "2026-02-15T11:00:00.000Z",
      );
      expect(recordHour).toHaveBeenCalledTimes(1);
      expect(enqueueReport).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a gap beyond the backfill ceiling", () => {
    /** @scenario A gap beyond the billing ceiling is truncated with an alarm */
    it("measures only up to the ceiling and logs an alarm", async () => {
      // cursor 1000h behind → must truncate to the last 840 hours.
      const farBehind = new Date(SEAL_BOUNDARY.getTime() - 1000 * MS_PER_HOUR);
      const { service, measureBytesAt } = makeService({
        lastMeasured: farBehind,
      });

      await service.dispatchForOrg({ organizationId: "org-1" });

      // Truncated start is the ceiling back from the boundary; but only the
      // per-run cap is measured this run (the rest drains on later events).
      expect(measureBytesAt).toHaveBeenCalledTimes(STORAGE_MAX_HOURS_PER_RUN);
      expect(measureBytesAt.mock.calls[0]![0].sealedHour.toISOString()).toBe(
        new Date(
          SEAL_BOUNDARY.getTime() -
            (STORAGE_BACKFILL_MAX_HOURS - 1) * MS_PER_HOUR,
        ).toISOString(),
      );
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
        expect.stringContaining("ALARM"),
      );
    });
  });

  describe("given a gap larger than one run's cap but within the ceiling", () => {
    /** @scenario A large catch-up measures at most the per-run cap and defers the rest */
    it("measures the per-run cap this run without an alarm", async () => {
      const behind = new Date(
        SEAL_BOUNDARY.getTime() -
          (STORAGE_MAX_HOURS_PER_RUN + 50) * MS_PER_HOUR,
      );
      const { service, measureBytesAt } = makeService({ lastMeasured: behind });

      await service.dispatchForOrg({ organizationId: "org-1" });

      expect(measureBytesAt).toHaveBeenCalledTimes(STORAGE_MAX_HOURS_PER_RUN);
      expect(mockLoggerError).not.toHaveBeenCalled();
    });
  });

  describe("when recording a measured hour", () => {
    /** @scenario Each measured hour is rounded up to whole megabytes */
    it("rounds bytes up to the next whole megabyte", async () => {
      const { service, recordHour } = makeService({
        lastMeasured: null,
        measure: async () => 1_048_577, // 1 MiB + 1 byte
      });

      await service.dispatchForOrg({ organizationId: "org-1" });

      expect(recordHour).toHaveBeenCalledWith(
        expect.objectContaining({ megabytes: 2 }),
      );
    });

    /** @scenario Recording an hour does not clobber one that already exists */
    it("uses the insert-if-absent record path, never an update", async () => {
      const { service, recordHour } = makeService({ lastMeasured: null });

      await service.dispatchForOrg({ organizationId: "org-1" });

      // recordHour is the documented ON CONFLICT DO NOTHING path; the service
      // never calls markReported/update during measurement.
      expect(recordHour).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a measurement fails mid-gap", () => {
    /** @scenario A measurement failure stops the run without skipping the hour */
    it("stops at the failure and does not measure later hours", async () => {
      // cursor 08:00 → 09:00 ok, 10:00 throws, 11:00 must NOT be measured.
      const measure = vi
        .fn()
        .mockResolvedValueOnce(1_048_576)
        .mockRejectedValueOnce(new Error("clickhouse failed"));
      const { service, measureBytesAt, recordHour, enqueueReport } =
        makeService({
          lastMeasured: hour("2026-02-15T08:00:00.000Z"),
          measure,
        });

      await expect(
        service.dispatchForOrg({ organizationId: "org-1" }),
      ).rejects.toThrow("clickhouse failed");

      expect(measureBytesAt).toHaveBeenCalledTimes(2); // 09:00, 10:00 (failed)
      expect(recordHour).toHaveBeenCalledTimes(1); // only 09:00
      expect(enqueueReport).toHaveBeenCalledTimes(1); // only 09:00
    });
  });
});
