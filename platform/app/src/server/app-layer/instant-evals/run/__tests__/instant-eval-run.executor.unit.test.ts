/**
 * The run's three steps, against fakes.
 *
 * The classifier is the shipped null one, which skips every text: that is the
 * deployment a self-hosted install without a key gets, and a page of skips must
 * still be a recorded page rather than a failure the queue redelivers forever.
 *
 * @see ../instant-eval-run.executor.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { LangWatchQLAppFunctionCall } from "~/server/analytics/lwql";
import { NullInstantEvalClassifier } from "../../classifier/null.client";
import type { InstantEvalCostRecord } from "../../instant-eval-cost.recorder";
import {
  createInstantEvalRunExecutor,
  INSTANT_EVAL_LARGE_TEXT_BYTES,
  INSTANT_EVAL_PAGE_SIZE,
  INSTANT_EVAL_SMALL_PAGE_SIZE,
  instantEvalAverageTextBytes,
  instantEvalHydrationPlan,
  instantEvalPageSizeFor,
} from "../instant-eval-run.executor";
import type { InstantEvalJudgmentRecord } from "../judgments";
import { instantEvalRunQuestions } from "../questions";
import type { InstantEvalRowKey, InstantEvalRowSource } from "../row-source";

const PROJECT_ID = "project-1";
const RUN_ID = "instanteval_1";
const NOW = 1_758_000_000_000;

const calls: LangWatchQLAppFunctionCall[] = [
  {
    column: "annoyed",
    function: "eval",
    options: ["The customer sounds annoyed"],
    source: { function: "conversation_bounded", options: [8000, ""] },
  },
];

const questions = instantEvalRunQuestions(calls);

function rowKey(traceId: string): InstantEvalRowKey {
  return {
    traceId,
    threadId: `thread-${traceId}`,
    spanId: "",
    occurredAt: NOW - 1_000,
  };
}

function fakes(options?: {
  keys?: InstantEvalRowKey[][];
  hasMore?: boolean[];
  judgedCells?: (unknown | null)[];
  skipped?: Record<string, number>;
  isCancelled?: boolean;
  rowLimit?: number;
  texts?: Record<string, unknown>[];
}) {
  const inserted: InstantEvalJudgmentRecord[][] = [];
  const costs: InstantEvalCostRecord[] = [];
  let keyCall = 0;

  const rowSource: InstantEvalRowSource = {
    probe: vi.fn(async () => [
      { name: "TraceId", type: "String" },
      { name: "ThreadId", type: "String" },
      { name: "annoyed", type: "Nullable(String)" },
    ]),
    keys: vi.fn(async () => {
      const index = keyCall++;
      return {
        keys: options?.keys?.[index] ?? [rowKey("t1"), rowKey("t2")],
        hasMore: options?.hasMore?.[index] ?? false,
      };
    }),
    judge: vi.fn(async () => ({
      columns: [],
      rows: (options?.judgedCells ?? [0.9, 0.1]).map((cell, index) => ({
        TraceId: `t${index + 1}`,
        annoyed: cell,
      })),
      usage: {
        requests: 2,
        inputTokens: 1_200,
        skipped: options?.skipped ?? {},
      },
    })),
    texts: vi.fn(async () => options?.texts ?? []),
  };

  const executor = createInstantEvalRunExecutor({
    runs: {
      create: vi.fn(),
      list: vi.fn(),
      findById: vi.fn(async () => ({
        id: RUN_ID,
        projectId: PROJECT_ID,
        sql: "SELECT TraceId, eval(conversation(ConversationId), 'x') AS annoyed FROM analytics.traces",
        parameters: {},
        questions: JSON.parse(JSON.stringify(questions)) as unknown,
        plan: JSON.parse(JSON.stringify(calls)) as unknown,
        rowLimit: options?.rowLimit ?? 10_000,
      })),
    } as never,
    judgments: {
      insert: vi.fn(async (records: readonly InstantEvalJudgmentRecord[]) => {
        inserted.push([...records]);
      }),
      page: vi.fn(),
    },
    rowSource,
    classifier: () => new NullInstantEvalClassifier(),
    costRecorder: {
      recordCost: vi.fn(async (record: InstantEvalCostRecord) => {
        costs.push(record);
        return "cost_1";
      }),
    },
    projectKey: async () => "lwql-secret",
    maxConcurrency: 4,
    protections: async () => ({}) as never,
    isCancelled: async () => options?.isCancelled === true,
    now: () => NOW,
  });

  return { executor, rowSource, inserted, costs };
}

describe("given a run about to be planned", () => {
  describe("when the plan pass runs", () => {
    /** @scenario "Pass one runs with the row cap raised by one so a capped run can say so" */
    it("reads the keys bounded by the run's own limit", async () => {
      const { executor, rowSource } = fakes({ rowLimit: 10_000 });

      await executor.plan({ runId: RUN_ID, projectId: PROJECT_ID });

      expect(rowSource.keys).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10_000 }),
      );
    });

    /** @scenario "Pass one makes no judgement" */
    it("judges nothing", async () => {
      const { executor, rowSource } = fakes();

      await executor.plan({ runId: RUN_ID, projectId: PROJECT_ID });

      expect(rowSource.judge).not.toHaveBeenCalled();
    });

    it("reports the total it found", async () => {
      const { executor } = fakes({
        keys: [[rowKey("t1"), rowKey("t2"), rowKey("t3")]],
      });

      const plan = await executor.plan({
        runId: RUN_ID,
        projectId: PROJECT_ID,
      });

      expect(plan).toMatchObject({ total: 3, isCapped: false });
    });

    /** @scenario "An estimate over more rows than the cap reports the cap it was bounded to" */
    it("says so when the statement matched more rows than the run may judge", async () => {
      const { executor } = fakes({ hasMore: [true] });

      const plan = await executor.plan({
        runId: RUN_ID,
        projectId: PROJECT_ID,
      });

      expect(plan.isCapped).toBe(true);
    });

    /** @scenario "The average token count comes from a sample rather than from every row" */
    it("measures at most fifty rows of text", async () => {
      const { executor, rowSource } = fakes({
        keys: [Array.from({ length: 120 }, (_, index) => rowKey(`t${index}`))],
      });

      await executor.plan({ runId: RUN_ID, projectId: PROJECT_ID });

      expect(rowSource.texts).toHaveBeenCalledWith(
        expect.objectContaining({
          traceIds: expect.arrayContaining([]) as unknown as string[],
        }),
      );
      const call = (rowSource.texts as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as { traceIds: string[] };
      expect(call.traceIds).toHaveLength(50);
    });
  });
});

