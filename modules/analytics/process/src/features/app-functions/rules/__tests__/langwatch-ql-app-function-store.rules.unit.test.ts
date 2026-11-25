import { describe, expect, it } from "vitest";

import {
  type AppFunctionStoreRowReader,
  canProvisionAppFunctions,
  readAppFunctionStoreProbe,
} from "../langwatch-ql-app-function-store.rules.ts";

/** A server answering `replicas` from system.replicas and `found` from system.zookeeper. */
function fakeServer({ replicas, found }: { replicas: string; found?: string }) {
  const asked: string[] = [];
  const queryRows: AppFunctionStoreRowReader = (sql) => {
    asked.push(sql);
    if (sql.includes("system.replicas")) return Promise.resolve([{ max_total_replicas: replicas }]);
    if (found === undefined) return Promise.reject(new Error("NO_ZOOKEEPER"));
    return Promise.resolve([{ found }]);
  };
  return { asked, queryRows };
}

describe("canProvisionAppFunctions", () => {
  it("provisions on a single node, where the local store is the only store", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 1, keeperStoreFound: false })).toBe(true);
  });

  it("provisions on a plain server with no replicated table", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 0, keeperStoreFound: false })).toBe(true);
  });

  it("refuses a replicated server whose functions would reach one replica", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 3, keeperStoreFound: false })).toBe(false);
  });

  it("provisions a replicated server that keeps its functions in Keeper", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 3, keeperStoreFound: true })).toBe(true);
  });
});

describe("readAppFunctionStoreProbe", () => {
  describe("given a server with no replicated table", () => {
    /** @scenario "The store probe never asks Keeper on a server with no replicated table" */
    it("answers from system.replicas alone and never reads system.zookeeper", async () => {
      const server = fakeServer({ replicas: "0" });

      const probe = await readAppFunctionStoreProbe({ queryRows: server.queryRows });

      expect(probe).toEqual({ maxTotalReplicas: 0, keeperStoreFound: false });
      expect(server.asked.some((sql) => sql.includes("system.zookeeper"))).toBe(false);
    });
  });

  describe("given a replicated server", () => {
    /** @scenario "The store probe reads the shared function store from Keeper" */
    it("looks for the store's node in system.zookeeper, never in server settings", async () => {
      const server = fakeServer({ replicas: "3", found: "1" });

      const probe = await readAppFunctionStoreProbe({ queryRows: server.queryRows });

      expect(probe).toEqual({ maxTotalReplicas: 3, keeperStoreFound: true });
      expect(server.asked).toEqual([
        expect.stringContaining("FROM system.replicas"),
        expect.stringMatching(
          /system\.zookeeper WHERE path = '\/clickhouse' AND name = 'user_defined'/,
        ),
      ]);
    });

    it("reports no store when Keeper has no such node", async () => {
      const server = fakeServer({ replicas: "3", found: "0" });

      const probe = await readAppFunctionStoreProbe({ queryRows: server.queryRows });

      expect(probe.keeperStoreFound).toBe(false);
    });

    it("throws when Keeper cannot be read, so silence is never taken for a store", async () => {
      const server = fakeServer({ replicas: "3" });

      await expect(readAppFunctionStoreProbe({ queryRows: server.queryRows })).rejects.toThrow(
        "NO_ZOOKEEPER",
      );
    });
  });
});
