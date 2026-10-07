/**
 * A synchronous query's judging: held, judged, recorded once (Alex, 2026-10-06, "Judge cycle").
 * Ported from main's instantEvalQueries and evaluateCancellation suites.
 * @see specs/lwql/eval-functions.feature
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */
import type { LangWatchQLJudgementCall } from "@langwatch/analytics-contract";
import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalJudgement,
  type InstantEvalVerdict,
} from "@langwatch/instant-eval-judge-contract";
import {
  INSTANT_EVAL_PRICING,
  instantEvalCostUsd,
  instantEvalPriceUsd,
} from "@langwatch/instant-eval-judge-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
} from "../../channels/instant-eval-judge.channel.ts";
import { MemoryInstantEvalBudgetReservationsRepository } from "../../repositories/memory/memory.instant-eval-budget-reservations.repository.ts";
import type {
  InstantEvalPricedSpend,
  InstantEvalSpendRecord,
} from "../../rules/instant-eval-spend-outcome.rules.ts";
import { InstantEvalFreeBudgetService } from "../instant-eval-free-budget.service.ts";
import { InstantEvalJudgeRowsService } from "../instant-eval-judge-rows.service.ts";
import { InstantEvalQueryJudgingService } from "../instant-eval-query-judging.service.ts";
import { InstantEvalSpendService } from "../instant-eval-spend.service.ts";

const AT = Temporal.Instant.from("2026-10-06T10:00:00Z");
const NANO = 1_000_000_000;
const TOKENS_PER_TEXT = 100;

type Answer = (input: {
  request: InstantEvalClassifyRequest;
  index: number;
  signal?: AbortSignal;
}) => Promise<InstantEvalJudgement>;

/** Answers every question of a request with one verdict, or as a test scripts it. */
class ScriptedJudge implements InstantEvalJudgeChannel {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;
  readonly requests: InstantEvalClassifyRequest[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];

  constructor(private readonly answer: Answer = answerEvery({ probability: 0.9 })) {}

  async classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    const index = this.requests.length;
    this.requests.push(request);
    this.signals.push(signal);

    return this.answer({ request, index, ...(signal ? { signal } : {}) });
  }
}

function answerEvery(verdict: Omit<InstantEvalVerdict, "questionId">): Answer {
  return async ({ request }) => ({
    verdicts: request.questions.map((question) => ({ questionId: question.id, ...verdict })),
    inputTokens: TOKENS_PER_TEXT,
    isTextTruncated: false,
  });
}

/** What a judge answers for each kind: a level mean, a distribution, or a probability. */
function verdictOfKind({
  question,
  text,
}: {
  question: InstantEvalClassifyRequest["questions"][number];
  text: string;
}): InstantEvalVerdict {
  if (question.kind === "score") return { questionId: question.id, score: 3.5 };
  if (question.kind === "category") {
    return {
      questionId: question.id,
      label: "billing",
      probabilities: { billing: 0.7, shipping: 0.3 },
    };
  }

  return { questionId: question.id, probability: text === "low" ? 0.3 : 0.8 };
}

function booleanCall(column: string, overrides: Partial<LangWatchQLJudgementCall> = {}) {
  return {
    column,
    function: "eval",
    reads: "probability",
    kind: "boolean",
    instructions: `Is ${column} true?`,
    ...overrides,
  } as LangWatchQLJudgementCall;
}

