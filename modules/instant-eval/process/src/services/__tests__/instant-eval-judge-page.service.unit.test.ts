/**
 * Judging one page: what it sends, what it writes, and where it says the next
 * page starts — including when a stop reaches it part way.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  InstantEvalClassifierUnavailableError,
  InstantEvalFreeBudgetExhaustedError,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { instantEvalRunRow } from "../../__tests__/instant-eval.fixtures.ts";
import type { InstantEvalCancellationChannel } from "../../channels/instant-eval-cancellation.channel.ts";
import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
} from "../../channels/instant-eval-judge.channel.ts";
import type { InstantEvalJudgmentRecord } from "../../repositories/instant-eval-judgments.repository.ts";
import { MemoryInstantEvalRunRepository } from "../../repositories/memory/memory.instant-eval-run.repository.ts";
import {
  INSTANT_EVAL_CANCEL_POLL_MS,
  INSTANT_EVAL_PAGE_SETTLE_MS,
} from "../../rules/instant-eval-page-stop.rules.ts";
import { INSTANT_EVAL_PRICING } from "../../rules/instant-eval-pricing.rules.ts";
import type {
  InstantEvalKeyPage,
  InstantEvalRowKey,
} from "../../rules/instant-eval-row-keys.rules.ts";
import type { InstantEvalTextSource } from "../instant-eval-estimate.service.ts";
import { InstantEvalJudgePageService } from "../instant-eval-judge-page.service.ts";
import type { InstantEvalRowSourceService } from "../instant-eval-row-source.service.ts";
import { InstantEvalRunContextService } from "../instant-eval-run-context.service.ts";

const PROJECT_ID = "project-1";
const RUN_ID = "run-1";
const AT = Temporal.Instant.from("2026-09-18T10:00:00Z");
const PROTECTIONS = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as const;

const QUESTION = {
  id: "annoyed",
  function: "eval_boolean",
  kind: "boolean",
  reads: "probability",
  question: { id: "annoyed", kind: "boolean", instructions: "was the customer annoyed?" },
};

const SECOND_QUESTION = {
  ...QUESTION,
  id: "polite",
  question: { id: "polite", kind: "boolean", instructions: "was the agent polite?" },
};

const INPUT = {
  runId: RUN_ID,
  projectId: PROJECT_ID,
  page: 0,
  afterTraceId: null,
  afterSpanId: null,
  pageSize: 500,
  remaining: 1_000,
  keyColumns: [] as readonly string[],
  deadlineAt: null,
};

function rowKey(traceId: string, spanId = ""): InstantEvalRowKey {
  return { traceId, threadId: "thread-1", spanId, occurredAt: null };
}

/** The key pass, answering one fixed page and recording what it was asked. */
class ScriptedKeys implements Pick<InstantEvalRowSourceService, "keys"> {
  readonly asked: { limit: number }[] = [];

  constructor(private readonly page: InstantEvalKeyPage) {}

  async keys(input: { limit: number }): Promise<InstantEvalKeyPage> {
    this.asked.push({ limit: input.limit });

    return this.page;
  }
}

/** The extraction half, answering the page's rows with their texts in place. */
class ScriptedTexts implements InstantEvalTextSource {
  readonly asked: string[][] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async texts(input: { traceIds: readonly string[] }): Promise<readonly Record<string, unknown>[]> {
    this.asked.push([...input.traceIds]);

    return this.rows;
  }
}

type Answer = (input: {
  request: InstantEvalClassifyRequest;
  index: number;
  signal?: AbortSignal;
}) => Promise<InstantEvalJudgement>;

/** The judge, answering per request so a test can fail or hang one of them. */
class ScriptedJudge implements InstantEvalJudgeChannel {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;
  readonly requests: InstantEvalClassifyRequest[] = [];

  constructor(private readonly answer: Answer) {}

  async classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    const index = this.requests.length;
    this.requests.push(request);

    return this.answer({ request, index, ...(signal ? { signal } : {}) });
  }
}

/** The judgements written, kept as they were handed over. */
class CapturedJudgments {
  readonly written: InstantEvalJudgmentRecord[][] = [];

  constructor(private readonly onInsert?: () => void) {}

  async insert(records: readonly InstantEvalJudgmentRecord[]): Promise<void> {
    this.onInsert?.();
    this.written.push([...records]);
  }
}

/** A cancel nobody has asked for until a test asks for it. */
class ScriptedCancellation implements InstantEvalCancellationChannel {
  isCancelled = false;
  reads = 0;

