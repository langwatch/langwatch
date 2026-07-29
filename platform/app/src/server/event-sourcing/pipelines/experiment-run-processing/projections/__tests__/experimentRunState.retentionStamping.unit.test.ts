/**
 * @see specs/data-retention/ingestion-stamping.feature
 *
 * The experiment pipeline writes two retention-managed ClickHouse tables from
 * the same delivery: `experiment_run_items` (map projection) and
 * `experiment_runs` (fold projection). Both belong to the `experiments`
 * retention category, so both must carry the tenant's resolved day count.
 *
 * The item store pulled it off the store context; the run-state store dropped
 * it. `ExperimentRunStateRepositoryClickHouse` reads the policy from
 * `context.metadata.retentionPolicy`, and the store called `storeProjection`
 * with `{ tenantId }` alone — so the repository's `?? PLATFORM_DEFAULT`
 * fallback fired on EVERY write and the row was stamped 49 days no matter what
 * the tenant had configured. A tenant on a longer experiments retention lost
 * its run headers early (the items outlived the run they belong to); a tenant
 * on a shorter one kept them past the window it asked for.
 *
 * The bug was a wrong stamped VALUE, so each case drives the real store through
 * the real ClickHouse repository against a capturing client and reads
 * `_retention_days` off the record that was actually inserted — not the
 * generated SQL, and not a spy on an intermediate call.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { createTenantId } from "../../../../domain/tenantId";
import type { ProjectionStoreContext } from "../../../../projections/projectionStoreContext";
import { ExperimentRunStateRepositoryClickHouse } from "../../repositories/experimentRunState.clickhouse.repository";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../../schemas/constants";
import type { ClickHouseExperimentRunResultRecord } from "../experimentRunResultStorage.mapProjection";
import { createExperimentRunItemAppendStore } from "../experimentRunResultStorage.store";
import type { ExperimentRunStateData } from "../experimentRunState.foldProjection";
import { createExperimentRunStateFoldStore } from "../experimentRunState.store";

const TENANT_ID = createTenantId("project_experiments");
const AGGREGATE_ID = "exp-1:run-123";

/** The tenant's configured experiments window — deliberately not the default. */
const TENANT_EXPERIMENTS_DAYS = 91;

interface CapturedInsert {
  table: string;
  values: Array<Record<string, unknown>>;
}

function capturingClickHouse() {
  const inserts: CapturedInsert[] = [];
  const resolveClient: ClickHouseClientResolver = async () =>
    ({
      insert: async (args: {
        table: string;
        values: Array<Record<string, unknown>>;
      }) => {
        inserts.push({ table: args.table, values: args.values });
      },
    }) as unknown as ClickHouseClient;
  return { inserts, resolveClient };
}

function contextWith(
  retentionPolicy: ProjectionStoreContext["retentionPolicy"],
): ProjectionStoreContext {
  return { aggregateId: AGGREGATE_ID, tenantId: TENANT_ID, retentionPolicy };
}

const tenantPolicy = {
  traces: 49,
  scenarios: 63,
  experiments: TENANT_EXPERIMENTS_DAYS,
};

function runState(): ExperimentRunStateData {
  return {
    RunId: "run-123",
    ExperimentId: "exp-1",
    WorkflowVersionId: null,
    Total: 1,
    Progress: 1,
    CompletedCount: 1,
    FailedCount: 0,
    TotalDurationMs: 10,
    AvgScoreBps: null,
    PassRateBps: null,
    Targets: "[]",
    CreatedAt: 1_700_000_000_000,
    UpdatedAt: 1_700_000_000_500,
    LastEventOccurredAt: 1_700_000_000_500,
    StartedAt: 1_700_000_000_000,
    FinishedAt: 1_700_000_000_500,
    StoppedAt: null,
    TotalScoreSum: 0,
    ScoreCount: 0,
    PassedCount: 0,
    GradedCount: 0,
  };
}

