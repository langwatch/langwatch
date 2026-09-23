/**
 * AC9: the sql-mode cluster guard refuses a multi-host cluster with no
 * replicated access storage, and passes for a single node, a replicated store,
 * or the single-node bypass. Driven with a fake query over `system.*`.
 *
 * @see ../sqlModeClusterGuard.ts
 */

import { describe, expect, it } from "vitest";

import {
  assertLwqlSqlModeClusterSafe,
  type ClusterGuardQuery,
  LwqlSqlModeUnsafeOnClusterError,
} from "../sqlModeClusterGuard";

/**
 * A fake `system.*` query serving the aggregated rows the guard's SQL now
 * returns: `{ host_count }` from the cluster count, `{ max_total_replicas }`
 * from the replica probe, and the user-directory rows. Values mirror the real
 * `JSONEachRow` wire shape, which the fixtures below vary between string and
 * number to lock in the coercion.
 */
function fakeQuery({
  userDirectories = [],
  clusterHostCount = [{ host_count: "0" }],
  replicaHostCount = [{ max_total_replicas: "0" }],
}: {
  userDirectories?: Record<string, unknown>[];
  clusterHostCount?: Record<string, unknown>[];
  replicaHostCount?: Record<string, unknown>[];
}): ClusterGuardQuery {
  return async (sql: string) => {
    if (sql.includes("system.user_directories")) return userDirectories;
    if (sql.includes("system.replicas")) return replicaHostCount;
    if (sql.includes("system.clusters")) return clusterHostCount;
    throw new Error(`unexpected query: ${sql}`);
  };
}

const SINGLE_NODE: Record<string, unknown>[] = [{ host_count: "1" }];

const THREE_HOSTS: Record<string, unknown>[] = [{ host_count: "3" }];

describe("assertLwqlSqlModeClusterSafe", () => {
  describe("when the server is a single node", () => {
    /** @scenario "A single-node target passes the sql-mode cluster guard" */
    it("passes", async () => {
      await expect(
        assertLwqlSqlModeClusterSafe({
          query: fakeQuery({ clusterHostCount: SINGLE_NODE }),
          env: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the cluster is multi-host without replicated access storage", () => {
    /** @scenario "A multi-host cluster without replicated access storage aborts sql-mode provisioning" */
    it("aborts with the named error carrying the counts", async () => {
      const promise = assertLwqlSqlModeClusterSafe({
        query: fakeQuery({ clusterHostCount: THREE_HOSTS }),
        env: {},
      });

      await expect(promise).rejects.toBeInstanceOf(
        LwqlSqlModeUnsafeOnClusterError,
      );
      await promise.catch((error: LwqlSqlModeUnsafeOnClusterError) => {
        expect(error.hostCount).toBe(3);
        expect(error.replicatedDirectoryCount).toBe(0);
      });
    });
  });

  describe("when the cluster is multi-host with replicated access storage", () => {
    /** @scenario "A multi-host cluster with replicated access storage passes the sql-mode cluster guard" */
    it("passes — the model reaches every host through Keeper", async () => {
      await expect(
        assertLwqlSqlModeClusterSafe({
          query: fakeQuery({
            userDirectories: [{ name: "replicated", type: "replicated" }],
            clusterHostCount: THREE_HOSTS,
          }),
          env: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the single-node bypass is set", () => {
    /** @scenario "The sql-mode cluster guard is bypassed by the single-node override" */
    it("passes regardless of the cluster topology", async () => {
      await expect(
        assertLwqlSqlModeClusterSafe({
          query: fakeQuery({ clusterHostCount: THREE_HOSTS }),
          env: { LWQL_ACCESS_MODEL_SQL_SINGLE_NODE: "true" },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when this server belongs to no configured cluster", () => {
    it("passes — a lone server counts zero hosts", async () => {
      await expect(
        assertLwqlSqlModeClusterSafe({
          query: fakeQuery({ clusterHostCount: [{ host_count: "0" }] }),
          env: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the cluster row count arrives as a JSON number (the AC9 wire bug)", () => {
    // Regression for issue #8258: under `JSONEachRow` a UInt8 arrives as the
    // number 3, not the string "3". The old guard filtered `is_local === "1"`
    // in TS, so a numeric-typed row matched nothing and a real 3-host cluster
    // slipped through as zero hosts. Counting in SQL and parsing with Number()
    // must now abort whether the value is a string or a number.
    it("aborts — Number() coerces the numeric host_count the string compare dropped", async () => {
      const promise = assertLwqlSqlModeClusterSafe({
        query: fakeQuery({ clusterHostCount: [{ host_count: 3 }] }),
        env: {},
      });

      await expect(promise).rejects.toBeInstanceOf(
        LwqlSqlModeUnsafeOnClusterError,
      );
      await promise.catch((error: LwqlSqlModeUnsafeOnClusterError) => {
        expect(error.hostCount).toBe(3);
      });
    });
  });

  describe("when a replicated table spans hosts that no cluster row claims", () => {
    // Second, independent signal: even if `is_local` matches no cluster row,
    // a replicated table with N replicas proves N hosts.
    it("aborts on the replica count alone", async () => {
      const promise = assertLwqlSqlModeClusterSafe({
        query: fakeQuery({
          clusterHostCount: [{ host_count: "0" }],
          replicaHostCount: [{ max_total_replicas: "2" }],
        }),
        env: {},
      });

      await expect(promise).rejects.toBeInstanceOf(
        LwqlSqlModeUnsafeOnClusterError,
      );
      await promise.catch((error: LwqlSqlModeUnsafeOnClusterError) => {
        expect(error.hostCount).toBe(2);
      });
    });
  });
});