  async request(): Promise<void> {
    this.isCancelled = true;
  }

  async isRequested(): Promise<boolean> {
    this.reads += 1;

    return this.isCancelled;
  }
}

function judged(probability: number, inputTokens = 100): InstantEvalJudgement {
  return {
    verdicts: [{ questionId: "annoyed", probability }],
    inputTokens,
    isTextTruncated: false,
  };
}

async function judging({
  keyPage,
  rows,
  answer = async () => judged(0.9),
  questions = [QUESTION],
  cancellation = new ScriptedCancellation(),
  concurrency = 4,
  now = () => AT.epochMilliseconds,
  assertWithinBudget = async () => undefined,
  onInsert,
}: {
  keyPage: InstantEvalKeyPage;
  rows: readonly Record<string, unknown>[];
  answer?: Answer;
  cancellation?: ScriptedCancellation;
  questions?: readonly (typeof QUESTION)[];
  concurrency?: number;
  now?: () => number;
  assertWithinBudget?: () => Promise<undefined>;
  onInsert?: () => void;
}): Promise<{
  service: InstantEvalJudgePageService;
  judge: ScriptedJudge;
  judgments: CapturedJudgments;
  texts: ScriptedTexts;
  cancellation: ScriptedCancellation;
}> {
  const runs = MemoryInstantEvalRunRepository.create(() => AT);
  await runs.write(
    instantEvalRunRow({
      id: RUN_ID,
      projectId: PROJECT_ID,
      questions,
      plan: questions.map((question) => ({
        column: question.id,
        function: "eval_boolean",
        options: [],
      })),
      tokens: 0,
    }),
  );
  const judge = new ScriptedJudge(answer);
  const judgments = new CapturedJudgments(onInsert);
  const texts = new ScriptedTexts(rows);

  return {
    service: InstantEvalJudgePageService.create({
      context: InstantEvalRunContextService.create({
        runs,
        peers: {
          findProjectCaller: async () => ({ id: PROJECT_ID, lwqlKey: "key-1" }),
          resolveProjectProtections: async () => PROTECTIONS,
          isQueryIdentityAvailable: () => true,
        },
      }),
      rowSource: new ScriptedKeys(keyPage),
      textSource: texts,
      judge,
      judgments,
      cancellation,
      budget: { assertWithinBudget },
      concurrency,
      now,
    }),
    judge,
    judgments,
    texts,
    cancellation,
  };
}

describe("given a page of rows whose texts were extracted", () => {
  describe("when it is judged", () => {
    it("writes one judgement per row and question, and reports the page's keys", async () => {
      const { service, judgments } = await judging({
        keyPage: { keys: [rowKey("t1"), rowKey("t2")], hasMore: true },
        rows: [
          { TraceId: "t1", annoyed: "the first conversation" },
          { TraceId: "t2", annoyed: "the second conversation" },
        ],
      });

      const outcome = await service.judgePage(INPUT);

      expect(outcome).toMatchObject({
        rows: 2,
        matched: 2,
        failed: 0,
        skipped: 0,
        requests: 2,
        inputTokens: 200,
        cursor: "t2",
        cursorSpanId: null,
        hasNextPage: true,
      });
      expect(judgments.written[0]).toMatchObject([
        { TraceId: "t1", QuestionId: "annoyed", Status: "judged", Passed: 1, Probability: 0.9 },
        { TraceId: "t2", QuestionId: "annoyed", Status: "judged", Passed: 1, Probability: 0.9 },
      ]);
    });

    it("asks the extraction half only about the traces the page owns", async () => {
      const { service, texts } = await judging({
        keyPage: { keys: [rowKey("t1"), rowKey("t1")], hasMore: false },
        rows: [{ TraceId: "t1", annoyed: "one" }],
      });

      await service.judgePage(INPUT);

      expect(texts.asked).toEqual([["t1"]]);
    });

    /** @scenario "A page drops the rows of a trace it shares with the next page" */
    it("drops a neighbour's span rows before anything is judged", async () => {
      const { service, judge, judgments } = await judging({
        keyPage: { keys: [rowKey("t1", "s1")], hasMore: true },
        rows: [
          { TraceId: "t1", SpanId: "s1", annoyed: "ours" },
          { TraceId: "t1", SpanId: "s2", annoyed: "the next page's" },
        ],
      });

      await service.judgePage(INPUT);

      expect(judge.requests.map((request) => request.text)).toEqual(["ours"]);
      expect(judgments.written[0]).toHaveLength(1);
    });

    it("asks every question about one text in a single request", async () => {
      const { service, judge } = await judging({
        keyPage: { keys: [rowKey("t1")], hasMore: false },
        rows: [{ TraceId: "t1", annoyed: "one text", polite: "one text" }],
        questions: [QUESTION, SECOND_QUESTION],
      });

      await service.judgePage(INPUT);

      expect(judge.requests).toHaveLength(1);
      expect(judge.requests[0]?.questions.map((question) => question.id)).toEqual([
        "annoyed",
        "polite",
      ]);
    });
  });
});

