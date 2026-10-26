/**
 * The function store checks against two real ClickHouse 25.10 replicas sharing one Keeper.
 * Every probe and check runs through the second replica, as a load-balanced URL may, while
 * creates run through either. Always its own containers: the server config is the subject.
 */
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
import {
  APP_FUNCTION_SPLIT_CODE,
  verifyAppFunctionsOnEveryReplica,
} from "../../../tasks/lwql-provision.task.ts";
import { ClickHouseLangWatchQLAppFunctionStoreRepository } from "../clickhouse.langwatch-ql-app-function-store.repository.ts";

const CREDENTIALS = { username: "lwtest", password: "lwtest" };
const CLUSTER = "lwtest";

const KEEPER_SERVER_CONFIG = `<clickhouse>
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

/**
 * Inter-server login as the clickhouse-serverless image 0.4.0 renders it: ClickHouse
 * substitutes no `from_file`, so the secret is empty and each hop logs in as user
 * `default`, which the replicas do not have.
 */
const UNRESOLVED_SECRET = `<secret from_file="/mnt/secrets/cluster-secret"/>`;

/** The second replica's view: Keeper on the first, and a cluster of both. */
function clusterConfig({
  keeperHost,
  hop,
}: {
  keeperHost: string;
  hop: "credentials" | "unresolved-secret";
}): string {
  const login =
    hop === "credentials"
      ? `<user>${CREDENTIALS.username}</user><password>${CREDENTIALS.password}</password>`
      : "";
  const replica = (host: string) =>
    `<replica><host>${host}</host><port>9000</port>${login}</replica>`;
  const secret = hop === "credentials" ? "" : UNRESOLVED_SECRET;
  return `<clickhouse>
  <zookeeper><node><host>${keeperHost}</host><port>9181</port></node></zookeeper>
  <remote_servers><${CLUSTER}>${secret}<shard>${replica(keeperHost)}${replica("localhost")}</shard></${CLUSTER}></remote_servers>
