/**
 * The probe the deploy task and the ops checkup both read, over a driver that answers as
 * ClickHouse 25.10 does: system.server_settings never lists user_defined_zookeeper_path,
 * a server with no Keeper has no system.zookeeper table, and the first replica is the one reached.
 */
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import { canProvisionAppFunctions } from "../../../features/app-functions/rules/langwatch-ql-app-function-store.rules.ts";
import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "../../../services/langwatch-ql-access-model.service.ts";
import { ClickHouseLangWatchQLAppFunctionStoreRepository } from "../clickhouse.langwatch-ql-app-function-store.repository.ts";

const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "langwatch_profile",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

/** UNKNOWN_TABLE, as a server with no Keeper answers any system.zookeeper read. */
function unknownTable(sql: string): Error {
  return Object.assign(new Error(`Unknown table expression identifier in scope ${sql}`), {
    code: "60",
  });
}

type Replica = { host: string; functions: string[] };

function clickHouse2510({
  maxTotalReplicas,
  keeper,
  replicas = [],
  storeEntries = [],
  clusters = [
    { name: "langwatch", hosts: String(maxTotalReplicas), widest_shard: String(maxTotalReplicas) },
  ],
  crossReplicaError,
}: {
  maxTotalReplicas: number;
  keeper: "absent" | "with-function-store" | "without-function-store";
  replicas?: Replica[];
  storeEntries?: string[];
  clusters?: Record<string, string>[];
  /** What clusterAllReplicas fails with; unset, every replica answers. */
  crossReplicaError?: Error;
}): QueryDriver {
  const names = (list: string[]) => list.map((name) => ({ name }));
  const functionsOf = ({ host, functions }: Replica) => ({
    host,
    functions: Object.fromEntries(functions.map((name) => [name, `CREATE FUNCTION ${name}`])),
  });
  return {
    execute<Row>({ sql }: { sql: string }) {
      const answer = (rows: Record<string, unknown>[]) => Promise.resolve({ rows: rows as Row[] });
      if (sql.includes("system.replicas")) {
        return answer([{ max_total_replicas: String(maxTotalReplicas) }]);
      }
      if (sql.includes("system.server_settings")) return answer([]);
      if (sql.includes("system.clusters")) return answer(clusters);
      if (sql.includes("clusterAllReplicas('langwatch', system.functions)")) {
        if (crossReplicaError !== undefined) return Promise.reject(crossReplicaError);
        return answer(replicas.map(functionsOf));
      }
      if (sql.includes("FROM system.functions")) {
        return answer(replicas.slice(0, 1).map(functionsOf));
      }
      if (sql.includes("system.zookeeper")) {
        if (keeper === "absent") return Promise.reject(unknownTable(sql));
        const hasStore = keeper === "with-function-store";
        if (sql.includes("path = '/clickhouse/user_defined'")) {
          return answer(hasStore ? names(storeEntries) : []);
        }
        const found =
          hasStore && sql.includes("path = '/clickhouse'") && sql.includes("name = 'user_defined'");
        return answer([{ stores: found ? "1" : "0" }]);
      }
      return Promise.reject(new Error(`unexpected statement: ${sql}`));
    },
    insert: () => Promise.reject(new Error("the probe never writes")),
    command: () => Promise.reject(new Error("the probe never writes")),
  };
}

const THREE_EMPTY_REPLICAS: Replica[] = ["ch-0", "ch-1", "ch-2"].map((host) => ({
  host,
  functions: [],
}));

/** AUTHENTICATION_FAILED, as a replica answers a cross-replica hop sent as user default. */
const REFUSED_HOP = Object.assign(
  new Error("Received from ch-2:9000. default: Authentication failed: password is incorrect"),
  { code: "516" },
);

function storeOver(driver: QueryDriver): ClickHouseLangWatchQLAppFunctionStoreRepository {
  return ClickHouseLangWatchQLAppFunctionStoreRepository.create(
    new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver }),
  );
}

function provisionableOver(driver: QueryDriver): Promise<boolean[]> {
  return storeOver(driver)
    .findProbe()
    .then((probes) => probes.map(canProvisionAppFunctions));
}

