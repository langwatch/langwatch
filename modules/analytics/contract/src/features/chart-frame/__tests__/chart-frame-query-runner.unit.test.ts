/**
 * The data hook's fetch policy, driven directly: what a failure does to rows
 * already on screen, which failures are retried, and when.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ChartQueryState,
  createChartQueryRunner,
  planChartQueryRetry,
  reduceChartQueryState,
} from "../chart-frame-query-runner.ts";

const PENDING: ChartQueryState = {
  status: "pending",
  data: null,
  error: null,
  refetchError: null,
  isFetching: true,
};
const BUSY = { code: "lwql_busy", retryable: true };
const BROKEN = { code: "lwql_unknown_identifier" };

/** A runner over a scripted query, with the hook's own state reduction and real retry plan. */
function runnerOver(answers: (() => Promise<{ rows: unknown }>)[]) {
  let state = PENDING;
  const delays: number[] = [];
  const query = vi.fn(() => answers.shift()!());
  const runner = createChartQueryRunner({
    query,
    emit: (event) => {
      state = reduceChartQueryState({ previous: state, event });
    },
    toError: (rejection) => rejection,
    planRetry: ({ rejection, retriesUsed }) =>
      planChartQueryRetry({ rejection, retriesUsed, random: () => 0.5 }),
    setTimer: (callback, delayMs) => {
      delays.push(delayMs);
      return setTimeout(callback, delayMs);
    },
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  return { runner, query, delays, read: () => state };
}

const rows = (value: unknown) => () => Promise.resolve({ rows: value });
const refuse = (rejection: unknown) => () => Promise.reject(rejection);

describe("the chart query runner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when a refetch fails after rows were loaded", () => {
    /** @scenario "A failed refresh keeps the chart that was on screen" */
    it("keeps the rows and the success status, and reports the failure apart", async () => {
      const { runner, read } = runnerOver([rows([{ n: 1 }]), refuse(BROKEN)]);
      runner.run();
      await vi.runAllTimersAsync();

      runner.run();
      await vi.runAllTimersAsync();

      expect(read()).toEqual({
        status: "success",
        data: [{ n: 1 }],
        error: null,
        refetchError: BROKEN,
        isFetching: false,
      });
    });

    it("clears the refetch error once a later refetch succeeds", async () => {
      const { runner, read } = runnerOver([rows([1]), refuse(BROKEN), rows([2])]);
      for (let fetches = 0; fetches < 3; fetches += 1) {
        runner.run();
        await vi.runAllTimersAsync();
      }

      expect(read()).toMatchObject({ status: "success", data: [2], refetchError: null });
    });
  });

  describe("when a query is refused with a retryable error", () => {
    /** @scenario "A retryable failure is retried with backoff before it counts" */
    it("tries again three times, waiting longer each time, then reports it", async () => {
      const { runner, query, delays, read } = runnerOver([
        refuse(BUSY),
        refuse(BUSY),
        refuse(BUSY),
        refuse(BUSY),
      ]);

      runner.run();
      await vi.runAllTimersAsync();

      expect(query).toHaveBeenCalledTimes(4);
      expect(delays).toEqual([300, 600, 1200]);
      expect(read()).toMatchObject({ status: "error", error: BUSY });
    });

    /** @scenario "A retryable failure is retried with backoff before it counts" */
    it("leaves no error behind when a retry succeeds", async () => {
      const { runner, query, read } = runnerOver([refuse(BUSY), rows([7])]);

      runner.run();
      await vi.runAllTimersAsync();

      expect(query).toHaveBeenCalledTimes(2);
      expect(read()).toEqual({
        status: "success",
        data: [7],
        error: null,
        refetchError: null,
        isFetching: false,
      });
    });

    it("stays fetching, with no error shown, while it waits to retry", async () => {
      const { runner, read } = runnerOver([refuse(BUSY), rows([7])]);

      runner.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(read()).toMatchObject({ status: "pending", error: null, isFetching: true });
    });

    it("abandons a pending retry when a new fetch or a cancel supersedes it", async () => {
      const { runner, query, read } = runnerOver([refuse(BUSY), rows(["fresh"]), refuse(BUSY)]);
      runner.run();
      await vi.advanceTimersByTimeAsync(0);

      runner.run();
      await vi.runAllTimersAsync();
      expect(query).toHaveBeenCalledTimes(2);
      expect(read()).toMatchObject({ data: ["fresh"] });

      runner.run();
      await vi.advanceTimersByTimeAsync(0);
      runner.cancel();
      await vi.runAllTimersAsync();
      expect(query).toHaveBeenCalledTimes(3);
    });
  });

  describe("when a query fails with an error that is not retryable", () => {
    /** @scenario "A retryable failure is retried with backoff before it counts" */
    it("does not try again", async () => {
      const { runner, query } = runnerOver([refuse(BROKEN)]);

      runner.run();
      await vi.runAllTimersAsync();

      expect(query).toHaveBeenCalledTimes(1);
    });

    /** @scenario "An error state is only for a query that never had data" */
    it("is an error state when the query never had data", async () => {
      const { runner, read } = runnerOver([refuse(BROKEN)]);

      runner.run();
      await vi.runAllTimersAsync();

      expect(read()).toEqual({
        status: "error",
        data: null,
        error: BROKEN,
        refetchError: null,
        isFetching: false,
      });
    });
  });
});

describe("the retry plan", () => {
  /** @scenario "A retryable failure is retried with backoff before it counts" */
  it("spreads each wait over the upper half of a doubling ceiling", () => {
    const plan = (retriesUsed: number, random: number) =>
      planChartQueryRetry({ rejection: BUSY, retriesUsed, random: () => random });

    expect(plan(0, 0)).toEqual({ retry: true, delayMs: 200 });
    expect(plan(0, 0.999)).toEqual({ retry: true, delayMs: 400 });
    expect(plan(2, 0)).toEqual({ retry: true, delayMs: 800 });
    expect(plan(3, 0)).toEqual({ retry: false });
  });

  it("retries only a rejection that says it is retryable", () => {
    for (const rejection of [BROKEN, { retryable: "yes" }, null, "busy", new Error("x")]) {
      expect(planChartQueryRetry({ rejection, retriesUsed: 0, random: () => 0 })).toEqual({
        retry: false,
      });
    }
  });
});
