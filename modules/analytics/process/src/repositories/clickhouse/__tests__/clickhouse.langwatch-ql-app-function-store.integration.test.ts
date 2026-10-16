/**
 * The function store probe against a real ClickHouse with embedded Keeper. One server
 * holds two replicas of one table, so `system.replicas` reports a replicated layout
 * without a second container. Always its own containers: the Keeper config is the subject.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { TEST_CLICKHOUSE_IMAGE } from "@langwatch/clickhouse-client/testing";
import { ClickHouseContainer, type StartedClickHouseContainer } from "@testcontainers/clickhouse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findLangWatchQLAppFunctions } from "../../../features/app-functions/rules/langwatch-ql-app-function-catalog.rules.ts";
import {
  APP_FUNCTION_KEEPER_STORE_PATH,
  canProvisionAppFunctions,
} from "../../../features/app-functions/rules/langwatch-ql-app-function-store.rules.ts";
import { LangWatchQLAppFunctionStatementsService } from "../../../features/provisioning/services/langwatch-ql-app-function-statements.service.ts";
import { ClickHouseLangWatchQLAppFunctionStoreRepository } from "../clickhouse.langwatch-ql-app-function-store.repository.ts";

const KEEPER_CONFIG = `<clickhouse>
  <keeper_server>
    <tcp_port>9181</tcp_port>
    <server_id>1</server_id>
    <log_storage_path>/var/lib/clickhouse/coordination/log</log_storage_path>
    <snapshot_storage_path>/var/lib/clickhouse/coordination/snapshots</snapshot_storage_path>
    <raft_configuration><server><id>1</id><hostname>localhost</hostname><port>9234</port></server></raft_configuration>
  </keeper_server>
  <zookeeper><node><host>localhost</host><port>9181</port></node></zookeeper>
</clickhouse>`;

const FUNCTION_STORE_CONFIG = `<clickhouse>
  <user_defined_zookeeper_path>/clickhouse/user_defined</user_defined_zookeeper_path>
</clickhouse>`;

type ReplicatedServer = { container: StartedClickHouseContainer; client: ClickHouseClient };

async function startReplicatedServer({
  functionStore,
}: {
  functionStore: boolean;
}): Promise<ReplicatedServer> {
  const directory = mkdtempSync(join(tmpdir(), "lwql-function-store-"));
  const file = (name: string, contents: string) => {
    const path = join(directory, name);
    writeFileSync(path, contents);
    return path;
  };
  const container = await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
    .withCopyFilesToContainer([
      {
        source: file("keeper.xml", KEEPER_CONFIG),
        target: "/etc/clickhouse-server/config.d/keeper.xml",
      },
      ...(functionStore
        ? [
            {
              source: file("function-store.xml", FUNCTION_STORE_CONFIG),
              target: "/etc/clickhouse-server/config.d/function-store.xml",
            },
          ]
        : []),
    ])
    .withStartupTimeout(120_000)
    .start();
  const client = createClient({
    url: container.getHttpUrl(),
    username: container.getUsername(),
    password: container.getPassword(),
  });
  for (const replica of ["r1", "r2"]) {
    await client.command({
      query: `CREATE TABLE replica_${replica} (id UInt64) ENGINE = ReplicatedMergeTree('/clickhouse/tables/probe', '${replica}') ORDER BY id`,
    });
  }
  return { container, client };
}

async function provisionable({ client }: ReplicatedServer): Promise<boolean[]> {
  const repository = ClickHouseLangWatchQLAppFunctionStoreRepository.overAdmin({
    queryRows: async (sql) =>
      (await client.query({ query: sql, format: "JSONEachRow" })).json<Record<string, unknown>>(),
  });
  return (await repository.findProbe()).map(canProvisionAppFunctions);
}

/** Writes a Keeper node as another server would, through the image's own keeper-client. */
async function writeKeeperNode(
  { container }: ReplicatedServer,
  { path, value }: { path: string; value: string },
): Promise<void> {
  const { exitCode, output } = await container.exec([
    "clickhouse",
    "keeper-client",
    "--host=localhost",
    "--port=9181",
    `--query=create '${path}' '${value}'`,
  ]);
  if (exitCode !== 0) throw new Error(`keeper-client could not create ${path}: ${output}`);
}

async function keeperStoreNodes({ client }: ReplicatedServer): Promise<string[]> {
  const rows = await (
    await client.query({
      query: `SELECT name FROM system.zookeeper WHERE path = '${APP_FUNCTION_KEEPER_STORE_PATH}'`,
      format: "JSONEachRow",
    })
  ).json<{ name: string }>();
  return rows.map((row) => row.name);
}

describe("ClickHouseLangWatchQLAppFunctionStoreRepository on a replicated ClickHouse", () => {
  const servers: ReplicatedServer[] = [];

  afterAll(async () => {
    for (const { client, container } of servers) {
      await client.close();
      await container.stop();
    }
  });

  describe("given user_defined_zookeeper_path at /clickhouse/user_defined", () => {
    let server: ReplicatedServer;
    beforeAll(async () => {
      server = await startReplicatedServer({ functionStore: true });
      servers.push(server);
    }, 180_000);

    /** @scenario "The probe finds the function store in Keeper on a real replicated ClickHouse" */
    it("finds the store and allows the app functions", async () => {
      await expect(provisionable(server)).resolves.toEqual([true]);
    });

    /** @scenario "A function created on a real replicated ClickHouse lands in the Keeper function store" */
    it("stores the created llm_readable_thread in Keeper", async () => {
      const [definition] = findLangWatchQLAppFunctions("llm_readable_thread");
      if (definition === undefined) throw new Error("llm_readable_thread is not in the catalogue");
      await server.client.command({
        query: LangWatchQLAppFunctionStatementsService.create().functionStatement(definition),
      });
      await expect(keeperStoreNodes(server)).resolves.toContain("function_llm_readable_thread.sql");
    });
  });

  describe("given no user_defined_zookeeper_path", () => {
    let server: ReplicatedServer;
    beforeAll(async () => {
      server = await startReplicatedServer({ functionStore: false });
      servers.push(server);
    }, 180_000);

    /** @scenario "The probe refuses a real replicated ClickHouse with no function store in Keeper" */
    it("finds no store and refuses the app functions", async () => {
      await expect(provisionable(server)).resolves.toEqual([false]);
    });

    describe("when another server made the Keeper store and this one keeps a function on local disk", () => {
      beforeAll(async () => {
        await writeKeeperNode(server, { path: APP_FUNCTION_KEEPER_STORE_PATH, value: "store" });
        await writeKeeperNode(server, {
          path: `${APP_FUNCTION_KEEPER_STORE_PATH}/function_x.sql`,
          value: "CREATE FUNCTION x AS () -> 1",
        });
        await server.client.command({ query: "CREATE FUNCTION local_only AS () -> 1" });
      });

      /** @scenario "The probe refuses a real replicated ClickHouse that keeps its functions locally beside another server's Keeper store" */
      it("sees the store but refuses the app functions", async () => {
        await expect(keeperStoreNodes(server)).resolves.toEqual(["function_x.sql"]);
        await expect(provisionable(server)).resolves.toEqual([false]);
      });
    });
  });
});
