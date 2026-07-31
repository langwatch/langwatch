/**
 * The sweep itself: how the service drives the repository page by page, what it
 * drops on the way, and when it stops.
 *
 * A hand-written repository stub rather than a mock library — the sweep's whole
 * contract is "ask for a page, follow the cursor, stop", and a stub that
 * actually paginates is the only way to observe that. It records the parameters
 * it was called with so scope can be asserted at the boundary the real
 * repository turns into SQL.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */

import Parse from "papaparse";
import { describe, expect, it } from "vitest";
import type {
  ExportableRun,
  SimulationRepository,
} from "~/server/app-layer/simulations/repositories/simulation.repository";
import { NullSimulationRepository } from "~/server/app-layer/simulations/repositories/simulation.repository";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { ScenarioRunExportService } from "../scenario-run-export.service";
import type { ScenarioRunExportRequest } from "../types";

function buildRun(overrides: Partial<ExportableRun> = {}): ExportableRun {
  return {
    scenarioRunId: "run_1",
    scenarioId: "scenario_1",
    batchRunId: "batch_1",
    scenarioSetId: "set_1",
    name: "Refund Request",
    description: null,
    metadata: null,
    status: ScenarioRunStatus.SUCCESS,
    results: {
      verdict: Verdict.SUCCESS,
      reasoning: "The agent offered a refund.",
      metCriteria: ["stays polite"],
      unmetCriteria: [],
      error: undefined,
    },
    messages: [],
    traceIds: [],
    timestamp: 1785177315009,
    updatedAt: 1785177315009,
    durationInMs: 8400,
    totalCost: 0.031,
    ...overrides,
  } as ExportableRun;
}

type FindCall = Parameters<SimulationRepository["findRunsForExport"]>[0];

/**
 * Serves the given pages in order, one per call, and remembers every request.
 * `hasMore` and `nextCursor` follow from the position in the list, so a caller
 * that ignores the cursor loops forever and a caller that stops early is
 * visible in `calls`.
 */
class PagingRepositoryStub extends NullSimulationRepository {
  readonly calls: FindCall[] = [];

  constructor(private readonly pages: ExportableRun[][]) {
    super();
  }

  override async countRunsForExport(): Promise<number> {
    return this.pages.flat().length;
  }

  override async findRunsForExport(params: FindCall): Promise<{
    runs: ExportableRun[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    this.calls.push(params);
    const index = params.cursor ? Number(params.cursor) : 0;
    const runs = this.pages[index] ?? [];
    const hasMore = index < this.pages.length - 1;
    return {
      runs,
      hasMore,
      ...(hasMore ? { nextCursor: String(index + 1) } : {}),
    };
  }
}

function request(
  overrides: Partial<ScenarioRunExportRequest> = {},
): ScenarioRunExportRequest {
  return { projectId: "project_1", mode: "criteria", ...overrides };
}

async function collect(
  generator: AsyncGenerator<{
    chunk: string;
    progress: { exported: number; total: number };
  }>,
): Promise<{ csv: string; progress: { exported: number; total: number }[] }> {
  let csv = "";
  const progress: { exported: number; total: number }[] = [];
  for await (const yielded of generator) {
    csv += yielded.chunk;
    progress.push(yielded.progress);
  }
  return { csv, progress };
}

function rowsOf(csv: string): Record<string, string>[] {
  return Parse.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
  }).data;
}

