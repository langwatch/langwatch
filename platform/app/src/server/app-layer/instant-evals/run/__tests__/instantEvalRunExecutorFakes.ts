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
import { createInstantEvalRunExecutor } from "../instant-eval-run.executor";
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

export function fakes(options?: {
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
    inFlightUsd: number;
  }) => Promise<void>;
}) {
  const inserted: InstantEvalJudgmentRecord[][] = [];
  const spends: InstantEvalSpendRecord[] = [];
  let keyCall = 0;

  const rowSource: InstantEvalRowSource = {
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
    judgePrepared: vi.fn(async (): Promise<InstantEvalJudgedPage> => judged()),
    judge: vi.fn(async () => judged()),
    texts: vi.fn(async () => options?.texts ?? []),
  };
  function judged(): InstantEvalJudgedPage {
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
    spendRecorder: {
      recordSpend: vi.fn(async (record: InstantEvalSpendRecord) => {
        spends.push(record);
      }),
    },
    projectKey: async () => "lwql-secret",
    maxConcurrency: 4,
    protections: async () => ({}) as never,
    isCancelled: async () => options?.isCancelled === true,
    ...(options?.assertWithinBudget
      ? { assertWithinBudget: options.assertWithinBudget }
      : {}),
    now: () => NOW,
  });

  return { executor, rowSource, inserted, spends };
}
