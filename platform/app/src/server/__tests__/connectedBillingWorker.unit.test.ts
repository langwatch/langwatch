/**
 * The daily billing tick of a connected self-hosted customer.
 *
 * Boundaries mocked: the three jobs, the environment and error capture.
 *
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runConnectedBillingTick,
  startConnectedBillingWorker,
} from "../connectedBillingWorker";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { IS_SAAS: true as boolean | undefined },
}));

vi.mock("~/env.mjs", () => ({ env: mockEnv }));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  withScope: async (callback: (scope: Record<string, unknown>) => void) => {
    callback({ setTag: vi.fn(), setExtra: vi.fn() });
  },
}));

function makeJobs(overrides: Record<string, unknown> = {}) {
  return {
    runSeatTrueUp: vi.fn(async () => undefined),
    runMonthlyStatements: vi.fn(async () => undefined),
    listPendingRenewalOrganizationIds: vi.fn(async () => ["org-acme"]),
    completeRenewalIfDue: vi.fn(async () => "completed"),
    ...overrides,
  };
}

describe("runConnectedBillingTick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given every job succeeds", () => {
    it("runs the seat true-up, the statements and each pending renewal", async () => {
      const jobs = makeJobs();

      await runConnectedBillingTick(jobs);

      expect(jobs.runSeatTrueUp).toHaveBeenCalledTimes(1);
      expect(jobs.runMonthlyStatements).toHaveBeenCalledTimes(1);
      expect(jobs.completeRenewalIfDue).toHaveBeenCalledWith({
        organizationId: "org-acme",
      });
    });
  });

  describe("given one job throws", () => {
    it("still runs the ones after it", async () => {
      const jobs = makeJobs({
        runSeatTrueUp: vi.fn(async () => {
          throw new Error("the payment provider is down");
        }),
      });

      await runConnectedBillingTick(jobs);

      expect(jobs.runMonthlyStatements).toHaveBeenCalledTimes(1);
      expect(jobs.completeRenewalIfDue).toHaveBeenCalledTimes(1);
    });
  });

  describe("given no renewal is pending", () => {
    it("completes none", async () => {
      const jobs = makeJobs({
        listPendingRenewalOrganizationIds: vi.fn(async () => []),
      });

      await runConnectedBillingTick(jobs);

      expect(jobs.completeRenewalIfDue).not.toHaveBeenCalled();
    });
  });
});

describe("startConnectedBillingWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockEnv.IS_SAAS = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a deployment that is not LangWatch Cloud", () => {
    it("starts nothing", () => {
      mockEnv.IS_SAAS = undefined;
      const jobs = makeJobs();

      expect(startConnectedBillingWorker({ jobs })).toBeUndefined();

      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(jobs.runSeatTrueUp).not.toHaveBeenCalled();
    });
  });

  describe("given LangWatch Cloud", () => {
    it("waits five minutes for the process to come up, then ticks daily", async () => {
      const jobs = makeJobs();
      const handle = startConnectedBillingWorker({ jobs });

      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(jobs.runSeatTrueUp).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(jobs.runSeatTrueUp).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(jobs.runSeatTrueUp).toHaveBeenCalledTimes(2);

      handle?.stop();
    });

    it("stops ticking once it is stopped", async () => {
      const jobs = makeJobs();
      const handle = startConnectedBillingWorker({ jobs });

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      handle?.stop();
      await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000);

      expect(jobs.runSeatTrueUp).toHaveBeenCalledTimes(1);
    });
  });
});