describe("ScenarioRunExportService", () => {
  describe("when the run history spans several pages", () => {
    /**
     * The serializer is told `includeHeader` only for the first batch, so a
     * file assembled from several pages must not repeat it. Asserted on the
     * assembled file rather than on the flag, because the flag being right and
     * the file being wrong is the failure worth catching.
     *
     * @scenario The header row is written once
     */
    it("writes the header on the first batch only", async () => {
      const repository = new PagingRepositoryStub([
        [buildRun({ scenarioRunId: "a" }), buildRun({ scenarioRunId: "b" })],
        [buildRun({ scenarioRunId: "c" })],
      ]);
      const service = new ScenarioRunExportService(repository);

      const { csv } = await collect(
        service.exportRuns({ request: request({ mode: "full" }) }),
      );

      const headerLines = csv
        .split("\n")
        .filter((line) => line.startsWith("run_scenario_name,"));
      expect(headerLines).toHaveLength(1);
      expect(rowsOf(csv).map((row) => row.run_scenario_run_id)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    /**
     * @scenario Progress is shown while a large export streams
     */
    it("reports runs visited against the total, reaching it at the end", async () => {
      const repository = new PagingRepositoryStub([
        [buildRun({ scenarioRunId: "a" }), buildRun({ scenarioRunId: "b" })],
        [buildRun({ scenarioRunId: "c" })],
      ]);
      const service = new ScenarioRunExportService(repository);

      const { progress } = await collect(
        service.exportRuns({ request: request({ mode: "full" }) }),
      );

      expect(progress).toEqual([
        { exported: 2, total: 3 },
        { exported: 3, total: 3 },
      ]);
    });
  });

  describe("when the client cancels mid-export", () => {
    /**
     * Without the signal the sweep keeps paging ClickHouse long after nobody is
     * reading: `controller.enqueue` only throws on the *next* chunk, so a large
     * export would run to exhaustion for a download already abandoned.
     *
     * @scenario Cancelling an in-flight export stops it
     */
    it("stops asking the repository for more pages", async () => {
      const repository = new PagingRepositoryStub([
        [buildRun({ scenarioRunId: "a" })],
        [buildRun({ scenarioRunId: "b" })],
        [buildRun({ scenarioRunId: "c" })],
      ]);
      const service = new ScenarioRunExportService(repository);
      const controller = new AbortController();

      const generator = service.exportRuns({
        request: request({ mode: "full" }),
        signal: controller.signal,
      });

      await generator.next();
      expect(repository.calls).toHaveLength(1);

      controller.abort();
      const afterAbort = await generator.next();

      expect(afterAbort.done).toBe(true);
      expect(repository.calls).toHaveLength(1);
    });
  });

  describe("when a pass/fail filter is applied", () => {
    /**
     * Applied after mapping, not in SQL: STALLED is derived from timestamps by
     * resolveRunStatus rather than stored, so only a post-mapping filter can
     * reproduce what the list on screen shows.
     *
     * @scenario Export honours the pass/fail filter
     */
    it("keeps only the runs in the requested outcome category", async () => {
      const repository = new PagingRepositoryStub([
        [
          buildRun({ scenarioRunId: "passed", status: ScenarioRunStatus.SUCCESS }),
          buildRun({ scenarioRunId: "failed", status: ScenarioRunStatus.FAILED }),
          buildRun({ scenarioRunId: "errored", status: ScenarioRunStatus.ERROR }),
          buildRun({ scenarioRunId: "stalled", status: ScenarioRunStatus.STALLED }),
        ],
      ]);
      const service = new ScenarioRunExportService(repository);

      const { csv } = await collect(
        service.exportRuns({
          request: request({ mode: "full", passFailStatus: "fail" }),
        }),
      );

      // ERROR and FAILED are both "failure" — the filter is by category, so a
      // run that died before the judge saw it is a failure like any other.
      expect(rowsOf(csv).map((row) => row.run_scenario_run_id)).toEqual([
        "failed",
        "errored",
      ]);
    });

    /**
     * A filter that removes every run on the first page still has to produce a
     * file a spreadsheet will open, not a zero-byte download.
     */
    it("still writes a header when every run is filtered out", async () => {
      const repository = new PagingRepositoryStub([
        [buildRun({ scenarioRunId: "passed", status: ScenarioRunStatus.SUCCESS })],
      ]);
      const service = new ScenarioRunExportService(repository);

      const { csv } = await collect(
        service.exportRuns({
          request: request({ mode: "full", passFailStatus: "fail" }),
        }),
      );

      expect(csv.split("\n")[0]).toContain("run_scenario_name");
      expect(rowsOf(csv)).toHaveLength(0);
    });
  });

  describe("when the panel is scoped to a set, a scenario and a date range", () => {
    /**
     * The service does not filter these itself — it hands them to the
     * repository, which turns them into SQL. What is worth pinning is that it
     * passes on every one of them: a scope silently dropped here exports more
     * than the user was looking at.
     */
    it("passes the whole scope through to the repository", async () => {
      const repository = new PagingRepositoryStub([[buildRun()]]);
      const service = new ScenarioRunExportService(repository);

      await collect(
        service.exportRuns({
          request: request({
            scenarioSetId: "set_7",
            scenarioId: "scenario_3",
            startDate: 1_700_000_000_000,
            endDate: 1_800_000_000_000,
          }),
        }),
      );

      expect(repository.calls[0]).toMatchObject({
        projectId: "project_1",
        scenarioSetId: "set_7",
        scenarioId: "scenario_3",
        startDate: 1_700_000_000_000,
        endDate: 1_800_000_000_000,
      });
    });
  });
});