describe("given a judge that declines every text", () => {
  describe("when the page is judged", () => {
    it("writes the rows as skipped, naming the reason it gave", async () => {
      const { service, judgments } = await judging({
        keyPage: { keys: [rowKey("t1")], hasMore: false },
        rows: [{ TraceId: "t1", annoyed: "a conversation" }],
        answer: async () => ({
          verdicts: [],
          skippedReason: "classifier_not_configured" as const,
          inputTokens: 0,
          isTextTruncated: false,
        }),
      });

      const outcome = await service.judgePage(INPUT);

      expect(outcome).toMatchObject({ rows: 1, skipped: 1, failed: 0, matched: 0 });
      expect(judgments.written[0]?.[0]).toMatchObject({
        Status: "skipped",
        Error: "classifier_not_configured",
        Probability: null,
      });
    });
  });
});

describe("given a judge that loses more than half the page", () => {
  describe("when the page is judged", () => {
    /** @scenario "A page that mostly failed is thrown so the queue delivers it again" */
    it("throws rather than recording a mostly empty page", async () => {
      const { service, judgments } = await judging({
        keyPage: { keys: [rowKey("t1"), rowKey("t2"), rowKey("t3")], hasMore: false },
        rows: [
          { TraceId: "t1", annoyed: "one" },
          { TraceId: "t2", annoyed: "two" },
          { TraceId: "t3", annoyed: "three" },
        ],
        answer: async ({ index }) => {
          if (index === 0) return judged(0.9);

          throw new Error("the judge is down");
        },
      });

      await expect(service.judgePage(INPUT)).rejects.toThrow(/lost \d+% of its judgements/);
      expect(judgments.written).toEqual([]);
    });
  });
});

describe("given a judge that answers nothing at all", () => {
  describe("when the page is judged", () => {
    it("refuses the page rather than writing one of nulls", async () => {
      const { service, judgments } = await judging({
        keyPage: { keys: [rowKey("t1")], hasMore: false },
        rows: [{ TraceId: "t1", annoyed: "one" }],
        answer: async () => {
          throw new Error("the judge is down");
        },
      });

      await expect(service.judgePage(INPUT)).rejects.toThrow(InstantEvalClassifierUnavailableError);
      expect(judgments.written).toEqual([]);
    });
  });
});

describe("given a run whose organization has spent its allowance", () => {
  describe("when the next page comes up", () => {
    it("refuses before reading anything, so a stopped run is never reported complete", async () => {
      const { service, judge, texts } = await judging({
        keyPage: { keys: [rowKey("t1")], hasMore: true },
        rows: [{ TraceId: "t1", annoyed: "one" }],
        assertWithinBudget: async () => {
          throw new InstantEvalFreeBudgetExhaustedError({ spentUsd: 2, budgetUsd: 1 });
        },
      });

      await expect(service.judgePage(INPUT)).rejects.toThrow(InstantEvalFreeBudgetExhaustedError);
      expect(texts.asked).toEqual([]);
      expect(judge.requests).toEqual([]);
    });
  });
});

describe("given a run cancelled before the page started", () => {
  describe("when the page comes up", () => {
    it("judges nothing and reports no next page", async () => {
      const { service, judge, cancellation } = await judging({
        keyPage: { keys: [rowKey("t1")], hasMore: true },
        rows: [{ TraceId: "t1", annoyed: "one" }],
      });
      await cancellation.request();

      const outcome = await service.judgePage(INPUT);

      expect(outcome).toMatchObject({ rows: 0, requests: 0, hasNextPage: false, cursor: null });
      expect(judge.requests).toEqual([]);
    });
  });
});

