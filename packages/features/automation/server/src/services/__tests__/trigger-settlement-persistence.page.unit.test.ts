/**
 * How one page of settled matches behaves when a single trace in it misbehaves:
 * a page-mate's terminal failure, a claim write that never lands, the retry
 * line that has to name the cause, and a ceiling breach reported once.
 * @see specs/automations/process-manager-dispatch.feature
 */
import { DispatchError } from "@langwatch/eventing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
}));

import type { TriggerSummary } from "@langwatch/automation-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { TriggerSettlementPersistenceService } from "../trigger-settlement-persistence.service.ts";

const trigger: TriggerSummary = {
  id: "trigger-1",
  projectId: "project-1",
  name: "Every trace",
  action: "ADD_TO_DATASET",
  triggerKind: "AUTOMATION",
  actionParams: {},
  filters: {},
  filterQuery: null,
  alertType: null,
  message: null,
  customGraphId: null,
  notificationCadence: "immediately",
  traceDebounceMs: 0,
  templates: {},
} as never;

const fold: TraceSummaryData = { traceId: "trace-1" } as never;

function runtime(
  options: {
    dispatchFails?: Record<string, Error>;
    claimFails?: ReadonlySet<string>;
    capAllows?: boolean;
  } = {},
) {
  const dispatched: string[] = [];
  const claimed: string[] = [];
  const capture = vi.fn();

  const dispatch = vi.fn(async ({ traceId }: { traceId: string }) => {
    const failure = options.dispatchFails?.[traceId];
    if (failure) throw failure;
    dispatched.push(traceId);
  });
  const claimSend = vi.fn(async ({ traceId }: { traceId: string }) => {
    if (options.claimFails?.has(traceId)) throw new Error("claim write failed");
    claimed.push(traceId);
    return true;
  });
  const handlePersistCapBreach = vi.fn().mockResolvedValue(undefined);
  const allowed = options.capAllows ?? true;

  const automation = {
    getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([trigger]),
    filterSendClaimed: vi.fn().mockResolvedValue(new Set<string>()),
    resolvePersistDailyCap: vi.fn().mockResolvedValue(1),
    consumePersistCapSlot: vi
      .fn()
      .mockResolvedValue({ allowed, count: allowed ? 1 : 9, cap: 1, skipped: allowed ? 0 : 1 }),
    handlePersistCapBreach,
    claimSend,
  } as never;

  const service = TriggerSettlementPersistenceService.create({
    automation,
    projects: {
      tryGetById: vi.fn().mockResolvedValue({ id: "project-1", name: "Project", slug: "project" }),
    } as never,
    traces: { tryGetSummary: vi.fn().mockResolvedValue(fold) } as never,
    confirmation: { confirms: vi.fn().mockResolvedValue(true) } as never,
    persistActions: { dispatch } as never,
    clock: { now: () => new Date("2026-01-01T00:00:00Z") } as never,
    observability: { recordOverflow: vi.fn(), capture } as never,
  });

  const run = (traceIds: string[]) =>
    service.dispatch({ projectId: "project-1", triggerId: "trigger-1", traceIds });

  return { run, dispatched, claimed, capture, handlePersistCapBreach };
}

describe("given a page of settled matches dispatching together", () => {
  beforeEach(() => {
    warn.mockClear();
  });

  describe("when one trace fails with a non-retryable error", () => {
    /** @scenario A terminal failure for one trace does not fail its page-mates */
    it("dispatches and claims the rest of the page and records the failure without retrying", async () => {
      const harness = runtime({
        dispatchFails: {
          "trace-1": new DispatchError({ message: "action gone", retryable: false }),
        },
      });

      await expect(harness.run(["trace-1", "trace-2", "trace-3"])).resolves.toBeUndefined();

      expect(harness.dispatched).toEqual(expect.arrayContaining(["trace-2", "trace-3"]));
      expect(harness.claimed).toEqual(expect.arrayContaining(["trace-2", "trace-3"]));
      expect(harness.claimed).not.toContain("trace-1");
      expect(harness.capture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ traceId: "trace-1", phase: "persist-dispatch-terminal" }),
      );
    });
  });

  describe("when one trace dispatches but its claim write never lands", () => {
    /** @scenario A failed claim write does not cancel a page-mate's retry */
    it("still retries the page for the retryable failure and records the unclaimed trace", async () => {
      const harness = runtime({
        claimFails: new Set(["trace-1"]),
        dispatchFails: {
          "trace-2": new DispatchError({ message: "dataset write timed out", retryable: true }),
        },
      });

      await expect(harness.run(["trace-1", "trace-2"])).rejects.toThrow("dataset write timed out");

      expect(harness.dispatched).toContain("trace-1");
      expect(harness.claimed).toEqual([]);
      expect(harness.capture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ phase: "persist-page-retry-unclaimed", unclaimed: ["trace-1"] }),
      );
    });
  });

  describe("when the page decides to retry", () => {
    /** @scenario A retrying page names the failure that caused the retry */
    it("names the failing error type and message on the retry line", async () => {
      const harness = runtime({
        dispatchFails: {
          "trace-1": new DispatchError({ message: "dataset write timed out", retryable: true }),
        },
      });

      await expect(harness.run(["trace-1", "trace-2"])).rejects.toThrow("dataset write timed out");

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: "DispatchError",
          errorMessage: "dataset write timed out",
          failed: 1,
        }),
        expect.stringContaining("Retrying the page"),
      );
    });
  });

  describe("when every trace of the page is over the automation's daily ceiling", () => {
    /** @scenario A daily-ceiling breach is reported once per page */
    it("drops every refused trace and contains the breach at most once", async () => {
      const harness = runtime({ capAllows: false });

      await expect(harness.run(["trace-1", "trace-2", "trace-3"])).resolves.toBeUndefined();

      expect(harness.dispatched).toEqual([]);
      expect(harness.handlePersistCapBreach).toHaveBeenCalledTimes(1);
    });
  });
});
