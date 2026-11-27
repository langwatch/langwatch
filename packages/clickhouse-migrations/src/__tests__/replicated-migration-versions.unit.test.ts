/**
 * The settings and SQL that keep goose's version reads consistent through a load balancer.
 *
 * @see ../goose.migration-runner.ts
 * @see ../../../../specs/clickhouse/replicated-migration-versions.feature
 */
import { describe, expect, it } from "vitest";

import {
  gooseConnectionStringFor,
  gooseVersionSyncStatement,
  gooseVersionWriteSettings,
  MigrationError,
  parseConnectionUrl,
  retryWhileReplicasMissing,
} from "../goose.migration-runner";

const URL_WITH_DATABASE = "http://user:secret@clickhouse-lb:8123/langwatch";

const REFUSAL = new Error(
  "[HTTP 500] response body: Code: 285. DB::Exception: Number of alive replicas (2) is less than requested quorum (3/3). (TOO_FEW_LIVE_REPLICAS)",
);

/** A clock that moves only when the retry sleeps, and a run refused a set number of times. */
const refusedRun = ({ refusals, error = REFUSAL }: { refusals: number; error?: Error }) => {
  let time = 0;
  let runs = 0;
  const logs: string[] = [];
  const sleeps: number[] = [];
  return {
    deps: {
      run: async () => {
        runs++;
        if (runs <= refusals) throw error;
        return "applied";
      },
      now: () => time,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        time += ms;
      },
      log: (message: string) => logs.push(message),
    },
    logs,
    sleeps,
    runs: () => runs,
  };
};

describe("goose on a replicated ClickHouse", () => {
  describe("when CLICKHOUSE_CLUSTER is set", () => {
    const config = {
      ...parseConnectionUrl({ connectionUrl: URL_WITH_DATABASE, clusterName: "langwatch" }),
      clusterReplicas: 3,
    };

    /** @scenario "On a cluster every goose write waits for every replica" */
    it("asks every goose insert and the version 0 row to reach all replicas", () => {
      const goose = new URL(gooseConnectionStringFor({ config }));
      expect(goose.searchParams.get("insert_quorum")).toBe("3");
      expect(goose.searchParams.get("database")).toBe("langwatch");
      expect(gooseVersionWriteSettings({ config })).toEqual({ insert_quorum: "3" });
    });

    /** @scenario "On a cluster every replica catches up before goose reads its versions" */
    it("syncs goose's version table on every replica of the cluster", () => {
      expect(gooseVersionSyncStatement({ config })).toBe(
        "SYSTEM SYNC REPLICA ON CLUSTER langwatch langwatch.goose_db_version LIGHTWEIGHT",
      );
    });
  });

  describe("when ClickHouse refuses a write for a replica that is still starting", () => {
    /** @scenario "A write refused for a replica that is still starting is retried" */
    it("logs the replica counts, backs off and runs again until the write is accepted", async () => {
      const run = refusedRun({ refusals: 2 });

      expect(await retryWhileReplicasMissing({ ...run.deps, waitSeconds: 180 })).toBe("applied");

      expect(run.runs()).toBe(3);
      expect(run.sleeps).toEqual([2_000, 4_000]);
      expect(run.logs).toEqual([
        "ClickHouse refused a write that waits for every replica (2 of 3 replicas are alive, 1 missing); retrying in 2s (0s of 180s)",
        "ClickHouse refused a write that waits for every replica (2 of 3 replicas are alive, 1 missing); retrying in 4s (2s of 180s)",
      ]);
    });
  });

  describe("when the refusals outlast CLICKHOUSE_MIGRATE_WAIT_SECONDS", () => {
    /** @scenario "A replica that never comes back fails the run with the count it is missing" */
    it("fails in the migrate phase naming the alive and missing replicas", async () => {
      const run = refusedRun({ refusals: Number.POSITIVE_INFINITY });

      const failure = await retryWhileReplicasMissing({ ...run.deps, waitSeconds: 20 }).catch(
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(MigrationError);
      expect((failure as MigrationError).phase).toBe("migrate");
      expect((failure as MigrationError).message).toBe(
        "ClickHouse refused a write that waits for every replica after waiting 20s (CLICKHOUSE_MIGRATE_WAIT_SECONDS): 2 of 3 replicas are alive, 1 missing",
      );
      expect(run.sleeps).toEqual([2_000, 4_000, 8_000, 6_000]);
    });

    it("throws any other failure at once, without a retry", async () => {
      const other = new Error("Code: 60. DB::Exception: Unknown table expression identifier");
      const run = refusedRun({ refusals: 1, error: other });

      await expect(retryWhileReplicasMissing({ ...run.deps, waitSeconds: 180 })).rejects.toBe(
        other,
      );
      expect(run.runs()).toBe(1);
      expect(run.logs).toEqual([]);
    });
  });

  describe("when CLICKHOUSE_CLUSTER is not set", () => {
    const config = parseConnectionUrl({ connectionUrl: URL_WITH_DATABASE });

    /** @scenario "A single ClickHouse runs goose exactly as before" */
    it("connects goose unchanged, syncs nothing and waits for no quorum", () => {
      expect(gooseConnectionStringFor({ config })).toBe(config.gooseConnectionString);
      expect(gooseConnectionStringFor({ config })).toBe(
        "http://user:secret@clickhouse-lb:8123/?database=langwatch",
      );
      expect(gooseVersionSyncStatement({ config })).toBeNull();
      expect(gooseVersionWriteSettings({ config })).toEqual({});
    });
  });
});