describe("given a page of a run", () => {
  describe("when it is judged", () => {
    /** @scenario "One judgement row is written per trace and question" */
    it("writes one judgement per trace and question", async () => {
      const { executor, inserted } = fakes();

      await executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        pageSize: 500,
        remaining: 1_000,
        keyColumns: ["ThreadId"],
      });

      expect(inserted[0]).toHaveLength(2);
      expect(inserted[0]?.map((record) => record.TraceId)).toEqual([
        "t1",
        "t2",
      ]);
    });

    it("reports the cursor the page ended on", async () => {
      const { executor } = fakes();

      const outcome = await executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        pageSize: 500,
        remaining: 1_000,
        keyColumns: [],
      });

      expect(outcome.cursor).toBe("t2");
    });

    it("says there is more only when the keys say so and rows remain", async () => {
      const withMore = fakes({ hasMore: [true] });
      const exhausted = fakes({ hasMore: [true] });

      const more = await withMore.executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        pageSize: 500,
        remaining: 1_000,
        keyColumns: [],
      });
      const last = await exhausted.executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        pageSize: 500,
        remaining: 2,
        keyColumns: [],
      });

      expect(more.hasNextPage).toBe(true);
      expect(last.hasNextPage).toBe(false);
    });

    it("carries what the judging spent", async () => {
      const { executor } = fakes();

      const outcome = await executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        pageSize: 500,
        remaining: 1_000,
        keyColumns: [],
      });

      expect(outcome).toMatchObject({ inputTokens: 1_200, requests: 2 });
    });
  });

  describe("when the deployment has no classifier configured", () => {
    /** @scenario "A page that partly failed is recorded with its failures counted" */
    it("records the page with its skips rather than throwing", async () => {
      const { executor, inserted } = fakes({
        judgedCells: [null, null],
        skipped: { classifier_not_configured: 2 },
      });

      const outcome = await executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        pageSize: 500,
        remaining: 1_000,
        keyColumns: [],
      });

      expect(outcome).toMatchObject({ rows: 2, skipped: 2, failed: 0 });
      expect(inserted[0]?.every((record) => record.Status === "skipped")).toBe(
        true,
      );
    });
  });

  describe("when most of the page could not be judged", () => {
    /** @scenario "A page that mostly failed is thrown so the queue delivers it again" */
    it("throws before writing anything", async () => {
      const { executor, inserted } = fakes({
        judgedCells: [null, null],
        skipped: { classifier_failed: 2 },
      });

      await expect(
        executor.judgePage({
          runId: RUN_ID,
          projectId: PROJECT_ID,
          page: 3,
          afterTraceId: "t0",
          pageSize: 500,
          remaining: 1_000,
          keyColumns: [],
        }),
      ).rejects.toThrow(/page 3/);
      expect(inserted).toEqual([]);
    });
  });

  describe("when the run has been asked to stop", () => {
    /** @scenario "A cancelled run stops between pages" */
    it("judges nothing and reports an empty page", async () => {
      const { executor, rowSource } = fakes({ isCancelled: true });

      const outcome = await executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 2,
        afterTraceId: "t500",
        pageSize: 500,
        remaining: 500,
        keyColumns: [],
      });

      expect(rowSource.judge).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ rows: 0, hasNextPage: false });
    });
  });
});

