/**
 * Shared fakes for the Instant Eval run executor suites: a fake row source, the
 * shipped null classifier, a recording spend recorder, and the run row the
 * executor reads its statement from.
 *
 * Not a suite itself, so vitest does not collect it.
 *
 * @see ../instant-eval-run.executor.ts
 */

import { vi } from "vitest";

import type { LangWatchQLAppFunctionCall } from "~/server/analytics/lwql";
import { NullInstantEvalClassifier } from "../../classifier/null.client";
import type { InstantEvalSpendRecord } from "../../instant-eval-spend.recorder";
import {
  createInstantEvalRunExecutor,
  type InstantEvalRunExecutorDependencies,
} from "../instant-eval-run.executor";
import type { InstantEvalJudgmentRecord } from "../judgments";
import { instantEvalRunQuestions } from "../questions";
import type {
  InstantEvalJudgedPage,
  InstantEvalPreparedPage,
  InstantEvalRowKey,
  InstantEvalRowSource,
} from "../row-source";

export const PROJECT_ID = "project-1";
export const RUN_ID = "instanteval_1";
export const NOW = 1_758_000_000_000;

export const calls: LangWatchQLAppFunctionCall[] = [
  {
    column: "annoyed",
    function: "eval",
    options: ["The customer sounds annoyed"],
    source: { function: "conversation_bounded", options: [8000, ""] },
  },
];

export const questions = instantEvalRunQuestions(calls);

export function rowKey(traceId: string): InstantEvalRowKey {
  return {
    traceId,
    threadId: `thread-${traceId}`,
    spanId: "",
    occurredAt: NOW - 1_000,
  };
}

/** What a suite varies about the run it drives. */
export interface InstantEvalFakeOptions {
  keys?: InstantEvalRowKey[][];
  hasMore?: boolean[];
  judgedCells?: (unknown | null)[];
  skipped?: Record<string, number>;
  isCancelled?: boolean;
  rowLimit?: number;
  texts?: Record<string, unknown>[];
  /** What the count pass answers, which is what a plan's total comes from. */
  total?: number;
  /** Input tokens the run row already carries, which is its spend so far. */
  tokens?: number;
  /** Refuses the next page, standing in for an exhausted free budget. */
  assertWithinBudget?: (input: {
    projectId: string;
    runId: string;
    inFlightUsd: number;
  }) => Promise<void>;
  /** Records the run's hold being let go, once its spend is recorded. */
  releaseBudget?: (input: {
    projectId: string;
    runId: string;
  }) => Promise<void>;
  /**
   * Makes the judged page stop part way, naming the rows left unjudged.
   * With `onSignal`, the page waits for the executor's signal to fire first,
   * the way a deadline or a cancel reaches a page still judging.
   */
  stopMidPage?: { unjudgedRows: number[]; onSignal?: boolean };
}

export function fakes(options?: InstantEvalFakeOptions) {
  const inserted: InstantEvalJudgmentRecord[][] = [];
  const spends: InstantEvalSpendRecord[] = [];
  const recordSpend = vi.fn(async (record: InstantEvalSpendRecord) => {
    spends.push(record);
  });
  const rowSource = fakeRowSource(options);
  const executor = createInstantEvalRunExecutor(
    fakeDependencies({ options, rowSource, inserted, recordSpend }),
  );
  return { executor, rowSource, inserted, spends, recordSpend };
}

/** The page every read of this row source hands back. */
function judgedPage(options?: InstantEvalFakeOptions): InstantEvalJudgedPage {
  return {
    columns: [],
    rows: (options?.judgedCells ?? [0.9, 0.1]).map((cell, index) => ({
      TraceId: `t${index + 1}`,
      annoyed: cell,
    })),
    usage: {
      requests: 2,
      inputTokens: 1_200,
      skipped: options?.skipped ?? {},
      limiterWaitMs: 0,
    },
    timings: { queryMs: 0, readMs: 0, computeMs: 0, judgeMs: 0 },
  };
}

/** The four reads and the judging, answered from the suite's own options. */
function fakeRowSource(options?: InstantEvalFakeOptions): InstantEvalRowSource {
  let keyCall = 0;
  return {
    probe: vi.fn(async () => [
      { name: "TraceId", type: "String" },
      { name: "ThreadId", type: "String" },
      { name: "annoyed", type: "Nullable(String)" },
    ]),
    count: vi.fn(async () => options?.total ?? 2),
    keys: vi.fn(async () => {
      const index = keyCall++;
      return {
        keys: options?.keys?.[index] ?? [rowKey("t1"), rowKey("t2")],
        hasMore: options?.hasMore?.[index] ?? false,
      };
    }),
    sampleKeys: vi.fn(
      async () => options?.keys?.[0] ?? [rowKey("t1"), rowKey("t2")],
    ),
    read: vi.fn(
      async ({ keys }): Promise<InstantEvalPreparedPage> => ({
        rows: keys.length,
        queryMs: 0,
        hydration: { keys } as unknown as InstantEvalPreparedPage["hydration"],
      }),
    ),
    judgePrepared: vi.fn(async ({ signal }): Promise<InstantEvalJudgedPage> => {
      const stop = options?.stopMidPage;
      if (!stop) return judgedPage(options);
      if (stop.onSignal) {
        // A page that waits on the signal needs one: without it the fake
        // would answer at once and a test could pass with the executor never
        // handing its signal down.
        if (!signal) {
          throw new Error(
            "the fake page was told to stop on the signal, but the executor passed none",
          );
        }
        if (!signal.aborted) {
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        }
      }
      // A row the stop reached has no verdict, the same null a declined
      // judgement leaves, which is why the page has to name it.
      const page = judgedPage(options);
      return {
        ...page,
        rows: page.rows.map((row, index) =>
          stop.unjudgedRows.includes(index) ? { ...row, annoyed: null } : row,
        ),
        cancellation: { unjudgedRows: stop.unjudgedRows },
      };
    }),
    judge: vi.fn(async () => judgedPage(options)),
    texts: vi.fn(async () => options?.texts ?? []),
  };
}

/** The run row, the two stores, and the budget hooks the executor is given. */
function fakeDependencies({
  options,
  rowSource,
  inserted,
  recordSpend,
}: {
  options?: InstantEvalFakeOptions;
  rowSource: InstantEvalRowSource;
  inserted: InstantEvalJudgmentRecord[][];
  recordSpend: (record: InstantEvalSpendRecord) => Promise<void>;
}): InstantEvalRunExecutorDependencies {
  return {
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
        tokens: options?.tokens ?? 0,
      })),
    } as never,
    judgments: {
      insert: vi.fn(async (records: readonly InstantEvalJudgmentRecord[]) => {
        inserted.push([...records]);
      }),
      page: vi.fn(),
      sample: vi.fn(),
    },
    rowSource,
    classifier: () => new NullInstantEvalClassifier(),
    spendRecorder: { recordSpend },
    projectKey: async () => "lwql-secret",
    maxConcurrency: 4,
    protections: async () => ({}) as never,
    isCancelled: async () => options?.isCancelled === true,
    ...(options?.assertWithinBudget
      ? { assertWithinBudget: options.assertWithinBudget }
      : {}),
    ...(options?.releaseBudget ? { releaseBudget: options.releaseBudget } : {}),
    now: () => NOW,
  };
}
