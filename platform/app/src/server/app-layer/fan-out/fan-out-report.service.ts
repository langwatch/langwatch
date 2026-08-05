/**
 * Blast-radius reporting: reads the ClickHouse-backed run data for a fan-out
 * batch's shared batchRunId and aggregates "N of M adjacent scenarios also
 * failed", broken down by lens. Pure read + aggregation — verdicts stay in
 * ClickHouse (simulation_runs), never duplicated into Postgres.
 *
 * See specs/scenarios/adjacent-scenario-blast-radius.feature.
 */

import type { FanOutVariant } from "@prisma/client";
import type { SimulationRunService } from "~/server/app-layer/simulations/simulation-run.service";
import {
  FanOutBatchNotFoundError,
  FanOutBatchNotRunError,
} from "~/server/scenarios/fan-out/errors";
import type { FanOutRepository } from "~/server/scenarios/fan-out/fan-out.repository";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

/**
 * A run counts against the blast radius when it did not demonstrate the agent
 * handling the case. STALLED belongs here with the rest: it finished without
 * meeting the criteria, and scoring it as a pass would quietly shrink the
 * blast radius every time a run wedged.
 */
const FAILING_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.CANCELLED,
  ScenarioRunStatus.STALLED,
]);

export type VariantReportEntry = {
  variant: FanOutVariant;
  run: ScenarioRunData | null;
  failed: boolean | null; // null while still running / not yet reported
};

export type BlastRadiusReport = {
  seedRun: ScenarioRunData | null;
  variants: VariantReportEntry[];
  totalVariants: number;
  finishedVariants: number;
  failedVariants: number;
  /** failedVariants / finishedVariants, or null until at least one has finished */
  blastRadius: number | null;
  byLens: Record<string, { total: number; failed: number; finished: number }>;
};

export class FanOutReportService {
  constructor(
    private readonly simulationRuns: SimulationRunService,
    private readonly fanOutRepository: FanOutRepository,
  ) {}

  static create(params: {
    simulationRuns: SimulationRunService;
    fanOutRepository: FanOutRepository;
  }): FanOutReportService {
    return new FanOutReportService(
      params.simulationRuns,
      params.fanOutRepository,
    );
  }

  /** Resolves the batch inside the project, then reports on its run. */
  async getReportForBatch(params: {
    projectId: string;
    batchId: string;
  }): Promise<BlastRadiusReport> {
    const batch = await this.fanOutRepository.findBatchById({
      id: params.batchId,
      projectId: params.projectId,
    });
    if (!batch) {
      throw new FanOutBatchNotFoundError({ meta: { batchId: params.batchId } });
    }
    if (!batch.batchRunId) {
      throw new FanOutBatchNotRunError({ meta: { batchId: params.batchId } });
    }

    return this.getBlastRadiusReport({
      projectId: params.projectId,
      scenarioSetId: batch.scenarioSetId,
      batchRunId: batch.batchRunId,
      seedScenarioRunId: batch.seedScenarioRunId,
      variants: batch.variants,
    });
  }

  async getBlastRadiusReport(params: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
    seedScenarioRunId: string | null;
    variants: FanOutVariant[];
  }): Promise<BlastRadiusReport> {
    const result = await this.simulationRuns.getRunDataForBatchRun({
      projectId: params.projectId,
      scenarioSetId: params.scenarioSetId,
      batchRunId: params.batchRunId,
    });

    // `BatchRunDataResult` is a discriminated union: the `changed: false`
    // branch carries no `runs` at all. This call passes no `sinceTimestamp`,
    // so the store always answers `changed: true` and the empty branch is
    // unreachable in practice, but the narrowing is what makes `runs` legal.
    const runs = result.changed ? result.runs : [];
    const runsByScenarioRunId = new Map(
      runs.map((run) => [run.scenarioRunId, run]),
    );

    const seedRun = params.seedScenarioRunId
      ? (runsByScenarioRunId.get(params.seedScenarioRunId) ?? null)
      : null;

    const byLens: BlastRadiusReport["byLens"] = {};
    let finishedVariants = 0;
    let failedVariants = 0;

    const variantEntries: VariantReportEntry[] = params.variants.map(
      (variant) => {
        const run = variant.scenarioRunId
          ? (runsByScenarioRunId.get(variant.scenarioRunId) ?? null)
          : null;

        const lensBucket = (byLens[variant.lens] ??= {
          total: 0,
          failed: 0,
          finished: 0,
        });
        lensBucket.total += 1;

        let failed: boolean | null = null;
        if (run && isFinished(run.status)) {
          failed = FAILING_STATUSES.has(run.status);
          finishedVariants += 1;
          lensBucket.finished += 1;
          if (failed) {
            failedVariants += 1;
            lensBucket.failed += 1;
          }
        }

        return { variant, run, failed };
      },
    );

    return {
      seedRun,
      variants: variantEntries,
      totalVariants: params.variants.length,
      finishedVariants,
      failedVariants,
      blastRadius:
        finishedVariants > 0 ? failedVariants / finishedVariants : null,
      byLens,
    };
  }
}

function isFinished(status: ScenarioRunStatus): boolean {
  return (
    status === ScenarioRunStatus.SUCCESS ||
    status === ScenarioRunStatus.FAILED ||
    status === ScenarioRunStatus.ERROR ||
    status === ScenarioRunStatus.CANCELLED ||
    status === ScenarioRunStatus.STALLED
  );
}
