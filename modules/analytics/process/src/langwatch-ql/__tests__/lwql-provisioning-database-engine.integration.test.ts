/**
 * LangWatchQL provisioning against an already-migrated database: the structural statements
 * leave the database's engine alone, and a database other than the application's is refused.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "../../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLSelfProvisioningService } from "../../services/langwatch-ql-self-provisioning.service.ts";

const enabled = Boolean(process.env.LANGWATCH_TEST_CLICKHOUSE_URL);
const accessModel = LangWatchQLAccessModelService.create();
const selfProvisioning = LangWatchQLSelfProvisioningService.create();

describe.runIf(enabled)(
  "given the application's database already created by its migrations",
  () => {
    let client: ClickHouseClient;
    let database: string;
    let names: LangWatchQLNames;

    async function engineOfDatabase(): Promise<string> {
      const result = await client.query({
        query: "SELECT engine FROM system.databases WHERE name = {name:String}",
        query_params: { name: database },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ engine: string }>();
      const [row] = rows;
      if (!row) throw new Error(`database ${database} does not exist`);

      return row.engine;
    }

    beforeAll(async () => {
      const [endpoint] = await startTestClickHouseEndpoints({
        suite: "lwql-provision-engine",
        names: ["migrated"],
        environment: process.env,
      });
      if (!endpoint) throw new Error("no ClickHouse endpoint was provisioned");
      database = endpoint.database;
      client = createClient({ url: endpoint.url });
      names = {
        database,
        restrictedUser: `${database}_lwql`,
        settingsProfile: `${database}_profile`,
        keyMapTable: "lwql_api_key_tenant_map",
        tenantSetting: "custom_api_key_hash",
      };
    }, 120_000);

    afterAll(async () => {
      await client?.close();
    });

    describe("when LangWatchQL provisioning runs its structural statements", () => {
      /** @scenario "Provisioning does not alter the migrated database" */
      it("leaves the database engine unchanged", async () => {
        const before = await engineOfDatabase();

        for (const query of accessModel.setupStatements({ names, includeAppFunctions: false })) {
          await client.command({ query });
        }

        expect(await engineOfDatabase()).toBe(before);
      });

      /** @scenario "Provisioning does not alter the migrated database" */
      it("refuses a database name that differs from the connection URL's", () => {
        expect(() =>
          selfProvisioning.clickHouseStatements({
            names: { ...names, database: "elsewhere" },
            restrictedPassword: "pw",
            sourceDatabase: database,
            postgres: {
              endpoint: { host: "pg", port: 5432, database: "langwatch" },
              readerPassword: "reader",
            },
          }),
        ).toThrow(/application's own ClickHouse database/);
      });
    });
  },
);
