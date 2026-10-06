/** @see modules/experiment/specs/experiment-run-results-completeness.feature */
import { createTenantId, type Event } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  ExperimentClickHouseRepository,
  type ExperimentEventingClickHouseClient,
} from "../../repositories/experiment-clickhouse.repository.ts";
import { evaluatorResultEventSchema } from "../experiment-run-events.process.ts";
import { ExperimentRunItemStore } from "../experiment-run-item.store.ts";
import { RecordEvaluatorResultCommand } from "../experiment-run-processing.commands.ts";
import {
  type ClickHouseExperimentRunResultRecord,
  ExperimentRunResultStorageMapProjection,
} from "../experiment-run-result-storage.projection.ts";

const TENANT = createTenantId("project_alpha");
const AGGREGATE_ID = "experiment_1:run_1";
const context = { tenantId: TENANT };

type Insert = Parameters<ExperimentEventingClickHouseClient["insert"]>[0];

/** A ClickHouse that keeps every insert it is handed. */
class RecordingClickHouse extends ExperimentClickHouseRepository {
  readonly inserts: Insert[] = [];

  resolveClient(): Promise<ExperimentEventingClickHouseClient> {
    return Promise.resolve({
      insert: async (request: Insert) => {
        this.inserts.push(request);
      },
      query: () => Promise.reject(new Error("the item store never reads")),
    });
  }
}

/** The rows of the one insert a store call made. */
const rowsOf = (insert: Insert | undefined) =>
  (insert?.values ?? []).map((value) => value as Record<string, unknown>);

function verdictRecord(evaluatorId: string): ClickHouseExperimentRunResultRecord {
  const [produced] = new RecordEvaluatorResultCommand().handle({
    tenantId: TENANT,
    aggregateId: AGGREGATE_ID,
    type: "lw.experiment_run.record_evaluator_result",
    data: {
      tenantId: TENANT,
      occurredAt: 1_000,
      runId: "run_1",
      experimentId: "experiment_1",
      index: 0,
      targetId: "target_a",
      evaluatorId,
      status: "processed",
      passed: true,
    },
  }) as Event[];
  const projection = ExperimentRunResultStorageMapProjection.create({
    store: ExperimentRunItemStore.create({ clickhouse: null, defaultRetentionDays: () => 0 }),
  });

  return projection.mapExperimentRunEvaluatorResult(evaluatorResultEventSchema.parse(produced));
}

describe("ExperimentRunItemStore", () => {
  describe("given several results of one run queued for storage", () => {
    /** @scenario "Queued results of one row are stored with one insert" */
    it("stores them with one insert, each stamped with the retention", async () => {
      const clickhouse = new RecordingClickHouse();
      const store = ExperimentRunItemStore.create({ clickhouse, defaultRetentionDays: () => 49 });
      const records = ["check_a", "check_b", "check_c"].map(verdictRecord);

      await store.bulkAppend(records, context);

      expect(clickhouse.inserts).toHaveLength(1);
      expect(clickhouse.inserts[0]?.table).toBe("experiment_run_items");
      expect(rowsOf(clickhouse.inserts[0]).map((value) => value.EvaluatorId)).toEqual([
        "check_a",
        "check_b",
        "check_c",
      ]);
      expect(rowsOf(clickhouse.inserts[0]).map((value) => value._retention_days)).toEqual([
        49, 49, 49,
      ]);
    });

    it("takes the tenant's own experiment retention over the default", async () => {
      const clickhouse = new RecordingClickHouse();
      const store = ExperimentRunItemStore.create({ clickhouse, defaultRetentionDays: () => 49 });

      await store.bulkAppend([verdictRecord("check_a")], {
        ...context,
        retentionPolicy: { experiments: 7 },
      });

      expect(rowsOf(clickhouse.inserts[0])[0]?._retention_days).toBe(7);
    });
  });

  describe("given an empty batch", () => {
    it("writes nothing", async () => {
      const clickhouse = new RecordingClickHouse();
      const store = ExperimentRunItemStore.create({ clickhouse, defaultRetentionDays: () => 49 });

      await store.bulkAppend([], context);

      expect(clickhouse.inserts).toHaveLength(0);
    });
  });

  describe("given a deployment without ClickHouse", () => {
    it("skips the write instead of failing the job", async () => {
      const store = ExperimentRunItemStore.create({
        clickhouse: null,
        defaultRetentionDays: () => 49,
      });

      await expect(store.bulkAppend([verdictRecord("check_a")], context)).resolves.toBeUndefined();
    });
  });
});
