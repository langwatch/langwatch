/**
 * The lines a blocking run leaves on the screen: the progress while it judges,
 * and the headline once it is done.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import { describe, expect, it, vi } from "vitest";

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

import type { InstantEvalJudgment, InstantEvalRun } from "@/client-sdk/services/instant-evals";

import {
  elapsedLabel,
  followInstantEvalRun,
  instantEvalHeadline,
  instantEvalProgressLine,
  printInstantEvalRows,
} from "../liveRun";

const run = (overrides: Partial<InstantEvalRun> = {}): InstantEvalRun =>
  ({
    id: "instant_eval_abc",
    name: null,
    sql: "SELECT argMax(m.TraceId, m.OccurredAt) AS TraceId, m.ConversationId AS ThreadId FROM analytics.trace_metrics AS m GROUP BY m.ConversationId",
    parameters: {},
    questions: [
      { id: "q1", function: "eval", kind: "boolean", reads: "probability", threshold: 0.5 },
    ],
    limit: 10_000,
    status: "running",
    total: 10_000,
    progress: 3_200,
    matched: 412,
    matchedByQuestion: { q1: 412 },
    failed: 0,
    skipped: 0,
    tokens: 1_900_000,
    costUsd: 0,
    priceUsd: 0.33,
    error: null,
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }) as InstantEvalRun;

describe("elapsedLabel, given a duration", () => {
  describe("when it is under a minute", () => {
    it("reads in seconds to one decimal", () => {
      expect(elapsedLabel(20_400)).toBe("20.4s");
    });
  });

  describe("when it is over a minute", () => {
    it("reads in minutes and padded seconds", () => {
      expect(elapsedLabel(64_000)).toBe("1m 04s");
    });
  });
});

describe("instantEvalProgressLine, given a run in flight", () => {
  describe("when it has judged some of its rows", () => {
    /** @scenario "A run reports its progress on one line while it judges" */
    it("carries the count, the matches, the tokens and the time", () => {
      expect(instantEvalProgressLine(run(), 12_000)).toBe(
        "Judging 3,200/10,000 · 412 matched · 1.9M tokens · 12.0s",
      );
    });
  });

  describe("when the run asked no boolean question", () => {
    it("leaves the matches out", () => {
      expect(instantEvalProgressLine(run({ matched: null }), 12_000)).toContain(
        "Judging 3,200/10,000 · 1.9M tokens",
      );
    });
  });
});

describe("instantEvalHeadline, given a finished run", () => {
  describe("when every question answers yes or no", () => {
    /** @scenario "A finished run headlines the matches, the time and the price" */
    it("counts the matches against the rows it read", () => {
      const line = instantEvalHeadline(
        run({ status: "finished", progress: 10_000, tokens: 6_100_000 }),
        20_400,
      );

      expect(line).toContain("Found");
      expect(line).toContain("412");
      expect(line).toContain("10,000 conversations");
      expect(line).toContain("20.4s");
      expect(line).toContain("6.1M tokens");
      expect(line).toContain("$0.33");
    });
  });

  describe("when the run did not finish", () => {
    /** @scenario "A run that did not finish reports only what it judged" */
    it("counts what it judged, not what it selected", () => {
      // A failed run that never judged a row used to headline its whole
      // selection as judged, which reads as a success with a zero bill.
      const line = instantEvalHeadline(
        run({ status: "failed", progress: 0, total: 10_000, tokens: 0, matched: null }),
        50_600,
      );

      expect(line).toContain("Judged 0 conversations");
      expect(line).not.toContain("10,000");
    });
  });

  describe("when the question answers with a score", () => {
    /** @scenario "A run whose questions are not yes or no reports what it read" */
    it("counts nothing, because a score has no threshold to be past", () => {
      const line = instantEvalHeadline(
        run({
          status: "finished",
          questions: [{ id: "q1", function: "eval_score", kind: "score", reads: "score" }] as never,
        }),
        1_000,
      );

      expect(line).toContain("Judged");
      expect(line).not.toContain("matches");
    });
  });
});

