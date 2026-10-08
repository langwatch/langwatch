/**
 * The synchronous query judges its eval columns through instant-eval once hydration left their
 * text in place (Alex, 2026-10-06, "Judge cycle"). Ported from main's instantEvalQueries suite;
 * the judging itself is instant-eval's and is proven there.
 * @see specs/lwql/eval-functions.feature
 * @see specs/lwql/app-functions.feature
 */
import type { LangWatchQLColumn } from "@langwatch/analytics-contract";
import {
  computeInstantEvalTranscriptFit,
  type InstantEvalApi,
  type InstantEvalQueryJudging,
} from "@langwatch/instant-eval-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import {
  LangWatchQLHydrationComputeService,
  type LangWatchQLTraceRenderer,
} from "../langwatch-ql-hydration-compute.service.ts";
import {
  LangWatchQLHydrationReadService,
  type LangWatchQLTraceSource,
} from "../langwatch-ql-hydration-read.service.ts";
import { LangWatchQLHydrationService } from "../langwatch-ql-hydration.service.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const TRANSCRIPT = "### the transcript";

const EVERYTHING_VISIBLE = {
  catalogue: EVERY_CATALOGUE_PERMISSION,
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

const ANNOYED_QUERY =
  "SELECT TraceId, eval(conversation(ConversationId), 'The customer sounds annoyed') AS annoyed " +
  "FROM analytics.trace_metrics";

type JudgeQuery = InstantEvalApi["judgeQuery"];

/** A judge with a small state, so a conversation past it stays a few kilobytes. */
const JUDGE_LIMITS: ReturnType<InstantEvalApi["getJudgeLimits"]> = {
  stateTokens: 1_000,
  totalTokens: 2_000,
  maxCategoryOptions: 255,
  maxScoreLevels: 10,
  reserveTokens: 100,
  bytesPerInputToken: 2.7,
  fitBytesPerInputToken: 2,
  transcriptFitBytesPerInputToken: 2.4,
  retryBytesPerInputToken: 1.5,
};

/** The fit the annoyed question leaves under {@link JUDGE_LIMITS}. */
const ANNOYED_FIT = computeInstantEvalTranscriptFit({
  judgements: [
    {
      column: "annoyed",
      function: "eval",
      reads: "probability",
      kind: "boolean",
      instructions: "The customer sounds annoyed",
    },
  ],
  limits: JUDGE_LIMITS,
});

/** Renders the whole thread as `transcript`, and a bounded one keeping both ends. */
function threadRenderer(transcript: string) {
  const budgets: number[] = [];
  const rendering: LangWatchQLTraceRenderer = {
    ...renderer,
    renderThreadTranscript: async ({ maxTokens }) => {
      if (maxTokens === undefined) return transcript;
      budgets.push(maxTokens);

      return "## opening\n\n[... 40 turns omitted ...]\n\n## close";
    },
  };

  return { rendering, budgets };
}

function trace({ id, threadId }: { id: string; threadId: string }): Trace {
  return {
    trace_id: id,
    project_id: "project-1",
    metadata: { thread_id: threadId },
    timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
    spans: [],
  };
}

const renderer: LangWatchQLTraceRenderer = {
  renderThreadTranscript: async () => TRANSCRIPT,
  renderReadableTrace: async () => "the digest",
  renderTraceMessages: async () => "{}",
  renderSpanMessages: async () => ({ isSpanPresent: true, json: "{}" }),
  renderTraceJson: async () => "{}",
};

/** Holds every conversation it is asked for, and counts the reads. */
class CountingTraceSource implements LangWatchQLTraceSource {
  reads = 0;

  async readTraces(): Promise<readonly Trace[]> {
    this.reads += 1;

    return [];
  }

  async readThreadTraces({
    threadKeys,
  }: {
    threadKeys: readonly string[];
  }): Promise<readonly Trace[]> {
    this.reads += 1;

    return threadKeys.map((key) => trace({ id: `trace-${key}`, threadId: key }));
  }
}

/** Answers one column of keys or texts, as the identity UDF leaves them. */
class ColumnAnsweringExecutor extends LangWatchQLExecutorRepository {
  constructor(
    private readonly column: string,
    private readonly values: readonly string[],
  ) {
    super();
  }

  execute(_request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    const rows = this.values.map((value) => ({
      TraceId: `trace-of-${value}`,
      [this.column]: value,
    }));
    const columns: LangWatchQLColumn[] = [
      { name: "TraceId", type: "String" },
      { name: this.column, type: "String" },
    ];

    return Promise.resolve({
      columns,
      rows,
      statistics: { elapsedMs: 1, rowsRead: 10, bytesRead: 10, rowsReturned: rows.length },
    });
  }
}

function serviceOver({
  column = "annoyed",
  values = ["thread-a"],
  judgeQuery,
  stopwatch,
  rendering = renderer,
}: {
  column?: string;
  values?: readonly string[];
  judgeQuery?: JudgeQuery;
  stopwatch?: () => number;
  rendering?: LangWatchQLTraceRenderer;
}) {
  const traces = new CountingTraceSource();
  const asked: Parameters<JudgeQuery>[0][] = [];
  const judging = createApiFixture<InstantEvalApi>(
    judgeQuery
      ? {
          judgeQuery: (input) => {
            asked.push(input);

            return judgeQuery(input);
          },
          getJudgeLimits: () => JUDGE_LIMITS,
        }
      : {},
  );
  const hydration = LangWatchQLHydrationService.create({
    reads: LangWatchQLHydrationReadService.create({ traces }),
    compute: LangWatchQLHydrationComputeService.create({ renderer: rendering }),
    runner: {
      executeLangWatchQLPass: () => Promise.reject(new Error("the sync path reads no pass")),
    },
  });
  const service = LangWatchQLService.create({
    executor: new ColumnAnsweringExecutor(column, values),
    database: "analytics",
    hydration,
    judging,
    ...(stopwatch ? { stopwatch } : {}),
  });

  return { service, traces, asked };
}

function query({
  service,
  sql,
  signal,
}: {
  service: LangWatchQLService;
  sql: string;
  signal?: AbortSignal;
}) {
  return service.executeForProjects({
    projects: [{ id: "project-1", lwqlKey: "key-1" }],
    protections: EVERYTHING_VISIBLE,
    sql,
    isInstantEvalsEnabled: true,
    ...(signal ? { signal } : {}),
  });
}

/** Answers every judged cell with one value, as instant-eval fills a verdict. */
function answering(value: unknown): JudgeQuery {
  return async ({ rows, judgements }) => ({
    rows: rows.map((row) => ({
      ...row,
      ...Object.fromEntries(judgements.map((judgement) => [judgement.column, value])),
    })),
    skipped: {},
  });
}

describe("LangWatchQLService with an eval function", () => {
  describe("when the conversation is judged", () => {
    /** @scenario "The judged column carries the probability, not the conversation key" */
    it("asks about the rendered conversation and answers the verdict, typed as a probability", async () => {
      const { service, asked } = serviceOver({ judgeQuery: answering(0.9) });

      const result = await query({ service, sql: ANNOYED_QUERY });

      expect(asked[0]?.projectId).toBe("project-1");
      expect(asked[0]?.rows).toEqual([{ TraceId: "trace-of-thread-a", annoyed: TRANSCRIPT }]);
      expect(result.rows).toEqual([{ TraceId: "trace-of-thread-a", annoyed: 0.9 }]);
      expect(result.columns.find((column) => column.name === "annoyed")?.type).toBe(
        "Nullable(Float64)",
      );
    });
  });

  describe("when the conversation is past the judge's budget", () => {
    /** @scenario "A conversation past the judge's budget is cut through the bounded renderer, keeping both ends" */
    it("sends the bounded rendering under the judge's budget and reports the cell truncated", async () => {
      const { rendering, budgets } = threadRenderer("## opening\n\n" + "turn ".repeat(4_000));
      const { service, asked } = serviceOver({ judgeQuery: answering(0.7), rendering });

      const result = await query({ service, sql: ANNOYED_QUERY });

      expect(budgets).toEqual([ANNOYED_FIT?.renderTokens]);
      const sent = String(asked[0]?.rows[0]?.annoyed);
      expect(sent).toContain("## opening");
      expect(sent).toContain("## close");
      expect(sent).toContain("40 turns omitted");
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "APP_FUNCTION_VALUE_TRUNCATED",
          meta: { columns: [{ column: "annoyed", function: "conversation", values: 1 }] },
        }),
      );
    });
  });

  describe("when the conversation fits four bytes a token but not the judge's ratio", () => {
    /** @scenario "A conversation over the judge's budget is measured with the judge's own ratio" */
    it("re-renders it under the judge's budget and reports the row truncated", async () => {
      const bytes = (ANNOYED_FIT?.maxBytes ?? 0) + 100;
      expect(bytes).toBeLessThan(((ANNOYED_FIT?.maxBytes ?? 0) / 2.4) * 4);
      const { rendering, budgets } = threadRenderer("x".repeat(bytes));
      const { service } = serviceOver({ judgeQuery: answering(0.2), rendering });

      const result = await query({ service, sql: ANNOYED_QUERY });

      expect(budgets).toHaveLength(1);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "APP_FUNCTION_VALUE_TRUNCATED",
      );
    });
  });

  describe("when the conversation is inside the judge's budget", () => {
    /** @scenario "A conversation inside the judge's budget is sent whole and not marked truncated" */
    it("sends the whole conversation and reports nothing truncated", async () => {
      const { rendering, budgets } = threadRenderer(TRANSCRIPT);
      const { service, asked } = serviceOver({ judgeQuery: answering(0.1), rendering });

      const result = await query({ service, sql: ANNOYED_QUERY });

      expect(budgets).toEqual([]);
      expect(asked[0]?.rows[0]?.annoyed).toBe(TRANSCRIPT);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
        "APP_FUNCTION_VALUE_TRUNCATED",
      );
    });
  });

  describe("when the eval reads a plain column", () => {
    /** @scenario "An eval over a plain column is judged on the column's own text and reads no trace" */
    it("asks about the column's own text and reads no trace", async () => {
      const { service, asked, traces } = serviceOver({
        column: "apology",
        values: ["Sorry about that"],
        judgeQuery: answering(0.4),
      });

      await query({
        service,
        sql:
          "SELECT TraceId, eval(CapturedOutput, 'The answer is an apology') AS apology " +
          "FROM analytics.traces WHERE OccurredAt >= subtractDays(now(), 1)",
      });

      expect(asked[0]?.rows).toEqual([
        { TraceId: "trace-of-Sorry about that", apology: "Sorry about that" },
      ]);
      expect(traces.reads).toBe(0);
    });
  });

  describe("when the judge skipped one text of two", () => {
    /** @scenario "A row the classifier could not judge is skipped rather than guessed" */
    /** @scenario "A text the classifier failed on is skipped, not reported as a missing key" */
    it("reports INSTANT_EVAL_SKIPPED naming the reason, and no unresolved key", async () => {
      const { service } = serviceOver({
        values: ["thread-a", "thread-b"],
        judgeQuery: async ({ rows }) => ({
          rows: rows.map((row, at) => ({ ...row, annoyed: at === 0 ? 0.8 : null })),
          skipped: { classifier_failed: 1 },
        }),
      });

      const result = await query({ service, sql: ANNOYED_QUERY });

      expect(result.rows.map((row) => row.annoyed)).toEqual([0.8, null]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "INSTANT_EVAL_SKIPPED",
          meta: { texts: 1, reasons: { classifier_failed: 1 } },
        }),
      );
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
        "APP_FUNCTION_UNRESOLVED_KEYS",
      );
    });
  });

  describe("when the statement calls no eval function", () => {
    /** @scenario "A statement that judges nothing resolves no gate and builds no classifier" */
    it("never asks instant-eval to judge", async () => {
      const { service, asked } = serviceOver({ column: "transcript" });

      const result = await query({
        service,
        sql: "SELECT TraceId, conversation(ConversationId) AS transcript FROM analytics.trace_metrics",
      });

      expect(asked).toEqual([]);
      expect(result.rows).toEqual([{ TraceId: "trace-of-thread-a", transcript: TRANSCRIPT }]);
    });
  });

  describe("when the caller cancels while the query judges", () => {
    /** @scenario "A cancelled query stops judging instead of paying out the rest" */
    it("fails as cancelled rather than answering with null columns", async () => {
      const controller = new AbortController();
      const cancelled: InstantEvalQueryJudging = {
        rows: [{ TraceId: "trace-of-thread-a", annoyed: null }],
        skipped: {},
        cancellation: { unjudgedRows: [0] },
      };
      const { service } = serviceOver({
        judgeQuery: async () => {
          controller.abort(new DOMException("the caller hung up", "AbortError"));

          return cancelled;
        },
      });

      const refusal = await query({ service, sql: ANNOYED_QUERY, signal: controller.signal }).catch(
        (error: unknown) => error,
      );

      expect((refusal as Error).name).toBe("AbortError");
    });
  });

  describe("when judging takes longer than the database read", () => {
    /** @scenario "A judged query reports the time its judging took" */
    it("reports an elapsed time covering the read and the judging", async () => {
      let clock = 0;
      const { service } = serviceOver({
        stopwatch: () => clock,
        judgeQuery: async (input) => {
          clock += 2_500;

          return answering(0.9)(input);
        },
      });

      const result = await query({ service, sql: ANNOYED_QUERY });

      expect(result.statistics.elapsedMs).toBe(2_501);
    });
  });
});
