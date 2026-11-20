/**
 * Recall before judging, and keep what was judged: driven through the rows a query or a page
 * judges, over the in-process store, with the judge counting what it was sent.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import {
  estimateInstantEvalRequestTokens,
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  INSTANT_EVAL_PRICING,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
} from "../../channels/instant-eval-judging.channel.ts";
import type {
  EvalResultRecord,
  EvalResultsRecallQuery,
  EvalResultsRepository,
  RecalledEvalResult,
} from "../../repositories/eval-results.repository.ts";
import { MemoryEvalResultsRepository } from "../../repositories/memory/memory.eval-results.repository.ts";
import {
  EVAL_RESULTS_KEY_VERSION,
  findEvalResultsCellKeys,
} from "../../rules/eval-results-key.rules.ts";
import { evalResultRecordOf } from "../../rules/eval-results-recall.rules.ts";
import type { InstantEvalRunQuestion } from "../../rules/instant-eval-run-questions.rules.ts";
import {
  EvalResultsRecallService,
  type EvalResultsSourceReference,
} from "../eval-results-recall.service.ts";
import { InstantEvalJudgeRowsService } from "../instant-eval-judge-rows.service.ts";

const PROJECT_ID = "project-1";
const AT = Date.UTC(2026, 10, 2, 10);
const OCCURRED_AT = "2026-11-02 09:00:00.000";
const JUDGE = "langwatch/instant-evals";
const ASK: EvalResultsSourceReference = { kind: "ask", id: "query:1" };

const ANNOYED: InstantEvalRunQuestion = {
  id: "annoyed",
  function: "eval",
  kind: "boolean",
  reads: "probability",
  question: { id: "annoyed", kind: "boolean", instructions: "Is the customer annoyed?" },
  judgedText: { function: "llm_readable_trace", keyKind: "trace" },
};

const POLITE: InstantEvalRunQuestion = {
  ...ANNOYED,
  id: "polite",
  question: { id: "polite", kind: "boolean", instructions: "Was the agent polite?" },
};

/** Answers every question it is asked with one probability, and keeps what it was sent. */
class ScriptedJudge implements InstantEvalJudgeChannel {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;
  readonly requests: InstantEvalClassifyRequest[] = [];

  constructor(
    private readonly probability = 0.8,
    private readonly isDown = false,
  ) {}

  async classify(request: InstantEvalClassifyRequest): Promise<InstantEvalJudgement> {
    this.requests.push(request);
    if (this.isDown) throw new Error("the judge is unreachable");
    return {
      verdicts: request.questions.map((question) => ({
        questionId: question.id,
        probability: this.probability,
      })),
      inputTokens: 100,
      isTextTruncated: false,
    };
  }
}

/** The in-process store, counting its reads and inserts, failing either when a test says so. */
class CountingResults implements Pick<EvalResultsRepository, "insert" | "findLatestJudged"> {
  readonly store = MemoryEvalResultsRepository.create();
  readonly inserts: EvalResultRecord[][] = [];
  reads = 0;
  isReadFailing = false;
  isInsertFailing = false;

  async insert(records: readonly EvalResultRecord[]): Promise<void> {
    if (this.isInsertFailing) throw new Error("eval_results is unreachable");
    this.inserts.push([...records]);
    await this.store.insert(records);
  }

  async findLatestJudged(query: EvalResultsRecallQuery): Promise<readonly RecalledEvalResult[]> {
    this.reads += 1;
    if (this.isReadFailing) throw new Error("eval_results is unreachable");
    return this.store.findLatestJudged(query);
  }
}

function harness({
  results = new CountingResults(),
  isReleased = true,
  judgeModel = JUDGE,
  judge = new ScriptedJudge(),
}: {
  results?: CountingResults;
  isReleased?: boolean;
  judgeModel?: string;
  judge?: ScriptedJudge;
} = {}) {
  const recall = EvalResultsRecallService.create({
    results,
    peers: {
      isReleased: async () => isReleased,
      judgeModelOf: async () => judgeModel,
      retentionDaysOf: async () => 30,
    },
    now: () => AT,
  });
  return { judge, results, rows: InstantEvalJudgeRowsService.create({ judge, results: recall }) };
}

