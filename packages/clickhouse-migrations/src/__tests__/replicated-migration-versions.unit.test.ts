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
  waitForClusterReplicas,
} from "../goose.migration-runner";

const URL_WITH_DATABASE = "http://user:secret@clickhouse-lb:8123/langwatch";

/** A clock that moves only when the wait sleeps, and a replica count that follows a script. */
const fakeCluster = (answers: readonly number[]) => {
  let time = 0;
  let checks = 0;
  const logs: string[] = [];
  return {
    deps: {
      countAnswering: async () => answers[Math.min(checks++, answers.length - 1)] ?? 0,
      clusterName: "langwatch",
      replicas: 3,
      now: () => time,
      sleep: async (ms: number) => {
        time += ms;
      },
      log: (message: string) => logs.push(message),
    },
    logs,
    checks: () => checks,
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

  describe("when one of the three replicas is still starting", () => {
    /** @scenario "On a cluster goose starts only once every replica answers" */
    it("checks again until all three answer and logs each wait", async () => {
      const cluster = fakeCluster([2, 2, 3]);

      await waitForClusterReplicas({ ...cluster.deps, waitSeconds: 180 });

      expect(cluster.checks()).toBe(3);
      expect(cluster.logs).toEqual([
        'Waiting for ClickHouse cluster "langwatch": 2 of 3 replicas answer (0s of 180s)',
        'Waiting for ClickHouse cluster "langwatch": 2 of 3 replicas answer (2s of 180s)',
      ]);
    });

    it("does not wait when every replica already answers", async () => {
      const cluster = fakeCluster([3]);

      await waitForClusterReplicas({ ...cluster.deps, waitSeconds: 180 });

      expect(cluster.checks()).toBe(1);
      expect(cluster.logs).toEqual([]);
    });
  });

  describe("when a replica never answers", () => {
    /** @scenario "A replica that never answers fails the run with the count it is missing" */
    it("fails in the bootstrap phase naming the cluster and the missing count", async () => {
      const cluster = fakeCluster([2]);

      const failure = await waitForClusterReplicas({ ...cluster.deps, waitSeconds: 10 }).catch(
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(MigrationError);
      expect((failure as MigrationError).phase).toBe("bootstrap");
      expect((failure as MigrationError).message).toBe(
        'ClickHouse cluster "langwatch" has 2 of 3 replicas answering after waiting 10s (CLICKHOUSE_MIGRATE_WAIT_SECONDS): 1 missing, and every goose write waits for all of them',
      );
      expect(cluster.checks()).toBe(6);
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