describe("given a run that is finishing", () => {
  describe("when it judged something", () => {
    /** @scenario "A finished run records what it cost in one row" */
    it("records one cost row against the run", async () => {
      const { executor, costs } = fakes();

      const spend = await executor.finish({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        outcome: "finished",
        inputTokens: 2_000_000,
        requests: 1_000,
      });

      expect(costs).toHaveLength(1);
      expect(costs[0]).toMatchObject({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        inputTokens: 2_000_000,
        requests: 1_000,
      });
      expect(spend.costUsd).toBeCloseTo(0.084, 6);
      expect(spend.priceUsd).toBeCloseTo(0.1092, 6);
    });
  });

  describe("when it judged nothing", () => {
    /** @scenario "A run that judged nothing writes no cost row" */
    it("writes no cost row", async () => {
      const { executor, costs } = fakes();

      await executor.finish({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        outcome: "finished",
        inputTokens: 0,
        requests: 0,
      });

      expect(costs).toEqual([]);
    });
  });

  describe("when the cost row cannot be written", () => {
    /** @scenario "A cost that cannot be written does not fail the run" */
    it("still finishes the run", async () => {
      const { executor } = fakes();
      const failing = createInstantEvalRunExecutor({
        runs: { create: vi.fn(), list: vi.fn(), findById: vi.fn() } as never,
        judgments: { insert: vi.fn(), page: vi.fn() },
        rowSource: {} as InstantEvalRowSource,
        classifier: () => new NullInstantEvalClassifier(),
        costRecorder: {
          recordCost: async () => {
            throw new Error("cost table unavailable");
          },
        },
        projectKey: async () => "lwql-secret",
        maxConcurrency: 4,
        protections: async () => ({}) as never,
        now: () => NOW,
      });
      void executor;

      await expect(
        failing.finish({
          runId: RUN_ID,
          projectId: PROJECT_ID,
          outcome: "finished",
          inputTokens: 1_000,
          requests: 1,
        }),
      ).resolves.toMatchObject({ costUsd: expect.any(Number) as number });
    });
  });
});

describe("given a sample of a page's texts", () => {
  describe("when the page size is chosen from them", () => {
    /** @scenario "A page of large texts is smaller than a page of small ones" */
    it("cuts the page to a fifth past the large-text mark", () => {
      expect(instantEvalPageSizeFor(1_000)).toBe(INSTANT_EVAL_PAGE_SIZE);
      expect(instantEvalPageSizeFor(INSTANT_EVAL_LARGE_TEXT_BYTES + 1)).toBe(
        INSTANT_EVAL_SMALL_PAGE_SIZE,
      );
    });
  });

  describe("when their average size is measured", () => {
    it("counts only the judged columns", () => {
      const average = instantEvalAverageTextBytes({
        rows: [
          { annoyed: "12345678", other: "ignored because it asks nothing" },
          { annoyed: "1234" },
        ],
        questionIds: ["annoyed"],
      });

      expect(average).toBe(6);
    });

    it("reports nothing when no column held text", () => {
      expect(
        instantEvalAverageTextBytes({
          rows: [{ annoyed: null }],
          questionIds: ["annoyed"],
        }),
      ).toBe(0);
    });
  });
});

describe("given the hydration plan stored on a run", () => {
  describe("when it is read back", () => {
    it("returns the calls the validator recorded", () => {
      expect(
        instantEvalHydrationPlan(JSON.parse(JSON.stringify(calls))),
      ).toEqual(calls);
    });

    it("drops an entry that is not a call", () => {
      expect(
        instantEvalHydrationPlan([{ column: "x" }, null, "nonsense"]),
      ).toEqual([]);
    });

    it("returns nothing for a column that is not a list", () => {
      expect(instantEvalHydrationPlan({ not: "a list" })).toEqual([]);
    });
  });
});