/** The budget, the spend spine and the order things happened in, all recorded. */
function harness({
  judge = new ScriptedJudge(),
  spentNanoUsd = 0,
  queryTokenBudget = 4_000_000,
  concurrency,
  recordPricedSpend,
}: {
  judge?: ScriptedJudge;
  spentNanoUsd?: number;
  queryTokenBudget?: number;
  concurrency?: number;
  recordPricedSpend?: (input: InstantEvalPricedSpend) => Promise<void>;
} = {}) {
  const events: string[] = [];
  const priced: InstantEvalPricedSpend[] = [];
  const records: InstantEvalSpendRecord[] = [];
  const reservations = MemoryInstantEvalBudgetReservationsRepository.create({ now: () => AT });
  const budget = InstantEvalFreeBudgetService.create({
    peers: {
      findOrganizationId: async () => "org-1",
      listProjectIds: async () => ["project-1"],
      isFreePlan: async () => true,
      sumSpendNanoUsdByRequestType: async () => spentNanoUsd,
    },
    reservations,
    isBounded: true,
    now: () => AT,
  });
  const spend = InstantEvalSpendService.create({
    peers: {
      findSpendAttribution: async () => ({ organizationId: "org-1", teamId: "team-1" }),
      recordPricedSpend:
        recordPricedSpend ??
        (async (input) => {
          priced.push(input);
        }),
    },
  });
  const service = InstantEvalQueryJudgingService.create({
    rows: InstantEvalJudgeRowsService.create({
      judge,
      ...(concurrency === undefined ? {} : { concurrency }),
    }),
    budget: {
      reserve: async (input) => {
        events.push(`reserve ${input.priceUsd} with ${judge.requests.length} judged`);
        await budget.reserve(input);
      },
      release: async (input) => {
        events.push(`release after ${priced.length} recorded`);
        await budget.release(input);
      },
    },
    spend: {
      recordSpend: async (record) => {
        records.push(record);
        await spend.recordSpend(record);
      },
    },
    pricing: INSTANT_EVAL_PRICING,
    queryTokenBudget,
    now: () => AT,
  });

  return { service, judge, events, priced, records };
}

async function refusalOf(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run();
  } catch (error) {
    return error as Record<string, unknown>;
  }

  return { code: "no error was thrown" };
}

