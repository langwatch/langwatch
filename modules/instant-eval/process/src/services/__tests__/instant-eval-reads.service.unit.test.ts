/**
 * Reading a run back: every judgement read is bounded by the run's own
 * timestamps, which is what prunes partitions instead of walking the table.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { HandledError } from "@langwatch/handled-error";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { AT, instantEvalRunRow } from "../../__tests__/instant-eval.fixtures.ts";
import type {
  InstantEvalJudgmentPage,
  InstantEvalJudgmentQuery,
  InstantEvalJudgmentSampleQuery,
  InstantEvalJudgmentsRepository,
} from "../../repositories/instant-eval-judgments.repository.ts";
import { MemoryInstantEvalRunRepository } from "../../repositories/memory/memory.instant-eval-run.repository.ts";
import { InstantEvalReadsService } from "../instant-eval-reads.service.ts";

const NOW = Temporal.Instant.from("2026-09-18T12:00:00Z");

/** A judgements store that records what it was asked and answers nothing. */
class RecordingJudgments implements InstantEvalJudgmentsRepository {
  readonly pages: InstantEvalJudgmentQuery[] = [];

  async countUsage(): Promise<number> {
    return 0;
  }

  async insert(): Promise<void> {
    // Nothing is written by a read.
  }

  async getPage(query: InstantEvalJudgmentQuery): Promise<InstantEvalJudgmentPage> {
    this.pages.push(query);
    return { judgments: [] };
  }

  async findSample(_query: InstantEvalJudgmentSampleQuery): Promise<[]> {
    return [];
  }
}

let runs: MemoryInstantEvalRunRepository;
let judgments: RecordingJudgments;
let reads: InstantEvalReadsService;

beforeEach(() => {
  runs = MemoryInstantEvalRunRepository.create(() => AT);
  judgments = new RecordingJudgments();
  reads = InstantEvalReadsService.create({ runs, judgments, now: () => NOW });
});

const store = (row = instantEvalRunRow()) => runs.write(row);

describe("given a run of this project", () => {
  describe("when it is read by id", () => {
    it("answers the row", async () => {
      await store();

      const row = await reads.getRun({ projectId: "project-1", runId: "run-1" });

      expect(row.id).toBe("run-1");
    });

    it("refuses another project's run by name rather than answering it", async () => {
      await store();

      const refusal = await reads
        .getRun({ projectId: "project-2", runId: "run-1" })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(HandledError);
      expect(refusal instanceof HandledError ? refusal.code : "").toBe("instant_eval_not_found");
    });
  });

  describe("when its results are paged", () => {
    it("bounds the read by the run's own window and passes the narrowing through", async () => {
      const startedAt = Temporal.Instant.from("2026-09-18T10:30:00Z");
      const finishedAt = Temporal.Instant.from("2026-09-18T11:00:00Z");
      await store(instantEvalRunRow({ startedAt, finishedAt, status: "FINISHED" }));

      await reads.getResultsPage({
        projectId: "project-1",
        runId: "run-1",
        limit: 50,
        questionId: "annoyed",
        isMatched: true,
      });

      expect(judgments.pages).toHaveLength(1);
      expect(judgments.pages[0]).toMatchObject({
        projectId: "project-1",
        runId: "run-1",
        limit: 50,
        questionId: "annoyed",
        matched: true,
      });
      expect(judgments.pages[0]?.writtenFrom).toBe(startedAt);
      expect(judgments.pages[0]?.writtenUntil).toBe(finishedAt);
    });

    it("bounds a run still going at creation and at now", async () => {
      await store(instantEvalRunRow({ startedAt: null, finishedAt: null }));

      await reads.getResultsPage({ projectId: "project-1", runId: "run-1", limit: 50 });

      expect(judgments.pages[0]?.writtenFrom).toBe(AT);
      expect(judgments.pages[0]?.writtenUntil).toBe(NOW);
    });

    it("refuses a run of another project before reading any judgement", async () => {
      await store();

      await expect(
        reads.getResultsPage({ projectId: "project-2", runId: "run-1", limit: 50 }),
      ).rejects.toBeInstanceOf(HandledError);
      expect(judgments.pages).toEqual([]);
    });
  });
});

describe("given the runs a client is looking at", () => {
  describe("when their progress is read", () => {
    it("answers the counters of the ones it may read and drops the rest", async () => {
      await store(instantEvalRunRow({ id: "run-1" }));
      await store(instantEvalRunRow({ id: "run-2", projectId: "project-2" }));

      const progress = await reads.findRunProgress({
        projectId: "project-1",
        runIds: ["run-1", "run-2", "run-missing"],
      });

      expect(progress.map((one) => one.id)).toEqual(["run-1"]);
      expect(progress[0]).toMatchObject({ status: "running", progress: 40, matched: 12 });
    });
  });

  describe("when the windows their judgements were written in are read", () => {
    it("dates the ones it may read, keeping the reader's own question and target", async () => {
      const createdAt = Temporal.Instant.from("2026-09-18T10:00:00Z");
      await store(instantEvalRunRow({ id: "run-1", createdAt, finishedAt: null }));
      await store(instantEvalRunRow({ id: "run-2", projectId: "project-2" }));

      const windows = await reads.findRunWindows({
        projectId: "project-1",
        references: [
          { question: "is it annoyed", target: "traces", runId: "run-1" },
          { question: "is it annoyed", target: "threads", runId: "run-2" },
          { question: "is it annoyed", target: "traces", runId: "run-missing" },
        ],
      });

      expect(windows).toHaveLength(1);
      expect(windows[0]).toMatchObject({
        question: "is it annoyed",
        target: "traces",
        runId: "run-1",
      });
      expect(windows[0]?.writtenFrom.toString()).toBe("2026-09-18T09:00:00Z");
      expect(windows[0]?.writtenUntil.toString()).toBe("2026-09-18T13:00:00Z");
    });

    it("answers nothing for a reader that named no run", async () => {
      expect(await reads.findRunWindows({ projectId: "project-1", references: [] })).toEqual([]);
    });
  });

  describe("when the project's runs are listed", () => {
    it("answers an empty list for a project with none", async () => {
      expect(await reads.findRuns({ projectId: "project-3", limit: 10 })).toEqual([]);
    });
  });
});