describe("given a page intent whose lease has less than the margin left", () => {
  describe("when the page is judged", () => {
    /** @scenario "A page with no lease left is not started" */
    it("throws without reading or judging, so a fresh lease delivers it again", async () => {
      const { service, judge, texts } = await judging({
        keyPage: { keys: [rowKey("t1")], hasMore: true },
        rows: [{ TraceId: "t1", annoyed: "one" }],
      });

      await expect(
        service.judgePage({ ...INPUT, deadlineAt: AT.epochMilliseconds + 1_000 }),
      ).rejects.toThrow(/no lease left/);
      expect(judge.requests).toEqual([]);
      expect(texts.asked).toEqual([]);
    });
  });
});

describe("given a page cancelled while it was judging", () => {
  describe("when it is written", () => {
    /** @scenario "A page cancelled part way ends the run where it got to" */
    it("keeps what answered, names the stop on the rest, and reports no next page", async () => {
      vi.useFakeTimers();
      const cancellation = new ScriptedCancellation();
      try {
        const scripted = await judging({
          cancellation,
          keyPage: { keys: [rowKey("t1"), rowKey("t2"), rowKey("t3")], hasMore: true },
          rows: [
            { TraceId: "t1", annoyed: "one" },
            { TraceId: "t2", annoyed: "two" },
            { TraceId: "t3", annoyed: "three" },
          ],
          concurrency: 1,
          answer: async ({ index, signal }) => {
            if (index === 0) return judged(0.9);
            await cancellation.request();
            // The watch polls on its own interval; the page sees the stop only
            // once that interval has come round.
            await vi.advanceTimersByTimeAsync(2_000);
            if (signal?.aborted) throw new DOMException("stopped", "AbortError");

            return judged(0.1);
          },
        });

        const outcome = await scripted.service.judgePage(INPUT);

        expect(scripted.judgments.written[0]).toMatchObject([
          { TraceId: "t1", Status: "judged", Probability: 0.9 },
        ]);
        expect(outcome).toMatchObject({ rows: 1, cursor: "t1", hasNextPage: false });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("given a page intent leased for a while", () => {
  /** A lease that leaves the page this many milliseconds to judge in. */
  const leasedFor = (ms: number) =>
    AT.epochMilliseconds + INSTANT_EVAL_PAGE_SETTLE_MS + INSTANT_EVAL_CANCEL_POLL_MS + ms;
  const untilStopped = (signal: AbortSignal | undefined) =>
    new Promise<InstantEvalJudgement>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")));
    });
  const threeRows = {
    keyPage: { keys: [rowKey("t1"), rowKey("t2"), rowKey("t3")], hasMore: true },
    rows: [
      { TraceId: "t1", annoyed: "one" },
      { TraceId: "t2", annoyed: "two" },
      { TraceId: "t3", annoyed: "three" },
    ],
    concurrency: 1,
  };

  describe("when the lease runs down while the page is judging", () => {
    /** @scenario "A page judges under a deadline inside its lease" */
    it("stops before the lease lapses and reports where to resume", async () => {
      const { service, judgments } = await judging({
        ...threeRows,
        answer: async ({ index, signal }) => (index === 0 ? judged(0.9) : untilStopped(signal)),
      });

      const outcome = await service.judgePage({ ...INPUT, deadlineAt: leasedFor(50) });

      expect(judgments.written[0]).toMatchObject([{ TraceId: "t1", Status: "judged" }]);
      expect(outcome).toMatchObject({ rows: 1, cursor: "t1", hasNextPage: true });
    });
  });

  describe("when the deadline lands before any row answered", () => {
    /** @scenario "A page judges under a deadline inside its lease" */
    it("writes nothing and keeps the cursor where the page started", async () => {
      const { service, judgments } = await judging({
        ...threeRows,
        answer: async ({ signal }) => untilStopped(signal),
      });

      const outcome = await service.judgePage({ ...INPUT, deadlineAt: leasedFor(50) });

      expect(judgments.written.flat()).toEqual([]);
      expect(outcome).toMatchObject({ rows: 0, cursor: null, hasNextPage: true });
    });
  });
});

describe("given judgements that cannot be written", () => {
  describe("when the page is judged", () => {
    it("fails the page, so the redelivery writes them before it is recorded", async () => {
      const { service } = await judging({
        keyPage: { keys: [rowKey("t1")], hasMore: false },
        rows: [{ TraceId: "t1", annoyed: "one" }],
        onInsert: () => {
          throw new Error("the judgements table is unreachable");
        },
      });

      await expect(service.judgePage(INPUT)).rejects.toThrow(/unreachable/);
    });
  });
});
