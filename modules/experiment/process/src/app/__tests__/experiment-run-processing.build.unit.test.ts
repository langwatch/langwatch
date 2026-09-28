import { createApiFixture } from "@langwatch/api-fixture";
import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryDriver,
  type QueryResult,
} from "@langwatch/clickhouse-client";
import type { SuiteApi } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import { experimentRunEventStreamChannels } from "../../channels/experiment-run-event-stream-channels.registry.ts";
import type { WorkflowEvaluationRunner } from "../../eventing/experiment-workflow-evaluation.subscriber.ts";
import { MemoryExperimentRunAbortRepository } from "../../repositories/memory/memory.experiment-run-abort.repository.ts";
import { MemoryExperimentRunFoldRepository } from "../../repositories/memory/memory.experiment-run-fold.repository.ts";
import type { ExecutionDataServices } from "../../services/experiment-execution-data.service.ts";
import type { ExperimentRunBoardWriteBackService } from "../../services/experiment-run-board-write-back.service.ts";
import type { ExperimentRunCellService } from "../../services/experiment-run-cell.service.ts";
import { ExperimentRunCommandDispatcherService } from "../../services/experiment-run-command-dispatcher.service.ts";
import { buildExperimentRunProcessing } from "../experiment-composition.build.ts";

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
  const pipeline = buildExperimentRunProcessing({
    clickhouse: new ClickHouseQueryClient({ driver: new SilentDriver() }),
    redis: undefined,
    defaultRetentionDays: () => {
      retentionReads += 1;
      return 49;
    },
    workflowEvaluations: createApiFixture<WorkflowEvaluationRunner>({}, "workflowEvaluations"),
    runCells: {
      folds: MemoryExperimentRunFoldRepository.create(),
      abort: MemoryExperimentRunAbortRepository.create(),
      cells: createApiFixture<ExperimentRunCellService>({}, "cells"),
      stream: experimentRunEventStreamChannels.memory.create(),
      boardWriteBack: createApiFixture<ExperimentRunBoardWriteBackService>({}, "boardWriteBack"),
      services: createApiFixture<ExecutionDataServices>({}, "services"),
      ownership: createApiFixture<Pick<SuiteApi, "assertConnectedAgentsRunnable">>({}, "ownership"),
      concurrency: 1,
      refusals: {},
    },
    commands: ExperimentRunCommandDispatcherService.create(),
  });
  return { pipeline, retentionReads: () => retentionReads };
}

describe("buildExperimentRunProcessing", () => {
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
