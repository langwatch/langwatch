/**
 * @vitest-environment node
 * The run table's daily read, stated once and run against every backend the
 * package can reach without a store. The ClickHouse tier is covered by
 * instant-eval-daily-run-counts.integration.test.ts with the same seed.
 */
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  InstantEvalRunRepository,
  InstantEvalRunRow,
} from "../instant-eval-run.repository.ts";
import { MemoryInstantEvalRunRepository } from "../memory/memory.instant-eval-run.repository.ts";

const backends: readonly {
  name: string;
  create: (now: () => Instant) => InstantEvalRunRepository;
}[] = [{ name: "memory", create: (now) => MemoryInstantEvalRunRepository.create(now) }];

const DAY_MS = 24 * 60 * 60 * 1000;
const day = Date.UTC(2026, 10, 20);
const since = day - 3 * DAY_MS;
const until = day + DAY_MS;

describe.each(backends)("given the $name instant eval run repository", ({ create }) => {
  /** One store whose clock the seed moves, so each run is created at its own instant. */
  function repositoryAt() {
    let nowMs = day;
    const repository = create(() => Temporal.Instant.fromEpochMilliseconds(nowMs));
    async function runEndingAs({
      id,
      atMs,
      status,
      error = null,
      projectId = "project-1",
      total = 10,
      progress = status === "FINISHED" ? 10 : 4,
      priceUsd = 0.5,
    }: {
      id: string;
      atMs: number;
      status: InstantEvalRunRow["status"];
      error?: string | null;
      projectId?: string;
      total?: number | null;
      progress?: number;
      priceUsd?: number;
    }) {
      nowMs = atMs;
      const created = await repository.create({
        id,
        projectId,
        name: null,
        sql: "SELECT 1",
        parameters: {},
        questions: [],
        plan: [],
        rowLimit: 10,
      });
      await repository.write({
        ...created,
        status,
        error,
        total,
        progress,
        priceUsd,
        updatedAt: Temporal.Instant.fromEpochMilliseconds(atMs + 1_000),
      });
    }
    return { repository, runEndingAs };
  }
  const byDay = <Row extends { day: number }>(rows: Row[]) =>
    rows.toSorted((a, b) => a.day - b.day);

  describe("when runs are counted per day", () => {
    it("carries each day's runs, the rows judged and the failure under its code", async () => {
      const { repository, runEndingAs } = repositoryAt();
      await runEndingAs({ id: "done", atMs: day + 3_600_000, status: "FINISHED" });
      await runEndingAs({
        id: "failed",
        atMs: day + 7_200_000,
        status: "FAILED",
        error: "provider_rate_limited",
      });
      await runEndingAs({ id: "at-since", atMs: since, status: "FINISHED" });
      await runEndingAs({ id: "at-until", atMs: until, status: "FINISHED" });
      await runEndingAs({
        id: "elsewhere",
        atMs: day + 3_600_000,
        status: "FINISHED",
        projectId: "project-2",
      });

      const days = await repository.findDailyRunCounts({ projectIds: ["project-1"], since, until });

      expect(byDay(days)).toEqual([
        {
          projectId: "project-1",
          day: since,
          runs: 1,
          judgedRows: 10,
          largestRun: 10,
          failedRuns: 0,
          failedByCode: [],
          priceUsd: 0.5,
          lastRunAt: since,
        },
        {
          projectId: "project-1",
          day,
          runs: 2,
          judgedRows: 14,
          largestRun: 10,
          failedRuns: 1,
          failedByCode: [{ code: "provider_rate_limited", count: 1 }],
          priceUsd: 1,
          lastRunAt: day + 7_200_000,
        },
      ]);
    });

    it("counts a rewritten run once, at its latest version", async () => {
      const { repository, runEndingAs } = repositoryAt();
      await runEndingAs({ id: "run-1", atMs: day, status: "RUNNING", progress: 2 });
      await runEndingAs({ id: "run-1", atMs: day, status: "FAILED", error: "budget_exhausted" });

      await expect(
        repository.findDailyRunCounts({ projectIds: ["project-1"], since, until }),
      ).resolves.toEqual([
        {
          projectId: "project-1",
          day,
          runs: 1,
          judgedRows: 4,
          largestRun: 10,
          failedRuns: 1,
          failedByCode: [{ code: "budget_exhausted", count: 1 }],
          priceUsd: 0.5,
          lastRunAt: day,
        },
      ]);
    });

    it("groups failures by code, a failure with no code under the empty code", async () => {
      const { repository, runEndingAs } = repositoryAt();
      await runEndingAs({
        id: "f1",
        atMs: day + 1,
        status: "FAILED",
        error: "provider_rate_limited",
      });
      await runEndingAs({
        id: "f2",
        atMs: day + 2,
        status: "FAILED",
        error: "provider_rate_limited",
      });
      await runEndingAs({ id: "f3", atMs: day + 3, status: "FAILED", error: "sql_invalid" });
      await runEndingAs({ id: "f4", atMs: day + 4, status: "FAILED", error: null });
      await runEndingAs({
        id: "queued",
        atMs: day + 5,
        status: "QUEUED",
        total: null,
        progress: 0,
      });

      const [only, ...rest] = await repository.findDailyRunCounts({
        projectIds: ["project-1"],
        since,
        until,
      });

      expect(rest).toEqual([]);
      expect({
        ...only,
        failedByCode: only?.failedByCode.toSorted((a, b) => a.code.localeCompare(b.code)),
      }).toEqual({
        projectId: "project-1",
        day,
        runs: 5,
        judgedRows: 16,
        largestRun: 10,
        failedRuns: 4,
        failedByCode: [
          { code: "", count: 1 },
          { code: "provider_rate_limited", count: 2 },
          { code: "sql_invalid", count: 1 },
        ],
        priceUsd: 2.5,
        lastRunAt: day + 5,
      });
    });

    it("cuts days at UTC midnight and keeps each asked project apart", async () => {
      const { repository, runEndingAs } = repositoryAt();
      await runEndingAs({ id: "before", atMs: day - 1, status: "FINISHED", total: 3, progress: 3 });
      await runEndingAs({ id: "midnight", atMs: day, status: "FINISHED", total: 7, progress: 7 });
      await runEndingAs({ id: "other", atMs: day, status: "FINISHED", projectId: "project-2" });
      await runEndingAs({ id: "unasked", atMs: day, status: "FINISHED", projectId: "project-3" });

      const days = await repository.findDailyRunCounts({
        projectIds: ["project-1", "project-2", "project-1"],
        since,
        until,
      });

      expect(
        days
          .toSorted((a, b) => a.projectId.localeCompare(b.projectId) || a.day - b.day)
          .map((row) => [row.projectId, row.day, row.runs, row.largestRun, row.lastRunAt]),
      ).toEqual([
        ["project-1", day - DAY_MS, 1, 3, day - 1],
        ["project-1", day, 1, 7, day],
        ["project-2", day, 1, 10, day],
      ]);
    });

    it("answers no days when the window holds no run", async () => {
      await expect(
        create(() => Temporal.Instant.fromEpochMilliseconds(day)).findDailyRunCounts({
          projectIds: ["project-1"],
          since,
          until,
        }),
      ).resolves.toEqual([]);
    });
  });
});
