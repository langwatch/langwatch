/**
 * The runs an Explorer read's eval chips claim, dated from instant-eval's shared run table.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryTraceInstantEvalRunsRepository } from "../../repositories/memory/memory.trace-instant-eval-runs.repository.ts";
import { TraceInstantEvalRunService } from "../trace-instant-eval-run.service.ts";

const READ_AT = Temporal.Instant.from("2026-09-18T12:00:00Z");
const CREATED_AT = Temporal.Instant.from("2026-09-18T10:00:00Z");
const FINISHED_AT = Temporal.Instant.from("2026-09-18T11:00:00Z");

function serviceOver(runs: MemoryTraceInstantEvalRunsRepository) {
  return TraceInstantEvalRunService.create({ runs, now: () => READ_AT });
}

describe("given a run instant-eval recorded for the project", () => {
  describe("when an Explorer read checks the chip that claims it", () => {
    /** @scenario "A claimed run is dated from the run table instant-eval shares with trace" */
    it("dates it an hour either side of its own clock and keeps the chip's question and target", async () => {
      const runs = MemoryTraceInstantEvalRunsRepository.create({
        runs: [
          {
            projectId: "project-1",
            runId: "run-1",
            createdAt: CREATED_AT,
            finishedAt: FINISHED_AT,
          },
        ],
      });

      const resolved = await serviceOver(runs).findRegisteredRuns({
        projectId: "project-1",
        references: [{ question: "is the user annoyed", target: "threads", runId: "run-1" }],
      });

      expect(resolved).toEqual([
        {
          question: "is the user annoyed",
          target: "threads",
          runId: "run-1",
          writtenFrom: Temporal.Instant.from("2026-09-18T09:00:00Z").epochMilliseconds,
          writtenUntil: Temporal.Instant.from("2026-09-18T12:00:00Z").epochMilliseconds,
        },
      ]);
    });
  });
});

describe("given a claimed run instant-eval has not finished", () => {
  describe("when an Explorer read checks the claim", () => {
    /** @scenario "A claimed run still judging is dated up to the read" */
    it("closes the window an hour after the read", async () => {
      const runs = MemoryTraceInstantEvalRunsRepository.create({
        runs: [{ projectId: "project-1", runId: "run-1", createdAt: CREATED_AT, finishedAt: null }],
      });

      const [resolved] = await serviceOver(runs).findRegisteredRuns({
        projectId: "project-1",
        references: [{ question: "is the user annoyed", target: "traces", runId: "run-1" }],
      });

      expect(resolved?.writtenUntil).toBe(
        Temporal.Instant.from("2026-09-18T13:00:00Z").epochMilliseconds,
      );
    });
  });
});

describe("given a chip claiming a run instant-eval recorded for another project", () => {
  describe("when an Explorer read checks the claim", () => {
    /** @scenario "A claimed run another project recorded is not dated" */
    it("answers no window for it, so the chip stays pending", async () => {
      const runs = MemoryTraceInstantEvalRunsRepository.create({
        runs: [
          {
            projectId: "project-2",
            runId: "run-2",
            createdAt: CREATED_AT,
            finishedAt: FINISHED_AT,
          },
        ],
      });

      const resolved = await serviceOver(runs).findRegisteredRuns({
        projectId: "project-1",
        references: [
          { question: "is the user annoyed", target: "traces", runId: "run-2" },
          { question: "is the user annoyed", target: "traces", runId: "run-missing" },
        ],
      });

      expect(resolved).toEqual([]);
    });
  });
});
