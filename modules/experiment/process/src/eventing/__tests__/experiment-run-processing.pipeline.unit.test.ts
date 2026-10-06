import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryDriver,
  type QueryResult,
} from "@langwatch/clickhouse-client";
/**
 * @vitest-environment node
 * `experiment_run_processing` as a deployment without Redis composes it: the run-state fold
 * reads ClickHouse uncached, and the cell command and execution manager ride with it.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ClickHouseExperimentRunProcessingRepository } from "../../repositories/clickhouse/clickhouse.experiment-run-processing.repository.ts";
import { ClickHouseExperimentSession } from "../../repositories/clickhouse/clickhouse.experiment-session.store.ts";
import { MemoryExperimentRunEventStreamRepository } from "../../repositories/memory/memory.experiment-run-event-stream.repository.ts";
import { MemoryExperimentRunFoldRepository } from "../../repositories/memory/memory.experiment-run-fold.repository.ts";
import type { ExperimentRunBoardWriteBackService } from "../../services/experiment-run-board-write-back.service.ts";
import type { ExperimentRunCellService } from "../../services/experiment-run-cell.service.ts";
import { ExperimentRunCommandDispatcherService } from "../../services/experiment-run-command-dispatcher.service.ts";
import { ExecuteExperimentCellCommand } from "../experiment-run-cell.commands.ts";
import { completeRun, executeCell, failLostCell } from "../experiment-run-execution.intent.ts";
import { createExperimentRunFramesSubscriber } from "../experiment-run-frames.subscriber.ts";
import { ExperimentRunPlanStore } from "../experiment-run-plan.store.ts";
import { buildExperimentRunProcessingPipeline } from "../experiment-run-processing.pipeline.ts";
import { ExperimentRunProgressStore } from "../experiment-run-progress.store.ts";
import { ExperimentRunStateStore } from "../experiment-run-state.store.ts";
import type { WorkflowEvaluationRunner } from "../experiment-workflow-evaluation.subscriber.ts";

class SilentDriver implements QueryDriver {
  readonly inserts: InsertRequest[] = [];

  execute<Row>(): Promise<QueryResult<Row>> {
    return Promise.resolve({ rows: [] });
  }

  insert(request: InsertRequest): Promise<void> {
    this.inserts.push(request);
    return Promise.resolve();
  }

  command(): Promise<void> {
    return Promise.resolve();
  }
}

function build() {
  let retentionReads = 0;
  const defaultRetentionDays = () => {
    retentionReads += 1;
    return 49;
  };
  const folds = MemoryExperimentRunFoldRepository.create();
  const commands = ExperimentRunCommandDispatcherService.create();
  const eventing = ClickHouseExperimentRunProcessingRepository.create({
    resolveClient: ClickHouseExperimentSession.resolverOver(
      new ClickHouseQueryClient({ driver: new SilentDriver() }),
    ),
    clickhouseEnabled: true,
  });
  const pipeline = buildExperimentRunProcessingPipeline({
    workflowEvaluations: createApiFixture<WorkflowEvaluationRunner>({}, "workflowEvaluations"),
    experimentRunPlanFoldStore: ExperimentRunPlanStore.create({ repository: folds }),
    experimentRunProgressFoldStore: ExperimentRunProgressStore.create({ repository: folds }),
    executeCell: ExecuteExperimentCellCommand.create({
      cells: createApiFixture<ExperimentRunCellService>({}, "cells"),
    }),
    runExecution: {
      executeCell: executeCell(commands),
      failCell: failLostCell(commands),
      complete: completeRun({
        commands,
        boardWriteBack: createApiFixture<ExperimentRunBoardWriteBackService>({}, "boardWriteBack"),
      }),
    },
    runFrames: createExperimentRunFramesSubscriber({
      stream: MemoryExperimentRunEventStreamRepository.create(),
    }),
    retention: { resolve: async () => null },
    experimentRunStateFoldStore: ExperimentRunStateStore.create({
      repository: eventing.stateRepository({ defaultRetentionDays }),
    }),
    experimentRunItemAppendStore: eventing.itemStore({ defaultRetentionDays }),
  });
  return { pipeline, retentionReads: () => retentionReads };
}

describe("experiment_run_processing without Redis", () => {
  describe("when the deployment has no Redis", () => {
    it("builds experiment_run_processing with its run-state fold over ClickHouse", () => {
      const { pipeline } = build();

      expect(pipeline.metadata.name).toBe("experiment_run_processing");
      expect(pipeline.foldProjections.get("experimentRunState")).toBeDefined();
    });

    /** @scenario "The worker runs an opened cell by its ordinal and phase" */
    it("runs the run's cells from its plan and progress folds under its execution manager", () => {
      const { pipeline } = build();

      expect(pipeline.foldProjections.get("experimentRunPlan")).toBeDefined();
      expect(pipeline.foldProjections.get("experimentRunProgress")).toBeDefined();
      expect(pipeline.processManagers.has("experimentRunExecution")).toBe(true);
      expect(pipeline.commands.map((command) => command.definition.name)).toContain(
        "executeExperimentCell",
      );
    });

    it("reads the retention default only when a row is written, never while composing", () => {
      const { retentionReads } = build();

      expect(retentionReads()).toBe(0);
    });
  });
});
