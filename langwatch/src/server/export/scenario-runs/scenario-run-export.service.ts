/**
 * ScenarioRunExportService — domain layer for scenario run CSV export.
 *
 * Sweeps the run history in keyset-paginated pages and yields serialized CSV
 * chunks through an AsyncGenerator, so the API layer can stream straight to the
 * HTTP response and memory stays flat regardless of how many runs match.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */

import { createLogger } from "@langwatch/observability";
import type {
  ExportableRun,
  SimulationRepository,
} from "~/server/app-layer/simulations/repositories/simulation.repository";
import { categorizeRunStatus } from "~/server/scenarios/scenario-run-category";
import {
  serializeRunsToCriteriaCsv,
  serializeRunsToFullCsv,
} from "./csv-serializer";
import type {
  ScenarioRunExportProgress,
  ScenarioRunExportRequest,
  ScenarioRunExportStatusFilter,
} from "./types";

const BATCH_SIZE = 100;

const logger = createLogger("langwatch:export:scenario-runs");

/**
 * The run-history dropdown's values, mapped onto outcome categories.
 *
 * Deliberately not pushed into SQL: STALLED is derived from timestamps at map
 * time by resolveRunStatus rather than stored, so only a post-mapping filter
 * can reproduce what the list shows.
 */
const FILTER_TO_CATEGORY: Record<ScenarioRunExportStatusFilter, string> = {
  pass: "success",
  fail: "failure",
  stalled: "stalled",
};

export class ScenarioRunExportService {
  constructor(private readonly repository: SimulationRepository) {}

  /**
   * How many runs the sweep will visit. Progress counts visited runs rather
   * than written rows, because criteria mode emits several rows per run and a
   * category filter drops runs entirely.
   */
  async getTotalCount({
    request,
  }: {
    request: ScenarioRunExportRequest;
  }): Promise<number> {
    return this.repository.countRunsForExport({
      projectId: request.projectId,
      scenarioSetId: request.scenarioSetId,
      scenarioId: request.scenarioId,
      startDate: request.startDate,
      endDate: request.endDate,
    });
  }

  async *exportRuns({
    request,
  }: {
    request: ScenarioRunExportRequest;
  }): AsyncGenerator<{
    chunk: string;
    progress: ScenarioRunExportProgress;
  }> {
    logger.info(
      { projectId: request.projectId, mode: request.mode },
      "Starting scenario run export",
    );

    const total = await this.getTotalCount({ request });
    let visited = 0;
    let isFirstBatch = true;
    let cursor: string | undefined;

    while (true) {
      const page = await this.repository.findRunsForExport({
        projectId: request.projectId,
        scenarioSetId: request.scenarioSetId,
        scenarioId: request.scenarioId,
        startDate: request.startDate,
        endDate: request.endDate,
        limit: BATCH_SIZE,
        cursor,
      });

      visited += page.runs.length;
      const runs = applyStatusFilter({
        runs: page.runs,
        passFailStatus: request.passFailStatus,
      });

      // Emit the header even when the first page is entirely filtered out, so
      // the file is a valid empty CSV rather than a zero-byte download.
      const chunk = serializeBatch({
        runs,
        mode: request.mode,
        includeHeader: isFirstBatch,
      });

      if (chunk !== "") {
        yield { chunk, progress: { exported: visited, total } };
      }

      isFirstBatch = false;
      cursor = page.nextCursor;

      if (!page.hasMore || !cursor || page.runs.length === 0) break;
    }

    logger.info(
      { projectId: request.projectId, visited, total },
      "Scenario run export completed",
    );
  }
}

function applyStatusFilter({
  runs,
  passFailStatus,
}: {
  runs: ExportableRun[];
  passFailStatus?: ScenarioRunExportStatusFilter;
}): ExportableRun[] {
  if (!passFailStatus) return runs;
  const wanted = FILTER_TO_CATEGORY[passFailStatus];
  return runs.filter((run) => categorizeRunStatus(run.status) === wanted);
}

function serializeBatch({
  runs,
  mode,
  includeHeader,
}: {
  runs: ExportableRun[];
  mode: ScenarioRunExportRequest["mode"];
  includeHeader: boolean;
}): string {
  switch (mode) {
    case "criteria":
      return serializeRunsToCriteriaCsv({ runs, includeHeader });
    case "full":
      return serializeRunsToFullCsv({ runs, includeHeader });
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unsupported export mode: ${String(_exhaustive)}`);
    }
  }
}