</clickhouse>`;
}

type Node = { container: StartedClickHouseContainer; client: ClickHouseClient; host: string };
type Cluster = { first: Node; second: Node };

async function startNode({
  configs,
  replica,
}: {
  configs: Record<string, string>;
  replica: string;
}): Promise<Node> {
  const container = await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
    .withUsername(CREDENTIALS.username)
    .withPassword(CREDENTIALS.password)
    .withCopyContentToContainer(
      Object.entries(configs).map(([name, content]) => ({
        content,
        target: `/etc/clickhouse-server/config.d/${name}.xml`,
      })),
    )
    .withStartupTimeout(120_000)
    .start();
  const client = createClient({ url: container.getHttpUrl(), ...CREDENTIALS });
  await client.command({
    query: `CREATE TABLE probe (id UInt64) ENGINE = ReplicatedMergeTree('/clickhouse/tables/probe', '${replica}') ORDER BY id`,
  });
  const [self] = await rows<{ host: string }>(client, "SELECT hostName() AS host");
  if (self === undefined) throw new Error("the replica did not report its hostName()");
  return { container, client, host: self.host };
}

/** Two replicas of one table; the second keeps functions in Keeper or on its local disk. */
async function startCluster({
  second,
  hop = "credentials",
}: {
  second: "keeper" | "local";
  hop?: "credentials" | "unresolved-secret";
}): Promise<Cluster> {
  const first = await startNode({
    configs: { keeper: KEEPER_SERVER_CONFIG, "function-store": FUNCTION_STORE_CONFIG },
    replica: "r1",
  });
  const keeperHost = first.container.getIpAddress("bridge");
  const secondNode = await startNode({
    configs: {
      cluster: clusterConfig({ keeperHost, hop }),
      ...(second === "keeper" ? { "function-store": FUNCTION_STORE_CONFIG } : {}),
    },
    replica: "r2",
  });
  return { first, second: secondNode };
}

async function rows<Row>(client: ClickHouseClient, query: string): Promise<Row[]> {
  return (await client.query({ query, format: "JSONEachRow" })).json<Row>();
}

/** The repository over the second replica, as the deploy task's admin connection. */
function storeOver({ second }: Cluster) {
  return ClickHouseLangWatchQLAppFunctionStoreRepository.overAdmin({
    admin: { queryRows: (sql) => rows<Record<string, unknown>>(second.client, sql) },
    cluster: undefined,
  });
}

async function provisionable(cluster: Cluster): Promise<boolean[]> {
  return (await storeOver(cluster).findProbe()).map(canProvisionAppFunctions);
}

async function keeperStoreNodes({ first }: Cluster): Promise<string[]> {
  const found = await rows<{ name: string }>(
    first.client,
    `SELECT name FROM system.zookeeper WHERE path = '${APP_FUNCTION_KEEPER_STORE_PATH}'`,
  );
  return found.map((row) => row.name);
}

describe("ClickHouseLangWatchQLAppFunctionStoreRepository on two replicas sharing Keeper", () => {
  const clusters: Cluster[] = [];

  afterAll(async () => {
    for (const node of clusters.flatMap(({ first, second }) => [second, first])) {
      await node.client.close();
      await node.container.stop();
    }
  });

  describe("given user_defined_zookeeper_path at /clickhouse/user_defined on both replicas", () => {
    let cluster: Cluster;
    beforeAll(async () => {
      cluster = await startCluster({ second: "keeper" });
      clusters.push(cluster);
    }, 240_000);

    /** @scenario "The probe finds the function store in Keeper on every replica of a real replicated ClickHouse" */
    it("finds the store on every replica and allows the app functions", async () => {
      await expect(provisionable(cluster)).resolves.toEqual([true]);
    });

    /** @scenario "A function created on a real replicated ClickHouse reaches Keeper and every replica" */
    it("stores the created llm_readable_thread in Keeper and every replica loads it", async () => {
      const [definition] = findLangWatchQLAppFunctions("llm_readable_thread");
      if (definition === undefined) throw new Error("llm_readable_thread is not in the catalogue");
      await cluster.first.client.command({
        query: LangWatchQLAppFunctionStatementsService.create().functionStatement(definition),
      });

      await expect(keeperStoreNodes(cluster)).resolves.toContain(
        "function_llm_readable_thread.sql",
      );
      const store = storeOver(cluster);
      await expect(
        verifyAppFunctionsOnEveryReplica({
          findSplit: () => store.findSplitAppFunctions({ names: ["llm_readable_thread"] }),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given both replicas keep functions in Keeper but refuse the cross-replica login", () => {
    let cluster: Cluster;
    beforeAll(async () => {
      cluster = await startCluster({ second: "keeper", hop: "unresolved-secret" });
      clusters.push(cluster);
    }, 240_000);

    /** @scenario "A real replicated ClickHouse that refuses the cross-replica login still gets the functions" */
    it("is refused by clusterAllReplicas, yet allows the functions and checks the create on this server", async () => {
      await expect(
        rows(
          cluster.second.client,
          `SELECT count() FROM clusterAllReplicas('${CLUSTER}', system.one)`,
        ),
      ).rejects.toMatchObject({ code: "516" });
      await expect(provisionable(cluster)).resolves.toEqual([true]);

      const [definition] = findLangWatchQLAppFunctions("llm_readable_thread");
      if (definition === undefined) throw new Error("llm_readable_thread is not in the catalogue");
      await cluster.first.client.command({
        query: LangWatchQLAppFunctionStatementsService.create().functionStatement(definition),
      });
      const store = storeOver(cluster);
      await expect(
        verifyAppFunctionsOnEveryReplica({
          findSplit: () => store.findSplitAppFunctions({ names: ["llm_readable_thread"] }),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given the second replica keeps its functions on local disk", () => {
    let cluster: Cluster;
    beforeAll(async () => {
      cluster = await startCluster({ second: "local" });
      clusters.push(cluster);
    }, 240_000);

    describe("when a function is created through the local-disk replica", () => {
      beforeAll(async () => {
        await cluster.second.client.command({ query: "CREATE FUNCTION local_only AS () -> 1" });
      });

      /** @scenario "A function created through a replica on local disk is reported missing from the other replicas" */
      it("reports the function missing from the Keeper replica and from Keeper, and fails the step", async () => {
        const store = storeOver(cluster);
        await expect(store.findSplitAppFunctions({ names: ["local_only"] })).resolves.toEqual([
          {
            name: "local_only",
            missingOn: [cluster.first.host],
            inKeeper: false,
            oneDefinition: true,
          },
        ]);
        await expect(
          verifyAppFunctionsOnEveryReplica({
            findSplit: () => store.findSplitAppFunctions({ names: ["local_only"] }),
            waitMs: 1_000,
            pollMs: 200,
          }),
        ).rejects.toMatchObject({ code: APP_FUNCTION_SPLIT_CODE });
      });

      /** @scenario "The probe refuses a real replicated ClickHouse where one replica keeps its functions on local disk" */
      it("refuses the app functions on the next probe", async () => {
        await expect(provisionable(cluster)).resolves.toEqual([false]);
      });
    });

    describe("when both replicas hold the same function by name, one in Keeper and one locally", () => {
      beforeAll(async () => {
        await cluster.second.client.command({ query: "DROP FUNCTION local_only" });
        await cluster.first.client.command({ query: "CREATE FUNCTION same_name AS () -> 1" });
        await cluster.second.client.command({ query: "CREATE FUNCTION same_name AS () -> 1" });
      });

      /** @scenario "A replace through a replica on local disk that matched the store by name is caught after the create" */
      it("passes the probe by name, catches the replace that reached one replica, then refuses", async () => {
        await expect(provisionable(cluster)).resolves.toEqual([true]);

        await cluster.second.client.command({
          query: "CREATE OR REPLACE FUNCTION same_name AS () -> 2",
        });

        await expect(
          storeOver(cluster).findSplitAppFunctions({ names: ["same_name"] }),
        ).resolves.toEqual([
          { name: "same_name", missingOn: [], inKeeper: true, oneDefinition: false },
        ]);
        await expect(provisionable(cluster)).resolves.toEqual([false]);
      });
    });
  });
});