describe("InstantEvalQueryJudgingService.judgeQuery", () => {
  describe("given each eval function over one row", () => {
    /** @scenario "Each eval function reports the answer its kind names" */
    it("fills each column with the part of the verdict its kind names", async () => {
      const judge = new ScriptedJudge(async ({ request }) => ({
        verdicts: request.questions.map((question) =>
          verdictOfKind({ question, text: request.text }),
        ),
        inputTokens: TOKENS_PER_TEXT,
        isTextTruncated: false,
      }));
      const options = [
        { name: "billing", description: "about money" },
        { name: "shipping", description: "about parcels" },
      ];
      const { service } = harness({ judge });

      const judged = await service.judgeQuery({
        projectId: "project-1",
        judgements: [
          booleanCall("probability"),
          booleanCall("passed", { function: "eval_passed", reads: "passed", threshold: 0.5 }),
          {
            column: "score",
            function: "eval_score",
            reads: "score",
            kind: "score",
            instructions: "How polite?",
            range: { min: 1, max: 5 },
          },
          {
            column: "label",
            function: "eval_category",
            reads: "label",
            kind: "category",
            instructions: "Which topic?",
            options,
          },
          {
            column: "probs",
            function: "eval_category_probs",
            reads: "probabilities",
            kind: "category",
            instructions: "Which topic?",
            options,
          },
        ],
        rows: ["high", "low"].map((text) => ({
          probability: text,
          passed: text,
          score: text,
          label: text,
          probs: text,
        })),
      });

      expect(judged.rows[0]).toEqual({
        probability: 0.8,
        passed: 1,
        score: 3.5,
        label: "billing",
        probs: expect.any(String),
      });
      expect(JSON.parse(String(judged.rows[0]?.probs))).toEqual({ billing: 0.7, shipping: 0.3 });
      expect(judged.rows[1]?.passed).toBe(0);
    });
  });

  describe("given three questions over the same text", () => {
    /** @scenario "Three questions over one text cost one classifier request per row" */
    it("asks them in one request and answers each column from its own question", async () => {
      const { service, judge } = harness({
        judge: new ScriptedJudge(async ({ request }) => ({
          verdicts: request.questions.map((question, at) => ({
            questionId: question.id,
            probability: (at + 1) / 10,
          })),
          inputTokens: TOKENS_PER_TEXT,
          isTextTruncated: false,
        })),
      });

      const judged = await service.judgeQuery({
        projectId: "project-1",
        judgements: [booleanCall("a"), booleanCall("b"), booleanCall("c")],
        rows: [{ a: "the conversation", b: "the conversation", c: "the conversation" }],
      });

      expect(judge.requests).toHaveLength(1);
      expect(judge.requests[0]?.questions.map((question) => question.id)).toEqual(["a", "b", "c"]);
      expect(judged.rows).toEqual([{ a: 0.1, b: 0.2, c: 0.3 }]);
    });
  });

  describe("given two different texts in one row", () => {
    /** @scenario "Two different texts in one statement are two requests per row" */
    it("sends one request per text", async () => {
      const { service, judge } = harness();

      await service.judgeQuery({
        projectId: "project-1",
        judgements: [booleanCall("conversation"), booleanCall("digest")],
        rows: [{ conversation: "the conversation", digest: "the digest" }],
      });

      expect(judge.requests.map((request) => request.text)).toEqual([
        "the conversation",
        "the digest",
      ]);
    });
  });

  describe("given rows that would send more tokens than one query may", () => {
    /** @scenario "A query whose text volume exceeds the per-query budget is refused" */
    it("refuses by the code whose remediation points at a job, judging nothing", async () => {
      const { service, judge } = harness({ queryTokenBudget: 10 });

      const refusal = await refusalOf(() =>
        service.judgeQuery({
          projectId: "project-1",
          judgements: [booleanCall("annoyed")],
          rows: [{ annoyed: "a conversation long enough to cost more than ten tokens to judge" }],
        }),
      );

      expect(refusal.code).toBe("instant_eval_query_budget_exceeded");
      expect(refusal.meta).toEqual({ estimatedTokens: expect.any(Number), budget: 10 });
      expect(judge.requests).toHaveLength(0);
    });
  });

  describe("given questions that alone fill the judge's state", () => {
    /** @scenario "Questions that leave no room for text are refused before anything is judged" */
    it("refuses with instant_eval_questions_too_long and sends nothing", async () => {
      const { service, judge } = harness();
      const instructions = "x".repeat(INSTANT_EVAL_CLASSIFIER_LIMITS.stateTokens * 8);

      const refusal = await refusalOf(() =>
        service.judgeQuery({
          projectId: "project-1",
          judgements: [booleanCall("annoyed", { instructions })],
          rows: [{ annoyed: "the conversation" }],
        }),
      );

      expect(refusal.code).toBe("instant_eval_questions_too_long");
      expect(judge.requests).toHaveLength(0);
    });
  });

  describe("given a classifier that refuses every request", () => {
    /** @scenario "A classifier that fails for the whole query is a platform refusal" */
    it("refuses the query as the provider's fault rather than answering nulls", async () => {
      const { service } = harness({
        judge: new ScriptedJudge(async () => {
          throw new Error("upstream 500");
        }),
      });

      const refusal = await refusalOf(() =>
        service.judgeQuery({
          projectId: "project-1",
          judgements: [booleanCall("annoyed")],
          rows: [{ annoyed: "one" }, { annoyed: "two" }],
        }),
      );

      expect(refusal.code).toBe("instant_eval_classifier_unavailable");
      expect(refusal.fault).toBe("provider");
    });
  });

  describe("given a classifier that refuses one row of five", () => {
    /** @scenario "A row the classifier could not judge is skipped rather than guessed" */
    /** @scenario "A text the classifier failed on is skipped, not reported as a missing key" */
    it("leaves that row null, counts it skipped and answers the other four", async () => {
      const { service } = harness({
        judge: new ScriptedJudge(async ({ request }) => {
          if (request.text === "row-3") throw new Error("upstream 500");

          return answerEvery({ probability: 0.6 })({ request, index: 0 });
        }),
      });

      const judged = await service.judgeQuery({
        projectId: "project-1",
        judgements: [booleanCall("annoyed")],
        rows: [1, 2, 3, 4, 5].map((row) => ({ annoyed: `row-${row}` })),
      });

      expect(judged.rows.map((row) => row.annoyed)).toEqual([0.6, 0.6, null, 0.6, 0.6]);
      expect(judged.skipped).toEqual({ classifier_failed: 1 });
      expect(judged.cancellation).toBeUndefined();
    });
  });

  describe("given a caller that cancels after one row was answered", () => {
    /** @scenario "A cancelled query stops judging instead of paying out the rest" */
    /** @scenario "A cancelled query keeps the judgements it made" */
    it("stops, keeps and bills the answered verdict, and names the unjudged rows", async () => {
      const controller = new AbortController();
      const judge = new ScriptedJudge(async ({ request, index, signal }) => {
        if (index === 0) return answerEvery({ probability: 0.7 })({ request, index });
        controller.abort();
        signal?.throwIfAborted();

        return answerEvery({ probability: 0.1 })({ request, index });
      });
      const { service, records } = harness({ judge, concurrency: 1 });

      const judged = await service.judgeQuery({
        projectId: "project-1",
        judgements: [booleanCall("annoyed")],
        rows: [{ annoyed: "one" }, { annoyed: "two" }, { annoyed: "three" }],
        signal: controller.signal,
      });

      expect(judge.requests).toHaveLength(2);
      expect(judge.signals[1]?.aborted).toBe(true);
      expect(judged.rows.map((row) => row.annoyed)).toEqual([0.7, null, null]);
      expect(judged.cancellation).toEqual({ unjudgedRows: [1, 2] });
      expect(records.map((record) => record.inputTokens)).toEqual([TOKENS_PER_TEXT]);
    });
  });

  describe("given rows whose every key resolved to no text", () => {
    /** @scenario "A query that judged nothing reports no spend" */
    it("judges nothing and records no spend", async () => {
      const { service, judge, records } = harness();

      await service.judgeQuery({
        projectId: "project-1",
        judgements: [booleanCall("annoyed")],
        rows: [{ annoyed: null }, { annoyed: "" }],
      });

      expect(judge.requests).toHaveLength(0);
      expect(records).toHaveLength(0);
    });
  });

  describe("given a query that judged three conversations", () => {
    /** @scenario "One spend record is reported per query" */
    /** @scenario "A synchronous query is one confirmed spend record with a fresh id" */
    it("records one spend for the project, naming no run, at the classifier's cost", async () => {
      const { service, records, priced } = harness();

      await service.judgeQuery({
        projectId: "project-1",
        judgements: [booleanCall("annoyed")],
        rows: [{ annoyed: "one" }, { annoyed: "two" }, { annoyed: "three" }],
      });

      const costUsd = instantEvalCostUsd({ inputTokens: 3 * TOKENS_PER_TEXT });
      expect(records).toEqual([
        {
          projectId: "project-1",
          inputTokens: 3 * TOKENS_PER_TEXT,
          requests: 3,
          costUsd,
          priceUsd: instantEvalPriceUsd({ costUsd }),
          occurredAt: AT,
        },
      ]);
      expect(priced).toHaveLength(1);
      expect(priced[0]?.requestId.startsWith("instantevalquery")).toBe(true);
      expect(JSON.parse(priced[0]?.metadata ?? "{}").instant_eval).not.toHaveProperty("run_id");
    });
  });

  describe("given a free organization that has spent its budget", () => {
    /** @scenario "At the budget a synchronous judged query is refused" */
    it("refuses with instant_eval_free_budget_exhausted before anything is judged", async () => {
      const { service, judge } = harness({ spentNanoUsd: 1 * NANO });

      const refusal = await refusalOf(() =>
        service.judgeQuery({
          projectId: "project-1",
          judgements: [booleanCall("annoyed")],
          rows: [{ annoyed: "one" }],
        }),
      );

      expect(refusal.code).toBe("instant_eval_free_budget_exhausted");
      expect(judge.requests).toHaveLength(0);
    });
  });

  describe("given a free organization under its budget", () => {
    /** @scenario "A judged query holds its ceiling while it judges" */
    it("holds the whole query token budget's price first and releases it once recorded", async () => {
      const { service, events } = harness({ queryTokenBudget: 1_000 });

      await service.judgeQuery({
        projectId: "project-1",
        judgements: [booleanCall("annoyed")],
        rows: [{ annoyed: "one" }],
      });

      const ceiling = instantEvalPriceUsd({ costUsd: instantEvalCostUsd({ inputTokens: 1_000 }) });
      expect(events).toEqual([`reserve ${ceiling} with 0 judged`, "release after 1 recorded"]);
    });

    it("keeps the hold when the spend could not be recorded, still answering", async () => {
      const { service, events } = harness({
        recordPricedSpend: async () => {
          throw new Error("spend spine down");
        },
      });

      const judged = await service.judgeQuery({
        projectId: "project-1",
        judgements: [booleanCall("annoyed")],
        rows: [{ annoyed: "one" }],
      });

      expect(judged.rows).toEqual([{ annoyed: 0.9 }]);
      expect(events.filter((event) => event.startsWith("release"))).toEqual([]);
    });
  });

  describe("given a statement that asks nothing", () => {
    it("holds nothing and judges nothing", async () => {
      const { service, events, judge } = harness();

      const judged = await service.judgeQuery({
        projectId: "project-1",
        judgements: [],
        rows: [{ annoyed: "one" }],
      });

      expect(judged).toEqual({ rows: [{ annoyed: "one" }], skipped: {} });
      expect(events).toEqual([]);
      expect(judge.requests).toHaveLength(0);
    });
  });
});
