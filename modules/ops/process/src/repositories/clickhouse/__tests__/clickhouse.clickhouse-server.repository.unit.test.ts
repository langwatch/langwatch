/** @see modules/staff-access/specs/staff-access-functions-telemetry.feature */
import type { QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseClickHouseServerRepository } from "../clickhouse.clickhouse-server.repository.ts";

const WINDOW = {
  sinceMs: Date.parse("2026-11-20T00:00:00Z"),
  untilMs: Date.parse("2026-11-21T00:00:00Z"),
};

/** The routed member, recording each statement; a cluster-wide one throws `refusal` when given. */
function repoRefusingCluster(refusal?: { code: string; message: string }) {
  const statements: QueryRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    query: async (request: QueryRequest) => {
      statements.push(request);
      if (refusal && request.sql.includes("clusterAllReplicas")) {
        throw Object.assign(new Error(refusal.message), { code: refusal.code });
      }
      if (request.sql.includes("system.tables")) return { rows: [{ present: "1" }] };
      return { rows: [] };
    },
  });
  return { repo: ClickHouseClickHouseServerRepository.create({ clickhouse }), statements };
}

describe("given the ClickHouse server reads", () => {
  describe("when a plain cluster is named", () => {
    /** @scenario "A named cluster reads the query log and health of every replica" */
    it("reads every statement across the cluster, skipping unavailable shards", async () => {
      const { repo, statements } = repoRefusingCluster();

      await repo.findQueryErrors({ ...WINDOW, cluster: "default" });
      await repo.findHealth({ cluster: "default" });

      expect(statements).toHaveLength(8);
      expect(
        statements.map(({ sql }) => /clusterAllReplicas\('default', system\.\w+\)/.test(sql)),
      ).toEqual(statements.map(() => true));
      expect(statements.map(({ settings }) => settings)).toEqual(
        statements.map(() => ({ skip_unavailable_shards: 1 })),
      );
    });
  });

  describe("when ClickHouse does not know the named cluster", () => {
    it("reads the local node's tables with no cluster settings", async () => {
      const { repo, statements } = repoRefusingCluster({
        code: "170",
        message: "Requested cluster 'default' not found",
      });

      await expect(repo.findHealth({ cluster: "default" })).resolves.toMatchObject({ nodes: 0 });
      const local = statements.filter(({ sql }) => !sql.includes("clusterAllReplicas"));

      expect(local).toHaveLength(6);
      expect(local.map(({ settings }) => settings)).toEqual(local.map(() => ({})));
    });
  });

  describe("when a cluster-wide read is refused for another reason", () => {
    /** @scenario "Any other cluster-wide failure of the server reads is reported, not hidden" */
    it("throws the refusal and never reads the local node", async () => {
      const { repo, statements } = repoRefusingCluster({
        code: "497",
        message: "refused with 497",
      });

      await expect(repo.findQueryErrors({ ...WINDOW, cluster: "default" })).rejects.toThrow("497");
      await expect(repo.findHealth({ cluster: "default" })).rejects.toThrow("497");

      expect(statements.every(({ sql }) => sql.includes("clusterAllReplicas"))).toBe(true);
    });
  });

  describe("when the cluster name is not a plain identifier", () => {
    it("reads the local node", async () => {
      const { repo, statements } = repoRefusingCluster();

      await repo.findHealth({ cluster: "x'); DROP TABLE t; --" });

      expect(statements.some(({ sql }) => sql.includes("clusterAllReplicas"))).toBe(false);
    });
  });
});