/** One row per trace, every question's column holding that trace's text. */
function rowsOf(texts: Readonly<Record<string, string>>): Record<string, unknown>[] {
  return Object.entries(texts).map(([traceId, text]) => ({
    TraceId: traceId,
    OccurredAt: OCCURRED_AT,
    annoyed: text,
    polite: text,
  }));
}

/** A kept row for one trace's text, written as a judgement would be. */
function kept({
  traceId,
  text,
  question = ANNOYED,
  outcome,
  sourceId = "query:0",
  judgedAt = AT - 60_000,
}: {
  traceId: string;
  text: string;
  question?: InstantEvalRunQuestion;
  outcome: Parameters<typeof evalResultRecordOf>[0]["outcome"];
  sourceId?: string;
  judgedAt?: number;
}): EvalResultRecord {
  const [row] = rowsOf({ [traceId]: text });
  const [key] = findEvalResultsCellKeys({ row: row ?? {}, question, text });
  if (!key) throw new Error("the fixture row has no key");
  return evalResultRecordOf({
    tenantId: PROJECT_ID,
    key,
    question,
    judgeModel: JUDGE,
    source: { kind: "ask", id: sourceId },
    outcome,
    judgedAt,
    retentionDays: 30,
  });
}

describe("given a judged row for a trace, a question, the judge and the text", () => {
  describe("when the same question is asked of the same text with the same judge", () => {
    /** @scenario "A repeat question of the same trace text is recalled, not judged" */
    it("answers the stored verdict without a judge call, and adds no row", async () => {
      const { judge, results, rows } = harness();
      await rows.judgeRows({
        projectId: PROJECT_ID,
        rows: rowsOf({ "trace-1": "hello" }),
        questions: [ANNOYED],
        signal: null,
        source: ASK,
      });

      const again = await rows.judgeRows({
        projectId: PROJECT_ID,
        rows: rowsOf({ "trace-1": "hello" }),
        questions: [ANNOYED],
        signal: null,
        source: { kind: "ask", id: "query:2" },
      });

      expect(judge.requests).toHaveLength(1);
      expect(results.inserts).toHaveLength(1);
      expect(again.rows[0]?.annoyed).toBe(0.8);
      expect(again.usage.requests).toBe(0);
    });
  });

  describe("when its text has changed", () => {
    it("judges the new text", async () => {
      const { judge, rows } = harness();
      const ask = (text: string) =>
        rows.judgeRows({
          projectId: PROJECT_ID,
          rows: rowsOf({ "trace-1": text }),
          questions: [ANNOYED],
          signal: null,
          source: ASK,
        });

      await ask("hello");
      await ask("hello, again");

      expect(judge.requests).toHaveLength(2);
    });
  });
});

describe("given no kept row for two traces", () => {
  describe("when their question is asked", () => {
    /** @scenario "A text no kept row answers is judged and kept in one batch" */
    it("judges both and writes both in one insert, with the key version and the retention", async () => {
      const { judge, results, rows } = harness();

      await rows.judgeRows({
        projectId: PROJECT_ID,
        rows: rowsOf({ "trace-1": "hello", "trace-2": "goodbye" }),
        questions: [ANNOYED],
        signal: null,
        source: ASK,
      });

      expect(judge.requests).toHaveLength(2);
      expect(results.inserts).toHaveLength(1);
      expect(results.inserts[0]).toHaveLength(2);
      expect(results.inserts[0]?.[0]).toMatchObject({
        TenantId: PROJECT_ID,
        Question: "Is the customer annoyed?",
        Kind: "boolean",
        JudgeModel: JUDGE,
        JudgedColumn: "llm_readable_trace",
        KeyVersion: EVAL_RESULTS_KEY_VERSION,
        Source: "ask",
        SourceId: "query:1",
        Status: "judged",
        Probability: 0.8,
        OccurredAt: Date.UTC(2026, 10, 2, 9),
        JudgedAt: AT,
        _retention_days: 30,
      });
    });
  });
});

