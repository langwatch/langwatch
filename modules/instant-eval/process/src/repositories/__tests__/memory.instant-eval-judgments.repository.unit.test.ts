/**
 * A run's judgements: isolated by project, paged by the sort key with a
 * cursor that never repeats a row, narrowed to one question or to the
 * matches. @see specs/instant-evals/instant-eval-api.feature
 */

import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import type { InstantEvalJudgmentRecord } from "../instant-eval-judgments.repository.ts";
import { MemoryInstantEvalJudgmentsRepository } from "../memory/memory.instant-eval-judgments.repository.ts";

const THIS_PROJECT = "project-1";
const OTHER_PROJECT = "project-2";
const RUN_ID = "instanteval_1";
const WRITTEN_AT = Temporal.Instant.from("2026-09-18T10:00:00Z").epochMilliseconds;

const WINDOW = {
  runId: RUN_ID,
  writtenFrom: Temporal.Instant.fromEpochMilliseconds(WRITTEN_AT - 60_000),
  writtenUntil: Temporal.Instant.fromEpochMilliseconds(WRITTEN_AT + 60_000),
};

let repository: MemoryInstantEvalJudgmentsRepository;

function record(overrides: Partial<InstantEvalJudgmentRecord> = {}): InstantEvalJudgmentRecord {
  return {
    TenantId: THIS_PROJECT,
    RunId: RUN_ID,
    TraceId: "trace-a",
    QuestionId: "mood",
    ThreadId: "thread-a",
    SpanId: "",
    Kind: "category",
    Status: "judged",
    Passed: null,
    Score: null,
    Label: "annoyed",
    Probability: 0.91,
    Probabilities: JSON.stringify({ annoyed: 0.91, calm: 0.09 }),
    Error: "",
    OccurredAt: WRITTEN_AT,
    CreatedAt: WRITTEN_AT,
    UpdatedAt: WRITTEN_AT,
    ...overrides,
  };
}

beforeEach(async () => {
  repository = MemoryInstantEvalJudgmentsRepository.create();
  await repository.insert([
    record({ TraceId: "trace-a", Label: "annoyed" }),
    record({ TraceId: "trace-b", Label: "annoyed" }),
    record({ TraceId: "trace-c", Label: "calm", Probability: 0.72 }),
  ]);
  await repository.insert([record({ TenantId: OTHER_PROJECT, Label: "furious" })]);
});

describe("given a run's judgements", () => {
  describe("when another project asks for the same run", () => {
    it("answers only the judgements written for the asking project", async () => {
      const mine = await repository.getPage({ ...WINDOW, projectId: THIS_PROJECT, limit: 100 });
      const theirs = await repository.getPage({ ...WINDOW, projectId: OTHER_PROJECT, limit: 100 });

      expect(mine.judgments).toHaveLength(3);
      expect(mine.judgments.map((one) => one.label)).not.toContain("furious");
      expect(theirs.judgments.map((one) => one.label)).toEqual(["furious"]);
    });
  });

  describe("when the same key is written twice", () => {
    it("collapses to one row, so a redelivered page is not counted twice", async () => {
      await repository.insert([record({ TraceId: "trace-a", Label: "calm" })]);

      const page = await repository.getPage({ ...WINDOW, projectId: THIS_PROJECT, limit: 100 });

      expect(page.judgments).toHaveLength(3);
      expect(page.judgments.find((one) => one.traceId === "trace-a")?.label).toBe("calm");
    });
  });

  describe("when they are read page by page", () => {
    it("hands back a cursor that starts the next page after the last row", async () => {
      const first = await repository.getPage({ ...WINDOW, projectId: THIS_PROJECT, limit: 2 });

      expect(first.judgments.map((one) => one.traceId)).toEqual(["trace-a", "trace-b"]);
      expect(first.nextCursor).toBeDefined();

      const second = await repository.getPage({
        ...WINDOW,
        projectId: THIS_PROJECT,
        limit: 2,
        ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
      });

      expect(second.judgments.map((one) => one.traceId)).toEqual(["trace-c"]);
      expect(second.nextCursor).toBeUndefined();
    });
  });

  describe("when they are narrowed", () => {
    it("keeps one question, and keeps only the rows that matched", async () => {
      await repository.insert([
        record({ TraceId: "trace-d", QuestionId: "annoyed", Kind: "boolean", Passed: 1 }),
        record({ TraceId: "trace-e", QuestionId: "annoyed", Kind: "boolean", Passed: 0 }),
      ]);

      const question = await repository.getPage({
        ...WINDOW,
        projectId: THIS_PROJECT,
        limit: 100,
        questionId: "annoyed",
      });
      const matched = await repository.getPage({
        ...WINDOW,
        projectId: THIS_PROJECT,
        limit: 100,
        questionId: "annoyed",
        matched: true,
      });

      expect(question.judgments.map((one) => one.traceId)).toEqual(["trace-d", "trace-e"]);
      expect(matched.judgments.map((one) => one.traceId)).toEqual(["trace-d"]);
      expect(matched.judgments[0]?.passed).toBe(true);
    });

    it("reads a category's distribution back as numbers, and an unwritten one as none", async () => {
      await repository.insert([record({ TraceId: "trace-f", Probabilities: "" })]);

      const page = await repository.getPage({ ...WINDOW, projectId: THIS_PROJECT, limit: 100 });
      const judged = page.judgments.find((one) => one.traceId === "trace-a");
      const bare = page.judgments.find((one) => one.traceId === "trace-f");

      expect(judged?.probabilities).toEqual({ annoyed: 0.91, calm: 0.09 });
      expect(bare?.probabilities).toBeNull();
    });
  });

  describe("when a few whole traces are sampled", () => {
    it("answers every judgement of the traces it picked, and no more traces than asked", async () => {
      const sample = await repository.findSample({
        ...WINDOW,
        projectId: THIS_PROJECT,
        traces: 2,
        shouldPreferMatched: false,
        seed: 7,
      });

      expect(new Set(sample.map((one) => one.traceId)).size).toBe(2);
      expect(sample.every((one) => one.questionId === "mood")).toBe(true);
    });

    it("picks the same traces for the same seed and different ones for another", async () => {
      const ask = (seed: number) =>
        repository.findSample({
          ...WINDOW,
          projectId: THIS_PROJECT,
          traces: 1,
          shouldPreferMatched: false,
          seed,
        });

      const [once, again] = await Promise.all([ask(7), ask(7)]);

      expect(once.map((one) => one.traceId)).toEqual(again.map((one) => one.traceId));
    });
  });
});
