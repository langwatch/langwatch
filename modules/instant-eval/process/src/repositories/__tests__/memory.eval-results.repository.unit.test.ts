/**
 * Kept results in process: recalled by key the way the table is, read by trace for the drawer,
 * isolated by project, deduplicated on the sort key, counted from judged rows only.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import { beforeEach, describe, expect, it } from "vitest";

import { EVAL_RESULTS_KEY_VERSION } from "../../rules/eval-results-key.rules.ts";
import type { EvalResultRecord, EvalResultsRecallQuery } from "../eval-results.repository.ts";
import { MemoryEvalResultsRepository } from "../memory/memory.eval-results.repository.ts";

const AT = Date.UTC(2026, 10, 2, 10);
const JUDGE = "langwatch/instant-evals";
const KEY = { traceId: "trace-1", spanId: "", questionHash: "question", inputHash: "input" };

let repository: MemoryEvalResultsRepository;

function record(overrides: Partial<EvalResultRecord> = {}): EvalResultRecord {
  return {
    TenantId: "project-1",
    TraceId: KEY.traceId,
    SpanId: KEY.spanId,
    QuestionHash: KEY.questionHash,
    Question: "Is the customer annoyed?",
    Kind: "boolean",
    JudgeModel: JUDGE,
    InputHash: KEY.inputHash,
    JudgedColumn: "llm_readable_trace",
    KeyVersion: EVAL_RESULTS_KEY_VERSION,
    Source: "ask",
    SourceId: "query:1",
    Status: "judged",
    Score: null,
    Label: "",
    Probability: 0.9,
    Probabilities: "",
    Error: "",
    OccurredAt: AT,
    JudgedAt: AT + 1_000,
    UpdatedAt: AT + 1_000,
    _retention_days: 30,
    ...overrides,
  };
}

function recall(overrides: Partial<EvalResultsRecallQuery> = {}): EvalResultsRecallQuery {
  return {
    tenantId: "project-1",
    judgeModel: JUDGE,
    keyVersion: EVAL_RESULTS_KEY_VERSION,
    keys: [KEY],
    occurredFrom: AT - 1_000,
    occurredUntil: AT + 1_000,
    ...overrides,
  };
}

beforeEach(() => {
  repository = MemoryEvalResultsRepository.create();
});

describe("given kept results of one key", () => {
  describe("when the key is recalled", () => {
    /** @scenario "Several kept rows of one key give the latest, deterministically" */
    it("answers the latest JudgedAt, then UpdatedAt, then the greatest SourceId", async () => {
      await repository.insert([
        record({ SourceId: "run-a", JudgedAt: AT + 1, UpdatedAt: AT + 9, Probability: 0.1 }),
        record({ SourceId: "run-b", JudgedAt: AT + 2, UpdatedAt: AT + 2, Probability: 0.2 }),
        record({ SourceId: "run-c", JudgedAt: AT + 2, UpdatedAt: AT + 3, Probability: 0.3 }),
        record({ SourceId: "run-d", JudgedAt: AT + 2, UpdatedAt: AT + 3, Probability: 0.4 }),
      ]);

      const [latest, ...others] = await repository.findLatestJudged(recall());

      expect(others).toEqual([]);
      expect(latest).toMatchObject({ sourceId: "run-d", probability: 0.4, judgedAt: AT + 2 });
    });

    it("never answers a failed or skipped row", async () => {
      await repository.insert([
        record({ Status: "failed", Probability: null, Error: "classifier_failed" }),
        record({ Status: "skipped", Probability: null, SourceId: "query:2" }),
      ]);

      await expect(repository.findLatestJudged(recall())).resolves.toEqual([]);
    });

    it("answers nothing to another project, another judge, another key version or a far window", async () => {
      await repository.insert([record()]);

      for (const query of [
        recall({ tenantId: "project-2" }),
        recall({ judgeModel: "azure/decisions:gpt-6-luna" }),
        recall({ keyVersion: EVAL_RESULTS_KEY_VERSION + 1 }),
        recall({ occurredFrom: AT + 10_000, occurredUntil: AT + 20_000 }),
        recall({ keys: [{ ...KEY, inputHash: "changed" }] }),
      ]) {
        await expect(repository.findLatestJudged(query)).resolves.toEqual([]);
      }
    });
  });

  describe("when the same row is written twice", () => {
    it("keeps one, as the replacing merge does", async () => {
      await repository.insert([record()]);
      await repository.insert([record()]);

      expect(repository.findAll()).toHaveLength(1);
    });
  });

  describe("when judged results are counted", () => {
    it("counts judged rows of the named projects since the window's start", async () => {
      await repository.insert([
        record({ SourceId: "a", JudgedAt: AT - 10_000 }),
        record({ SourceId: "b" }),
        record({ SourceId: "c", Status: "failed", Probability: null }),
        record({ SourceId: "d", TenantId: "project-2" }),
      ]);

      await expect(repository.countJudged({ projectIds: ["project-1"] })).resolves.toBe(2);
      await expect(repository.countJudged({ projectIds: ["project-1"], since: AT })).resolves.toBe(
        1,
      );
    });
  });
});