describe("followInstantEvalRun, given a run to follow", () => {
  describe("when the run is already over", () => {
    /** @scenario "A run that is already over is not polled" */
    it("answers at once without reading it again", async () => {
      const get = vi.fn();

      const live = await followInstantEvalRun({
        service: { get } as never,
        run: run({ status: "finished" }),
        machine: true,
      });

      expect(live.outcome).toBe("finished");
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe("when the run finishes while it is followed", () => {
    it("answers with the finished run", async () => {
      const get = vi
        .fn()
        .mockResolvedValueOnce(run())
        .mockResolvedValueOnce(run({ status: "finished", matched: 1_284 }));

      const live = await followInstantEvalRun({
        service: { get } as never,
        run: run(),
        machine: true,
        sleep: async () => undefined,
      });

      expect(live.outcome).toBe("finished");
      expect(live.run.matched).toBe(1_284);
    });
  });

  describe("when the run outlives the follow ceiling", () => {
    /** @scenario "A blocking run gives up following after its ceiling" */
    it("gives up and hands back the run it last read", async () => {
      const get = vi.fn().mockResolvedValue(run());
      let clock = 0;

      const live = await followInstantEvalRun({
        service: { get } as never,
        run: run(),
        machine: true,
        timeoutMs: 10_000,
        sleep: async () => {
          clock += 4_000;
        },
        now: () => clock,
      });

      expect(live.outcome).toBe("timeout");
      expect(live.run.status).toBe("running");
    });
  });

  describe("when reading the run keeps failing", () => {
    /** @scenario "A blocking run stops following after repeated read failures" */
    it("stops after five tries and keeps the run it last had", async () => {
      const get = vi.fn().mockRejectedValue(new Error("down"));

      const live = await followInstantEvalRun({
        service: { get } as never,
        run: run(),
        machine: true,
        sleep: async () => undefined,
      });

      expect(live.outcome).toBe("poll_failure");
      expect(live.run.id).toBe("instant_eval_abc");
    });
  });
});

describe("printInstantEvalRows, given a model-call run", () => {
  describe("when two spans of one trace were judged", () => {
    /** @scenario "run reads back the first rows of a finished run" */
    it("shows each span its own verdict", () => {
      const spanRun = run({
        status: "finished",
        sql: "SELECT TraceId, SpanId FROM analytics.spans WHERE SpanAttributes['langwatch.span.type'] = 'llm'",
      });
      const judgment = (overrides: Partial<InstantEvalJudgment>): InstantEvalJudgment =>
        ({
          traceId: "trace_1",
          questionId: "q1",
          threadId: "",
          spanId: "",
          kind: "boolean",
          status: "judged",
          passed: true,
          score: null,
          label: null,
          probability: 0.9,
          probabilities: null,
          error: null,
          occurredAt: "2026-09-18T12:00:00.000Z",
          ...overrides,
        }) as InstantEvalJudgment;
      const printed: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
        printed.push(parts.map(String).join(" "));
      });

      try {
        printInstantEvalRows({
          rows: [
            { TraceId: "trace_1", SpanId: "span_a", q1: "first call" },
            { TraceId: "trace_1", SpanId: "span_b", q1: "second call" },
          ],
          judgments: [
            judgment({ spanId: "span_a", passed: true, probability: 0.9 }),
            judgment({ spanId: "span_b", passed: false, probability: 0.1 }),
          ],
          run: spanRun,
        });
      } finally {
        logSpy.mockRestore();
      }

      const rowA = printed.find((line) => line.includes("span_a"));
      const rowB = printed.find((line) => line.includes("span_b"));
      expect(rowA).toContain("yes (0.90)");
      expect(rowB).toContain("no (0.10)");
    });
  });
});
