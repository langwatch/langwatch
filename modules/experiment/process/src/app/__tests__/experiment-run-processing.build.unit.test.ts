import { createApiFixture } from "@langwatch/api-fixture";
import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryDriver,
  type QueryResult,
} from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import type { WorkflowEvaluationRunner } from "../../eventing/experiment-workflow-evaluation.subscriber.ts";
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

    it("reads the retention default only when a row is written, never while composing", () => {
      const { retentionReads } = build();

      expect(retentionReads()).toBe(0);
    });
  });
});