describe("given kept results on one trace", () => {
  const traceQuery = {
    tenantId: "project-1",
    traceId: KEY.traceId,
    keyVersion: EVAL_RESULTS_KEY_VERSION,
    occurredFrom: AT - 1_000,
    occurredUntil: AT + 1_000,
  };

  describe("when the trace is read", () => {
    /** @scenario "A trace's results are the latest per span, question and judged column" */
    it("answers the latest judged row of each cell, newest first, whatever its judge", async () => {
      await repository.insert([
        record({ SourceId: "run-a", JudgedAt: AT + 1, Probability: 0.1 }),
        record({ SourceId: "query:2", JudgedAt: AT + 5, Probability: 0.5, JudgeModel: "own/m" }),
        record({ SourceId: "query:3", JudgedAt: AT + 2, JudgedColumn: "output", Probability: 0.2 }),
        record({ SourceId: "query:4", JudgedAt: AT + 3, SpanId: "span-1", Probability: 0.3 }),
      ]);

      const results = await repository.findLatestByTrace(traceQuery);

      expect(results.map(({ sourceId, judgeModel }) => ({ sourceId, judgeModel }))).toEqual([
        { sourceId: "query:2", judgeModel: "own/m" },
        { sourceId: "query:4", judgeModel: JUDGE },
        { sourceId: "query:3", judgeModel: JUDGE },
      ]);
      expect(results[0]).toMatchObject({
        spanId: "",
        judgedColumn: "llm_readable_trace",
        question: "Is the customer annoyed?",
        status: "judged",
        probability: 0.5,
        source: "ask",
        judgedAt: AT + 5,
      });
    });

    /** @scenario "A failed or skipped result shows only where no judged one exists" */
    it("answers a failed or skipped row only for a cell with no judged row", async () => {
      await repository.insert([
        record({ SourceId: "run-a", JudgedAt: AT + 1, Probability: 0.4 }),
        record({ SourceId: "query:2", JudgedAt: AT + 9, Status: "failed", Probability: null }),
        record({
          SourceId: "query:3",
          JudgedColumn: "output",
          Status: "skipped",
          Probability: null,
        }),
      ]);

      const results = await repository.findLatestByTrace(traceQuery);

      expect(results.map(({ sourceId, status }) => ({ sourceId, status }))).toEqual([
        { sourceId: "query:3", status: "skipped" },
        { sourceId: "run-a", status: "judged" },
      ]);
    });

    /** @scenario "A monitor's results are left out of the trace's read" */
    it("never answers a monitor's row", async () => {
      await repository.insert([
        record({ Source: "monitor", SourceId: "monitor-1", JudgedColumn: "monitor" }),
      ]);

      await expect(repository.findLatestByTrace(traceQuery)).resolves.toEqual([]);
    });

    /** @scenario "A monitor's results are left out of the trace's read" */
    it("answers an ask row on the trace while leaving the monitor's row out", async () => {
      await repository.insert([
        record({ Source: "monitor", SourceId: "monitor-1", JudgedAt: AT + 9 }),
        record({ Source: "ask", SourceId: "query:1", JudgedAt: AT + 1 }),
      ]);

      const results = await repository.findLatestByTrace(traceQuery);

      expect(results.map(({ source, sourceId }) => ({ source, sourceId }))).toEqual([
        { source: "ask", sourceId: "query:1" },
      ]);
    });

    it("answers nothing to another project, another trace, another key version or a far window", async () => {
      await repository.insert([record()]);

      for (const query of [
        { ...traceQuery, tenantId: "project-2" },
        { ...traceQuery, traceId: "trace-2" },
        { ...traceQuery, keyVersion: EVAL_RESULTS_KEY_VERSION + 1 },
        { ...traceQuery, occurredFrom: AT + 10_000, occurredUntil: AT + 20_000 },
      ]) {
        await expect(repository.findLatestByTrace(query)).resolves.toEqual([]);
      }
    });
  });
});