function itemRecord(): ClickHouseExperimentRunResultRecord {
  return {
    ProjectionId: "item-1",
    TenantId: String(TENANT_ID),
    RunId: "run-123",
    ExperimentId: "exp-1",
    RowIndex: 0,
    TargetId: "target-1",
    ResultType: "target",
    DatasetEntry: "{}",
    Predicted: null,
    TargetCost: null,
    TargetDurationMs: null,
    TargetError: null,
    TargetDomainError: null,
    TraceId: null,
    EvaluatorId: null,
    EvaluatorName: null,
    EvaluationStatus: "",
    Score: null,
    Label: null,
    Passed: null,
    EvaluationDetails: null,
    EvaluationCost: null,
    EvaluationInputs: null,
    EvaluationDurationMs: null,
    OccurredAt: new Date(1_700_000_000_500),
  };
}

async function stampedRunRetention(
  context: ProjectionStoreContext,
): Promise<unknown> {
  const { inserts, resolveClient } = capturingClickHouse();
  const store = createExperimentRunStateFoldStore(
    new ExperimentRunStateRepositoryClickHouse(resolveClient),
  );

  await store.store(runState(), context);

  const insert = inserts.find((i) => i.table === "experiment_runs");
  expect(insert, "no experiment_runs insert was issued").toBeDefined();
  return insert!.values[0]!._retention_days;
}

async function stampedItemRetention(
  context: ProjectionStoreContext,
): Promise<unknown> {
  const { inserts, resolveClient } = capturingClickHouse();
  const store = createExperimentRunItemAppendStore(resolveClient);

  await store.append(itemRecord(), context);

  const insert = inserts.find((i) => i.table === "experiment_run_items");
  expect(insert, "no experiment_run_items insert was issued").toBeDefined();
  return insert!.values[0]!._retention_days;
}

describe("experiment pipeline retention stamping", () => {
  describe("given the tenant has an experiments retention policy", () => {
    describe("when a run's state is stored", () => {
      /** @scenario Experiment pipeline stamps _retention_days from experiments category */
      it("stamps the tenant's experiments day count on both experiment tables", async () => {
        const context = contextWith(tenantPolicy);

        await expect(stampedRunRetention(context)).resolves.toBe(
          TENANT_EXPERIMENTS_DAYS,
        );
        await expect(stampedItemRetention(context)).resolves.toBe(
          TENANT_EXPERIMENTS_DAYS,
        );
      });

      it("does not stamp the traces category by mistake", async () => {
        const stamped = await stampedRunRetention(contextWith(tenantPolicy));

        expect(stamped).not.toBe(tenantPolicy.traces);
      });
    });
  });

  describe("given no retention policy reached the write", () => {
    describe("when a run's state is stored", () => {
      it("falls back to the platform default rather than leaving the column default", async () => {
        await expect(stampedRunRetention(contextWith(null))).resolves.toBe(
          PLATFORM_DEFAULT_RETENTION_DAYS,
        );
      });
    });
  });

  describe("given the run-state store writes through its batch path", () => {
    describe("when a batch carries the tenant's policy", () => {
      it("stamps the same day count the single write does", async () => {
        const { inserts, resolveClient } = capturingClickHouse();
        const store = createExperimentRunStateFoldStore(
          new ExperimentRunStateRepositoryClickHouse(resolveClient),
        );
        const context = contextWith(tenantPolicy);

        // No `storeBatch` on this store: the executor's batch path falls back
        // to per-entry `store`, so the guarantee has to hold there too.
        expect(store.storeBatch).toBeUndefined();
        await store.store(runState(), context);
        await store.store(runState(), context);

        const stamped = inserts
          .filter((i) => i.table === "experiment_runs")
          .map((i) => i.values[0]!._retention_days);
        expect(stamped).toEqual([
          TENANT_EXPERIMENTS_DAYS,
          TENANT_EXPERIMENTS_DAYS,
        ]);
      });
    });
  });

  describe("given the projection version the store publishes", () => {
    it("matches the stamp the repository writes into the row", async () => {
      const { inserts, resolveClient } = capturingClickHouse();
      const store = createExperimentRunStateFoldStore(
        new ExperimentRunStateRepositoryClickHouse(resolveClient),
      );

      await store.store(runState(), contextWith(tenantPolicy));

      expect(inserts[0]!.values[0]!.Version).toBe(
        EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
      );
    });
  });
});
