/**
 * AC9: the sql-mode cluster guard refuses a multi-host cluster with no
 * replicated access storage, and passes for a single node, a replicated store,
 * or the single-node bypass. Driven with a fake query over `system.*`.
 *
 * @see ../sqlModeClusterGuard.ts
 * @scenario "A single-node target passes the sql-mode cluster guard"
 * @scenario "A multi-host cluster without replicated access storage aborts sql-mode provisioning"
 * @scenario "A multi-host cluster with replicated access storage passes the sql-mode cluster guard"
 * @scenario "The sql-mode cluster guard is bypassed by the single-node override"
 */

import { describe, expect, it } from "vitest";

import {
  assertLwqlSqlModeClusterSafe,
  type ClusterGuardQuery,
  LwqlSqlModeUnsafeOnClusterError,
} from "../sqlModeClusterGuard";

/** A fake `system.*` query serving fixed user-directory and cluster rows. */
function fakeQuery({
  userDirectories = [],
  clusters = [],
}: {
  userDirectories?: Record<string, string>[];
  clusters?: Record<string, string>[];
}): ClusterGuardQuery {
  return async (sql: string) => {
    if (sql.includes("system.user_directories")) return userDirectories;
    if (sql.includes("system.clusters")) return clusters;
    throw new Error(`unexpected query: ${sql}`);
  };
}

const SINGLE_NODE_CLUSTER: Record<string, string>[] = [
  { cluster: "default", host_name: "ch-0", is_local: "1" },
];

const THREE_HOST_CLUSTER: Record<string, string>[] = [
  { cluster: "main", host_name: "ch-0", is_local: "1" },
  { cluster: "main", host_name: "ch-1", is_local: "0" },
  { cluster: "main", host_name: "ch-2", is_local: "0" },
];

describe("assertLwqlSqlModeClusterSafe", () => {
  describe("when the server is a single node", () => {
    it("passes", async () => {
      await expect(
        assertLwqlSqlModeClusterSafe({
          query: fakeQuery({ clusters: SINGLE_NODE_CLUSTER }),
          env: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the cluster is multi-host without replicated access storage", () => {
    it("aborts with the named error carrying the counts", async () => {
      const promise = assertLwqlSqlModeClusterSafe({
        query: fakeQuery({ clusters: THREE_HOST_CLUSTER }),
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
    it("passes — the model reaches every host through Keeper", async () => {
      await expect(
        assertLwqlSqlModeClusterSafe({
          query: fakeQuery({
            userDirectories: [{ name: "replicated", type: "replicated" }],
            clusters: THREE_HOST_CLUSTER,
          }),
          env: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the single-node bypass is set", () => {
    it("passes regardless of the cluster topology", async () => {
      await expect(
        assertLwqlSqlModeClusterSafe({
          query: fakeQuery({ clusters: THREE_HOST_CLUSTER }),
          env: { LWQL_ACCESS_MODEL_SQL_SINGLE_NODE: "true" },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when this server belongs to no configured cluster", () => {
    it("passes — a lone server has one host", async () => {
      await expect(
        assertLwqlSqlModeClusterSafe({
          query: fakeQuery({
            clusters: [
              { cluster: "other", host_name: "ch-a", is_local: "0" },
              { cluster: "other", host_name: "ch-b", is_local: "0" },
            ],
          }),
          env: {},
        }),
      ).resolves.toBeUndefined();
    });
  });
});
