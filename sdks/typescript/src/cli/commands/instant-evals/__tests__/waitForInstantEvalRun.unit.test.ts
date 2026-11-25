/**
 * The `--wait` poll: the one progress line it prints, and the verdict it
 * answers with.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    stop: vi.fn(),
    text: "",
  }),
}));

import type { InstantEvalRun } from "@/client-sdk/services/instant-evals";

import {
  DEFAULT_INSTANT_EVAL_WAIT_MINUTES,
  instantEvalProgressLine,
  readWaitMinutes,
  waitForInstantEvalRun,
} from "../waitForInstantEvalRun";

const run = (overrides: Partial<InstantEvalRun> = {}): InstantEvalRun =>
  ({
    id: "instant_eval_abc",
    name: null,
    sql: "SELECT TraceId FROM traces",
    parameters: {},
    questions: [],
    limit: 10_000,
    status: "running",
    total: 10_000,
    progress: 3_200,
    matched: 412,
    matchedByQuestion: {},
    failed: 0,
    skipped: 0,
    tokens: 0,
    costUsd: 0,
    priceUsd: 0,
    error: null,
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }) as InstantEvalRun;

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.exitCode = undefined;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  process.exitCode = undefined;
});

const noSleep = async (): Promise<void> => undefined;

describe("instantEvalProgressLine, given a run in flight", () => {
  describe("when it has judged some of its rows", () => {
    /** @scenario "--wait follows the run and reports progress on one line" */
    it("reads as the judged count out of the total, with the matches", () => {
      expect(instantEvalProgressLine(run())).toBe("Judging... 3,200/10,000 (412 matched)");
    });
  });

  describe("when the run asked no boolean question", () => {
    it("leaves the matches out", () => {
      expect(instantEvalProgressLine(run({ matched: null }))).toBe("Judging... 3,200/10,000");
    });
  });

  describe("when the run has not counted its rows yet", () => {
    it("reads against the limit it was given", () => {
      expect(instantEvalProgressLine(run({ total: null, progress: 0 }))).toBe(
        "Judging... 0/10,000 (412 matched)",
      );
    });
  });
});

describe("readWaitMinutes, given the --wait flag", () => {
  describe("when it carries no value", () => {
    it("means the default", () => {
      expect(readWaitMinutes(true)).toBe(DEFAULT_INSTANT_EVAL_WAIT_MINUTES);
    });
  });

  describe("when it carries a number", () => {
    it("means that many minutes", () => {
      expect(readWaitMinutes("5")).toBe(5);
    });
  });

  describe("when it was not written", () => {
    it("means no wait at all", () => {
      expect(readWaitMinutes(undefined)).toBeUndefined();
      expect(readWaitMinutes(false)).toBeUndefined();
    });
  });

  describe("when it carries something that is not minutes", () => {
    it("falls back to the default rather than waiting forever", () => {
      expect(readWaitMinutes("soon")).toBe(DEFAULT_INSTANT_EVAL_WAIT_MINUTES);
    });
  });
});

describe("waitForInstantEvalRun, given a run being followed", () => {
  describe("when the run finishes", () => {
    /** @scenario "--wait ends when the run ends and reports what it found" */
    it("answers with the finished run and leaves the exit code alone", async () => {
      const get = vi
        .fn()
        .mockResolvedValueOnce(run())
        .mockResolvedValueOnce(run({ status: "finished", progress: 10_000, matched: 1_284 }));

      const waited = await waitForInstantEvalRun({
        service: { get } as never,
        runId: "instant_eval_abc",
        machine: true,
        timeoutMs: 60_000,
        known: run(),
        sleep: noSleep,
      });

      expect(waited.outcome).toBe("finished");
      expect(waited.run.matched).toBe(1_284);
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe("when the run fails", () => {
    /** @scenario "A failed run makes --wait exit non-zero" */
    it("exits non-zero and carries the failure code", async () => {
      const get = vi
        .fn()
        .mockResolvedValue(run({ status: "failed", error: "instant_eval_stalled" }));

      const waited = await waitForInstantEvalRun({
        service: { get } as never,
        runId: "instant_eval_abc",
        machine: true,
        timeoutMs: 60_000,
        known: run(),
        sleep: noSleep,
      });

      expect(waited.outcome).toBe("failed");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when the run was cancelled", () => {
    it("says so without failing the command", async () => {
      const get = vi.fn().mockResolvedValue(run({ status: "cancelled" }));

      const waited = await waitForInstantEvalRun({
        service: { get } as never,
        runId: "instant_eval_abc",
        machine: true,
        timeoutMs: 60_000,
        known: run(),
        sleep: noSleep,
      });

      expect(waited.outcome).toBe("cancelled");
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe("when the run never finishes", () => {
    /** @scenario "--wait gives up after the minutes it was given" */
    it("gives up after the time it was given and exits non-zero", async () => {
      const get = vi.fn().mockResolvedValue(run());
      let clock = 0;
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);

      const waited = await waitForInstantEvalRun({
        service: { get } as never,
        runId: "instant_eval_abc",
        machine: true,
        timeoutMs: 10_000,
        known: run(),
        sleep: async () => {
          clock += 3_000;
        },
      });

      nowSpy.mockRestore();
      expect(waited.outcome).toBe("timeout");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when reading the run keeps failing", () => {
    it("stops after five tries and exits non-zero", async () => {
      const get = vi
        .fn()
        .mockRejectedValueOnce(new Error("down"))
        .mockRejectedValueOnce(new Error("down"))
        .mockRejectedValueOnce(new Error("down"))
        .mockRejectedValueOnce(new Error("down"))
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValue(run());

      const waited = await waitForInstantEvalRun({
        service: { get } as never,
        runId: "instant_eval_abc",
        machine: true,
        timeoutMs: 600_000,
        known: run(),
        sleep: noSleep,
      });

      expect(waited.outcome).toBe("poll_failure");
      expect(process.exitCode).toBe(1);
    });

    /** @scenario "A wait that gives up while the API is down still answers" */
    it("answers with the run the caller already had when every read fails", async () => {
      // Both give-up paths are reached BECAUSE reading the run is failing, so
      // one more read is the least likely call to succeed. It used to be
      // awaited unguarded, and `--wait` died on the network error instead of
      // reporting that it had stopped waiting.
      const get = vi.fn().mockRejectedValue(new Error("down"));

      const waited = await waitForInstantEvalRun({
        service: { get } as never,
        runId: "instant_eval_abc",
        machine: true,
        timeoutMs: 600_000,
        known: run({ status: "queued" }),
        sleep: noSleep,
      });

      expect(waited.outcome).toBe("poll_failure");
      expect(waited.run.status).toBe("queued");
      expect(process.exitCode).toBe(1);
    });

    /** @scenario "A wait that times out while the API is down still answers" */
    it("answers with the run the caller already had when it times out unread", async () => {
      const get = vi.fn().mockRejectedValue(new Error("down"));

      const waited = await waitForInstantEvalRun({
        service: { get } as never,
        runId: "instant_eval_abc",
        machine: true,
        timeoutMs: -1,
        known: run({ status: "queued" }),
        sleep: noSleep,
      });

      expect(waited.outcome).toBe("timeout");
      expect(waited.run.status).toBe("queued");
      expect(process.exitCode).toBe(1);
    });
  });
});
