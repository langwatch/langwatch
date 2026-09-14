/**
 * The shared `--wait` poll.
 *
 * What matters here is the ANSWER the poll returns, because every run command
 * puts it into the one document a machine caller reads. A wait that ends the
 * process, or that only prints its verdict, leaves that caller with an empty
 * stdout.
 *
 * Spec: specs/features/run-plan-cli.feature
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    text: "",
  }),
}));

import { waitForBatchRun } from "../waitForBatchRun";

const noop = () => {
  // intentionally empty, suppresses output during tests
};

/**
 * A fresh response per call. A `Response` body can be read once, so handing the
 * same object to every poll turns the second read into a poll FAILURE.
 */
const answersWith = (runs: unknown[]) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ runs, hasMore: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

const passedRun = {
  batchRunId: "batch_123",
  scenarioRunId: "run_1",
  scenarioId: "scenario_1",
  status: "SUCCESS",
  results: { verdict: "success" },
};

const failedRun = {
  batchRunId: "batch_123",
  scenarioRunId: "run_2",
  scenarioId: "scenario_2",
  status: "ERROR",
  results: null,
};

const wait = async ({
  jobCount = 2,
  machine = true,
  advanceMs = 3000,
  timeoutMs = 45 * 60 * 1000,
}: {
  jobCount?: number;
  machine?: boolean;
  advanceMs?: number;
  timeoutMs?: number;
} = {}) => {
  vi.useFakeTimers();
  try {
    const promise = waitForBatchRun({
      batchRunId: "batch_123",
      jobCount,
      subject: "run",
      machine,
      timeoutMs,
    });
    await vi.advanceTimersByTimeAsync(advanceMs);
    return await promise;
  } finally {
    vi.useRealTimers();
  }
};

describe("waitForBatchRun()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
  });

  afterEach(() => {
    // The wait paths set the exit code; a leftover value would fail the whole
    // vitest process at the end of the run.
    process.exitCode = undefined;
  });

  describe("when every run of the batch passed", () => {
    /** @scenario "Wait for a run to complete" */
    it("answers with the passed outcome, the tallies and the per-run rows", async () => {
      answersWith([
        passedRun,
        { ...failedRun, status: "SUCCESS", results: { verdict: "success" } },
      ]);

      const answer = await wait();

      expect(answer.outcome).toBe("passed");
      expect(answer.tallies).toEqual({
        total: 2,
        completed: 2,
        passed: 2,
        failed: 0,
      });
      expect(answer.results).toHaveLength(2);
      expect(process.exitCode).not.toBe(1);
    });
  });

  describe("when a run of the batch failed", () => {
    /** @scenario "Wait for a run that failed" */
    it("answers with the failed outcome and sets a failing exit code", async () => {
      answersWith([passedRun, failedRun]);

      const answer = await wait();

      expect(answer.outcome).toBe("failed");
      expect(answer.tallies).toEqual({
        total: 2,
        completed: 2,
        passed: 1,
        failed: 1,
      });
      expect(answer.results).toEqual([
        {
          scenarioRunId: "run_1",
          scenarioId: "scenario_1",
          status: "SUCCESS",
          verdict: "success",
        },
        {
          scenarioRunId: "run_2",
          scenarioId: "scenario_2",
          status: "ERROR",
          verdict: null,
        },
      ]);
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when the jobs never complete", () => {
    /** @scenario "A timed-out wait still emits the machine-readable document" */
    it("returns the timeout outcome instead of ending the process", async () => {
      answersWith([{ batchRunId: "batch_123", status: "IN_PROGRESS" }]);
      const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
        throw new Error("process.exit called");
      }) as never);

      const answer = await wait({ advanceMs: 45 * 60 * 1000 + 3000 });

      expect(answer.outcome).toBe("timeout");
      expect(exit).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    /** @scenario "Wait for a number of minutes" */
    it("gives up at the limit the caller set", async () => {
      answersWith([{ batchRunId: "batch_123", status: "IN_PROGRESS" }]);

      const answer = await wait({
        timeoutMs: 60 * 1000,
        advanceMs: 60 * 1000 + 3000,
      });

      expect(answer.outcome).toBe("timeout");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when a status read stalls", () => {
    /** @scenario "The wait deadline also bounds a stalled status read" */
    it.each(["request", "response body", "later page"])(
      "bounds a stalled %s and keeps the last complete poll",
      async (stage) => {
        vi.useFakeTimers();
        let calls = 0;
        let pendingSignal: AbortSignal | null | undefined;
        vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
          calls++;
          if (calls === 1) {
            return new Response(JSON.stringify({ runs: [passedRun] }));
          }
          if (stage === "later page" && calls === 2) {
            return new Response(JSON.stringify({
              runs: [failedRun],
              hasMore: true,
              nextCursor: "page_2",
            }));
          }
          pendingSignal = init?.signal;
          if (stage === "response body") {
            return new Response(new ReadableStream({
              start(controller) {
                pendingSignal?.addEventListener(
                  "abort",
                  () => controller.error(new Error("read aborted")),
                  { once: true },
                );
              },
            }));
          }
          return new Promise<Response>((_resolve, reject) => {
            pendingSignal?.addEventListener(
              "abort",
              () => reject(new Error("request aborted")),
              { once: true },
            );
          });
        });
        const finished = vi.fn();
        try {
          const promise = waitForBatchRun({
            batchRunId: "batch_123",
            jobCount: 2,
            subject: "run",
            machine: true,
            timeoutMs: 7000,
          }).then(finished);
          await vi.advanceTimersByTimeAsync(7000);

          expect(finished).toHaveBeenCalledWith({
            outcome: "timeout",
            tallies: { total: 2, completed: 1, passed: 1, failed: 0 },
            results: [{
              scenarioRunId: "run_1",
              scenarioId: "scenario_1",
              status: "SUCCESS",
              verdict: "success",
            }],
          });
          await promise;
          expect(pendingSignal?.aborted).toBe(true);
          expect(process.exitCode).toBe(1);
          expect(console.log).not.toHaveBeenCalled();
          expect(vi.getTimerCount()).toBe(0);
        } finally {
          vi.clearAllTimers();
          vi.useRealTimers();
        }
      },
    );
  });

  describe("when the wait is shorter than the polling interval", () => {
    /** @scenario "A short wait ends before the next poll" */
    it("ends at the deadline without starting a status request", async () => {
      vi.useFakeTimers();
      const fetchSpy = answersWith([passedRun]);
      const finished = vi.fn();
      try {
        const promise = waitForBatchRun({
          batchRunId: "batch_123",
          jobCount: 1,
          subject: "run",
          machine: true,
          timeoutMs: 1000,
        }).then(finished);
        await vi.advanceTimersByTimeAsync(1000);

        expect(finished).toHaveBeenCalledWith(
          expect.objectContaining({ outcome: "timeout" }),
        );
        await promise;
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });
  });

  describe("when the status endpoint keeps failing", () => {
    /** @scenario "A dead status endpoint still emits the machine-readable document" */
    it("gives up after five reads in a row and answers with the poll failure outcome", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("endpoint down"));

      const answer = await wait({ advanceMs: 5 * 3000 });

      expect(answer.outcome).toBe("poll_failure");
      expect(fetchSpy).toHaveBeenCalledTimes(5);
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when a machine format was asked for", () => {
    /** @scenario "Wait with machine-readable output" */
    it("prints no prose on stdout", async () => {
      answersWith([passedRun]);

      await wait({ jobCount: 1 });

      expect(console.log).not.toHaveBeenCalled();
    });
  });
});