describe("given one text asked two questions, one already kept", () => {
  describe("when it is judged", () => {
    /** @scenario "Recall splits a unit and the budget is checked on what is left" */
    it("asks only the missed question, under a budget only what is left fits", async () => {
      const results = new CountingResults();
      await results.store.insert([
        kept({ traceId: "trace-1", text: "hello", outcome: { verdict: verdict(0.3) } }),
      ]);
      const { judge, rows } = harness({ results });
      const leftOnly = estimateInstantEvalRequestTokens({
        text: "hello",
        questions: [POLITE.question],
        limits: INSTANT_EVAL_CLASSIFIER_LIMITS,
      });
      const ask = (released: ReturnType<typeof harness>) =>
        released.rows.judgeRows({
          projectId: PROJECT_ID,
          rows: rowsOf({ "trace-1": "hello" }),
          questions: [ANNOYED, POLITE],
          tokenBudget: leftOnly,
          signal: null,
          source: ASK,
        });

      const judged = await ask({ judge, results, rows });

      expect(judge.requests.map((request) => request.questions.map(({ id }) => id))).toEqual([
        ["polite"],
      ]);
      expect(judged.rows[0]).toMatchObject({ annoyed: 0.3, polite: 0.8 });
      await expect(ask(harness({ results, isReleased: false }))).rejects.toMatchObject({
        code: "instant_eval_query_budget_exceeded",
      });
    });
  });
});

describe("given some cells recalled and a judge that loses every remaining text", () => {
  describe("when the batch is judged", () => {
    /** @scenario "A batch with recalled verdicts is delivered when the judge loses the rest" */
    it("delivers recalled verdicts, nulls the lost cells and keeps them as failed", async () => {
      const results = new CountingResults();
      await results.store.insert([
        kept({ traceId: "trace-1", text: "hello", outcome: { verdict: verdict(0.3) } }),
      ]);
      const { rows } = harness({ results, judge: new ScriptedJudge(0.8, true) });

      const judged = await rows.judgeRows({
        projectId: PROJECT_ID,
        rows: rowsOf({ "trace-1": "hello", "trace-2": "goodbye" }),
        questions: [ANNOYED],
        signal: null,
        source: ASK,
      });

      expect(judged.rows.map((row) => row.annoyed)).toEqual([0.3, null]);
      expect(results.inserts).toHaveLength(1);
      expect(results.inserts[0]).toMatchObject([
        { TraceId: "trace-2", Status: "failed", Error: "classifier_failed", Probability: null },
      ]);
    });
  });

  describe("when nothing was recalled", () => {
    it("still refuses the batch, as a judge that answered nothing", async () => {
      const { rows } = harness({ judge: new ScriptedJudge(0.8, true) });

      await expect(
        rows.judgeRows({
          projectId: PROJECT_ID,
          rows: rowsOf({ "trace-2": "goodbye" }),
          questions: [ANNOYED],
          signal: null,
          source: ASK,
        }),
      ).rejects.toMatchObject({ code: "instant_eval_classifier_unavailable" });
    });
  });
});

describe("given a project without release_instant_eval_results", () => {
  describe("when a trace's text is judged", () => {
    /** @scenario "With release_instant_eval_results off nothing is read or written" */
    it("neither reads nor writes eval_results, and asks the judge as today", async () => {
      const { judge, results, rows } = harness({ isReleased: false });

      const judged = await rows.judgeRows({
        projectId: PROJECT_ID,
        rows: rowsOf({ "trace-1": "hello" }),
        questions: [ANNOYED],
        signal: null,
        source: ASK,
      });

      expect(results.reads).toBe(0);
      expect(results.inserts).toEqual([]);
      expect(judge.requests).toHaveLength(1);
      expect(judged.rows[0]?.annoyed).toBe(0.8);
    });
  });
});

