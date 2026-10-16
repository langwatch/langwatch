/**
 * The probe the deploy task and the ops checkup both read, over a driver that answers as
 * ClickHouse 25.10 does: system.server_settings never lists user_defined_zookeeper_path,
 * a server with no Keeper has no system.zookeeper table, and every replica answers alone.
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
  unreachable = false,
}: {
  maxTotalReplicas: number;
  keeper: "absent" | "with-function-store" | "without-function-store";
  replicas?: Replica[];
  storeEntries?: string[];
  clusters?: Record<string, string>[];
  unreachable?: boolean;
}): QueryDriver {
  const names = (list: string[]) => list.map((name) => ({ name }));
  return {
    execute<Row>({ sql }: { sql: string }) {
      const answer = (rows: Record<string, unknown>[]) => Promise.resolve({ rows: rows as Row[] });
      if (sql.includes("system.replicas")) {
        return answer([{ max_total_replicas: String(maxTotalReplicas) }]);
      }
      if (sql.includes("system.server_settings")) return answer([]);
      if (sql.includes("system.clusters")) return answer(clusters);
      if (sql.includes("clusterAllReplicas('langwatch', system.functions)")) {
        if (unreachable) return Promise.reject(new Error("All connection tries failed: ch-2:9000"));
        return answer(
          replicas.map(({ host, functions }) => ({
            host,
            functions: Object.fromEntries(
              functions.map((name) => [name, `CREATE FUNCTION ${name}`]),
            ),
          })),
        );
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

function provisionableOver(driver: QueryDriver): Promise<boolean[]> {
  const repository = ClickHouseLangWatchQLAppFunctionStoreRepository.create(
    new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver }),
  );
  return repository.findProbe().then((probes) => probes.map(canProvisionAppFunctions));
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

  describe("given a replicated server where one replica cannot be reached", () => {
    /** @scenario "A replicated server with an unreachable replica is not checked" */
    it("answers nothing, so the functions are skipped", async () => {
      await expect(
        provisionableOver(
          clickHouse2510({ maxTotalReplicas: 3, keeper: "with-function-store", unreachable: true }),
        ),
      ).resolves.toEqual([]);
    });
  });

  describe("given a replicated server where fewer hosts answer than the cluster has", () => {
    it("answers nothing rather than trusting the replicas it could see", async () => {
      await expect(
        provisionableOver(
          clickHouse2510({
            maxTotalReplicas: 3,
            keeper: "with-function-store",
            replicas: THREE_EMPTY_REPLICAS.slice(0, 2),
          }),
        ),
      ).resolves.toEqual([]);
    });
  });

  describe("given a replicated server with no cluster spanning its replicas", () => {
    it("answers nothing, since no query can reach every replica", async () => {
      await expect(
        provisionableOver(
          clickHouse2510({
            maxTotalReplicas: 3,
            keeper: "with-function-store",
            clusters: [{ name: "default", hosts: "1", widest_shard: "1" }],
          }),
        ),
      ).resolves.toEqual([]);
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