describe("ClickHouseLangWatchQLAppFunctionStoreRepository", () => {
  describe("given a replicated ClickHouse 25.10 whose function store is in Keeper", () => {
    /** @scenario "A replicated server whose function store is in Keeper is provisioned with the functions" */
    it("is provisionable, so every app function, a missing one included, is created", async () => {
      const [provisionable] = await provisionableOver(
        clickHouse2510({
          maxTotalReplicas: 3,
          keeper: "with-function-store",
          replicas: THREE_EMPTY_REPLICAS,
        }),
      );

      expect(provisionable).toBe(true);
      const statements = LangWatchQLAccessModelService.create().setupStatements({
        names: NAMES,
        sourceDatabase: NAMES.database,
        includeAppFunctions: provisionable,
      });
      expect(statements).toContainEqual(
        expect.stringMatching(/^CREATE OR REPLACE FUNCTION llm_readable_thread /),
      );
    });
  });

  describe("given a replicated server where one replica keeps a function the Keeper store lacks", () => {
    it("is not provisionable, since that replica keeps its functions on local disk", async () => {
      await expect(
        provisionableOver(
          clickHouse2510({
            maxTotalReplicas: 3,
            keeper: "with-function-store",
            replicas: [
              { host: "ch-0", functions: ["x"] },
              { host: "ch-1", functions: ["x"] },
              { host: "ch-2", functions: ["x", "local_only"] },
            ],
            storeEntries: ["function_x.sql"],
          }),
        ),
      ).resolves.toEqual([false]);
    });
  });

  describe("given a replicated server whose replicas refuse the cross-replica read", () => {
    /** @scenario "A replicated server whose replicas refuse the cross-replica read still gets the functions" */
    it("compares this server with the Keeper store, as before, and allows the functions", async () => {
      await expect(
        provisionableOver(
          clickHouse2510({
            maxTotalReplicas: 3,
            keeper: "with-function-store",
            replicas: THREE_EMPTY_REPLICAS,
            crossReplicaError: REFUSED_HOP,
          }),
        ),
      ).resolves.toEqual([true]);
    });

    /** @scenario "A replicated server whose replicas refuse the cross-replica read still refuses a local store on this server" */
    it("refuses the functions where this server holds one the Keeper store lacks", async () => {
      await expect(
        provisionableOver(
          clickHouse2510({
            maxTotalReplicas: 3,
            keeper: "with-function-store",
            replicas: [{ host: "ch-0", functions: ["local_only"] }],
            crossReplicaError: REFUSED_HOP,
          }),
        ),
      ).resolves.toEqual([false]);
    });

    it("checks a create against this server and Keeper only", async () => {
      await expect(
        storeOver(
          clickHouse2510({
            maxTotalReplicas: 3,
            keeper: "with-function-store",
            replicas: [{ host: "ch-0", functions: ["x"] }],
            storeEntries: ["function_x.sql"],
            crossReplicaError: REFUSED_HOP,
          }),
        ).findSplitAppFunctions({ names: ["x", "y"] }),
      ).resolves.toEqual([
        { name: "y", missingOn: ["ch-0"], inKeeper: false, oneDefinition: true },
      ]);
    });
  });

  describe("given a replicated server where one replica cannot be reached", () => {
    /** @scenario "A replicated server with an unreachable replica is checked on this server" */
    it("compares this server with the Keeper store rather than skipping the functions", async () => {
      await expect(
        provisionableOver(
          clickHouse2510({
            maxTotalReplicas: 3,
            keeper: "with-function-store",
            replicas: THREE_EMPTY_REPLICAS,
            crossReplicaError: new Error("All connection tries failed: ch-2:9000"),
          }),
        ),
      ).resolves.toEqual([true]);
    });
  });

  describe("given a replicated server where fewer hosts answer than the cluster has", () => {
    it("does not trust the replicas it could see, and compares this server instead", async () => {
      await expect(
        provisionableOver(
          clickHouse2510({
            maxTotalReplicas: 3,
            keeper: "with-function-store",
            replicas: THREE_EMPTY_REPLICAS.slice(0, 2),
          }),
        ),
      ).resolves.toEqual([true]);
    });
  });

  describe("given a replicated server with no cluster spanning its replicas", () => {
    it("compares this server with the Keeper store, since no query can reach every replica", async () => {
      await expect(
        provisionableOver(
          clickHouse2510({
            maxTotalReplicas: 3,
            keeper: "with-function-store",
            replicas: THREE_EMPTY_REPLICAS,
            clusters: [{ name: "default", hosts: "1", widest_shard: "1" }],
          }),
        ),
      ).resolves.toEqual([true]);
    });
  });

  describe("given a replicated ClickHouse with Keeper but no function store in it", () => {
    /** @scenario "A replicated server with Keeper but no function store in it is not provisionable" */
    it("is not provisionable, since a create would reach one replica only", async () => {
      await expect(
        provisionableOver(
          clickHouse2510({ maxTotalReplicas: 3, keeper: "without-function-store" }),
        ),
      ).resolves.toEqual([false]);
    });
  });

  describe("given a single node with no Keeper", () => {
    it("is provisionable without asking Keeper", async () => {
      await expect(
        provisionableOver(clickHouse2510({ maxTotalReplicas: 0, keeper: "absent" })),
      ).resolves.toEqual([true]);
    });
  });

  describe("given a replicated server that cannot answer the Keeper read", () => {
    it("answers nothing rather than mistaking it for a single node", async () => {
      await expect(
        provisionableOver(clickHouse2510({ maxTotalReplicas: 3, keeper: "absent" })),
      ).resolves.toEqual([]);
    });
  });
});