describe("given a failed row and a skipped row for the same key", () => {
  describe("when the question is asked again", () => {
    /** @scenario "A failed or skipped row never stands in for a verdict" */
    it("judges the text again", async () => {
      const results = new CountingResults();
      await results.store.insert([
        kept({
          traceId: "trace-1",
          text: "hello",
          outcome: { skippedReason: "classifier_failed" },
        }),
        kept({
          traceId: "trace-1",
          text: "hello",
          outcome: { skippedReason: "classifier_rate_limited" },
          sourceId: "query:9",
        }),
      ]);
      const { judge, rows } = harness({ results });

      await rows.judgeRows({
        projectId: PROJECT_ID,
        rows: rowsOf({ "trace-1": "hello" }),
        questions: [ANNOYED],
        signal: null,
        source: ASK,
      });

      expect(results.store.list().map((row) => row.Status)).toEqual(
        expect.arrayContaining(["failed", "skipped", "judged"]),
      );
      expect(judge.requests).toHaveLength(1);
    });
  });
});

describe("given two judged rows of one key judged in the same millisecond", () => {
  describe("when the key is recalled", () => {
    it("answers the row with the greatest source id, whichever was written first", async () => {
      const results = new CountingResults();
      await results.store.insert([
        kept({ traceId: "trace-1", text: "hi", outcome: { verdict: verdict(0.2) }, sourceId: "b" }),
        kept({ traceId: "trace-1", text: "hi", outcome: { verdict: verdict(0.1) }, sourceId: "a" }),
      ]);
      const { rows } = harness({ results });

      const judged = await rows.judgeRows({
        projectId: PROJECT_ID,
        rows: rowsOf({ "trace-1": "hi" }),
        questions: [ANNOYED],
        signal: null,
        source: ASK,
      });

      expect(judged.rows[0]?.annoyed).toBe(0.2);
    });
  });
});

describe("given a judged row written by another judge model", () => {
  describe("when the question is asked with the project's current judge", () => {
    /** @scenario "A changed judge model is not recalled" */
    it("judges the text again", async () => {
      const results = new CountingResults();
      const ask = (judgeModel: string) => {
        const released = harness({ results, judgeModel });
        return released.rows
          .judgeRows({
            projectId: PROJECT_ID,
            rows: rowsOf({ "trace-1": "hello" }),
            questions: [ANNOYED],
            signal: null,
            source: ASK,
          })
          .then(() => released.judge.requests.length);
      };

      await expect(ask(JUDGE)).resolves.toBe(1);
      await expect(ask("azure/decisions:gpt-6-luna")).resolves.toBe(1);
      await expect(ask(JUDGE)).resolves.toBe(0);
    });
  });
});

describe("given a recall read that fails", () => {
  describe("when a trace's text is judged", () => {
    /** @scenario "A failed recall read judges every text instead" */
    it("asks the judge as if nothing were kept", async () => {
      const results = new CountingResults();
      await results.store.insert([
        kept({ traceId: "trace-1", text: "hello", outcome: { verdict: verdict(0.3) } }),
      ]);
      results.isReadFailing = true;
      const { judge, rows } = harness({ results });

      const judged = await rows.judgeRows({
        projectId: PROJECT_ID,
        rows: rowsOf({ "trace-1": "hello" }),
        questions: [ANNOYED],
        signal: null,
        source: ASK,
      });

      expect(judge.requests).toHaveLength(1);
      expect(judged.rows[0]?.annoyed).toBe(0.8);
    });
  });
});

describe("given an insert into eval_results that fails", () => {
  describe("when a trace's text is judged", () => {
    /** @scenario "A result that could not be kept is still delivered" */
    it("still answers the verdict", async () => {
      const results = new CountingResults();
      results.isInsertFailing = true;
      const { rows } = harness({ results });

      const judged = await rows.judgeRows({
        projectId: PROJECT_ID,
        rows: rowsOf({ "trace-1": "hello" }),
        questions: [ANNOYED],
        signal: null,
        source: ASK,
      });

      expect(judged.rows[0]?.annoyed).toBe(0.8);
    });
  });
});

describe("given rows judged with no source named", () => {
  it("reads and writes nothing, as an estimate or a classification does", async () => {
    const { results, rows } = harness();

    await rows.judgeRows({
      projectId: PROJECT_ID,
      rows: rowsOf({ "trace-1": "hello" }),
      questions: [ANNOYED],
      signal: null,
    });

    expect(results.reads).toBe(0);
    expect(results.inserts).toEqual([]);
  });
});

function verdict(probability: number) {
  return { questionId: "annoyed", probability };
}
