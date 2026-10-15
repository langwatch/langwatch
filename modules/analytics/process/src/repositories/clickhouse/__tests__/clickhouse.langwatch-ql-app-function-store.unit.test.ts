/**
 * The probe the deploy task and the ops checkup both read, over a driver that answers as
 * ClickHouse 25.10 does: system.server_settings never lists user_defined_zookeeper_path,
 * and a server with no Keeper has no system.zookeeper table at all.
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

function clickHouse2510({
  maxTotalReplicas,
  keeper,
}: {
  maxTotalReplicas: number;
  keeper: "absent" | "with-function-store" | "without-function-store";
}): QueryDriver {
  return {
    execute<Row>({ sql }: { sql: string }) {
      const answer = (rows: Record<string, unknown>[]) => Promise.resolve({ rows: rows as Row[] });
      if (sql.includes("system.replicas")) {
        return answer([{ max_total_replicas: String(maxTotalReplicas) }]);
      }
      if (sql.includes("system.server_settings")) return answer([]);
      if (sql.includes("system.zookeeper")) {
        if (keeper === "absent") return Promise.reject(unknownTable(sql));
        const found =
          keeper === "with-function-store" &&
          sql.includes("path = '/clickhouse'") &&
          sql.includes("name = 'user_defined'");
        return answer([{ stores: found ? "1" : "0" }]);
      }
      return Promise.reject(new Error(`unexpected statement: ${sql}`));
    },
    insert: () => Promise.reject(new Error("the probe never writes")),
    command: () => Promise.reject(new Error("the probe never writes")),
  };
}

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
        clickHouse2510({ maxTotalReplicas: 3, keeper: "with-function-store" }),
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

  describe("given a replicated ClickHouse with Keeper but no function store in it", () => {
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
