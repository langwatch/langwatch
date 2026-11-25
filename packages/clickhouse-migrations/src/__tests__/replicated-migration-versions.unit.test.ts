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
  parseConnectionUrl,
} from "../goose.migration-runner";

const URL_WITH_DATABASE = "http://user:secret@clickhouse-lb:8123/langwatch";

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
