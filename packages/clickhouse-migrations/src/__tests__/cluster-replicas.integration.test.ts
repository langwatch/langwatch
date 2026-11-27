/**
 * @vitest-environment node
 * @integration
 * The replica count and the answering-replica query against a real server: the cluster the
 * server defines, every replica of it answering, and the failure when more are expected.
 * @see ../../../../specs/clickhouse/replicated-migration-versions.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  countAnsweringReplicas,
  MigrationError,
  readClusterReplicas,
  waitForClusterReplicas,
} from "../goose.migration-runner.ts";

describe("given a ClickHouse server that defines a cluster", () => {
  let client: ClickHouseClient;
  let clusterName: string;

  beforeAll(async () => {
    const [provisioned] = await startTestClickHouseEndpoints({
      suite: "clickhouse-cluster-replicas",
      names: ["replicas"],
      environment: process.env,
    });
    if (!provisioned) throw new Error("No ClickHouse endpoint was provisioned");
    client = createClient({ url: provisioned.url });
    const result = await client.query({
      query: "SELECT cluster FROM system.clusters ORDER BY cluster LIMIT 1",
      format: "JSONEachRow",
    });
    const [row] = await result.json<{ cluster: string }>();
    if (!row) throw new Error("The test ClickHouse defines no cluster");
    clusterName = row.cluster;
  }, 180_000);

  afterAll(async () => {
    await client?.close();
  });

  describe("when every replica of it answers", () => {
    it("counts each replica as answering and does not wait", async () => {
      const replicas = await readClusterReplicas({ client, clusterName });
      const logs: string[] = [];

      expect(await countAnsweringReplicas({ client, clusterName })).toBe(replicas);
      await waitForClusterReplicas({
        countAnswering: () => countAnsweringReplicas({ client, clusterName }),
        clusterName,
        replicas,
        waitSeconds: 0,
        log: (message) => logs.push(message),
      });
      expect(logs).toEqual([]);
    });
  });

  describe("when the run expects one replica more than answers", () => {
    it("fails in the bootstrap phase naming the one missing replica", async () => {
      const replicas = (await readClusterReplicas({ client, clusterName })) + 1;

      const failure = await waitForClusterReplicas({
        countAnswering: () => countAnsweringReplicas({ client, clusterName }),
        clusterName,
        replicas,
        waitSeconds: 0,
        log: () => {},
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(MigrationError);
      expect((failure as MigrationError).phase).toBe("bootstrap");
      expect((failure as MigrationError).message).toContain(
        `${replicas - 1} of ${replicas} replicas answering`,
      );
      expect((failure as MigrationError).message).toContain("1 missing");
    });
  });
});
