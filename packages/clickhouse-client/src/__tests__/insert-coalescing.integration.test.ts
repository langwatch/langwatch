/** @vitest-environment node */

/**
 * A burst of single-row async inserts through a full insert lane, against a real server: shared
 * statements land every row, lone ones shed what the wait queue cannot hold. ADR-187.
 * Spec: specs/clickhouse/single-client-access.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import type { LimiterStats } from "@langwatch/limiter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestClickHouseEndpoints } from "../clickhouse-test-endpoints.ts";
import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import {
  ClickHouseClientFactory,
  type ClickHouseClientCreationInput,
  ClickHouseConnection,
} from "../connection.ts";
import { COALESCABLE_ASYNC_INSERT_SETTINGS } from "../insert-coalescing.ts";
import {
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseStatementAdmission,
  type ClickHouseStatementOperation,
} from "../managed-client.ts";
import type { InsertRequest, QueryDriver } from "../query.ts";
import { routingDriver } from "../routingDriver.ts";
import { createTenantRouter, parseRoutingTable } from "../tenancy.ts";
import { TenantGuard } from "../tenantGuard.ts";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const TENANT = "project_burst";

/** A budget of four: a reserve of one, so the insert lane caps at three and queues 32. */
const SPLIT_BUDGET = 4;
const LANE_CAP = 3;
const BURST = 40;

class OverloadedError extends Error {
  constructor(readonly cause: unknown) {
    super("ClickHouse is overloaded.");
    this.name = "OverloadedError";
  }
}

class OverloadFactory extends ClickHouseOverloadErrorFactory {
  create({ cause }: { cause: unknown }): unknown {
    return new OverloadedError(cause);
  }
}

class CountingTelemetry extends ClickHouseManagedClientTelemetry {
  readonly shed: ClickHouseStatementOperation[] = [];
  registerLimiter(_input: { instance: string; stats: () => LimiterStats }): void {}
  unregisterLimiter(_instance: string): void {}
  observeStatementWait(): void {}
  incrementStatementsShed(input: { operation: ClickHouseStatementOperation }): void {
    this.shed.push(input.operation);
  }
}

class VendorFactory extends ClickHouseClientFactory<ClickHouseClient> {
  create(input: ClickHouseClientCreationInput): ClickHouseClient {
    return createClient({ url: input.url, max_open_connections: input.maxOpenConnections });
  }
}

let endpointUrl: string;
let probe: ClickHouseClient;
const opened: ClickHouseConnection<ClickHouseClient>[] = [];

/** A query client over the real server whose insert lane caps at three, counting statements. */
function boundedClient() {
  const connection = ClickHouseConnection.create({
    configuration: ClickHouseConfigService.create().resolve({
      shared: { url: endpointUrl, cluster: "test" },
    }),
    router: createTenantRouter({
      table: parseRoutingTable({}),
      directory: { organizationForTenant: async () => "organization_burst" },
    }),
    clientFactory: new VendorFactory(),
  });
  opened.push(connection);
  const routed = routingDriver(connection);
  const statements: InsertRequest[] = [];
  const driver: QueryDriver = {
    ...routed,
    insert(request) {
      statements.push(request);
      return routed.insert(request);
    },
  };
  const telemetry = new CountingTelemetry();
  const limiter = new ClickHouseStatementAdmission({
    instance: `burst-${RUN}-${opened.length}`,
    maxConcurrent: SPLIT_BUDGET,
    telemetry,
    overloadErrorFactory: new OverloadFactory(),
    statementWaitTimeoutMs: 60_000,
  });
  const client = new ClickHouseQueryClient({ driver, tenantGuard: new TenantGuard(), limiter });
  return { client, telemetry, statements };
}

async function createTable(table: string): Promise<void> {
  await probe.command({
    query: `CREATE TABLE ${table} (TenantId String, n UInt32) ENGINE = MergeTree ORDER BY (TenantId, n)`,
  });
}

async function rowsIn(table: string): Promise<number[]> {
  const result = await probe.query({
    query: `SELECT n FROM ${table} ORDER BY n`,
    format: "JSONEachRow",
  });
  return (await result.json<{ n: number }>()).map((row) => Number(row.n));
}

/** Sends `BURST` single-row inserts in one tick and settles each to written or refused. */
async function burst(
  client: ClickHouseQueryClient,
  table: string,
  settings: InsertRequest["settings"],
) {
  const outcomes = await Promise.all(
    Array.from({ length: BURST }, (_, n) =>
      client.insert({ tenantId: TENANT, table, rows: [{ TenantId: TENANT, n }], settings }).then(
        () => "written" as const,
        (error: unknown) => (error instanceof OverloadedError ? "refused" : error),
      ),
    ),
  );
  return outcomes;
}

describe("a burst of single-row async inserts against a real server, while the insert lane is full", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "insert-coalescing",
      names: ["shared"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("A ClickHouse endpoint was not provisioned");
    endpointUrl = endpoint.url;
    probe = createClient({ url: endpointUrl });
  }, 300_000);

  afterAll(async () => {
    await Promise.all(opened.map((connection) => connection.closeOnce()));
    await probe?.close();
  }, 60_000);

  describe("when they may share a statement", () => {
    /** @scenario async inserts waiting for a slot go as one statement */
    it("sends the waiting ones as one statement, sheds none, and writes every row", async () => {
      const table = `burst_shared_${RUN}`;
      await createTable(table);
      const { client, telemetry, statements } = boundedClient();

      const outcomes = await burst(client, table, COALESCABLE_ASYNC_INSERT_SETTINGS);

      expect(outcomes).toEqual(Array.from({ length: BURST }, () => "written"));
      expect(telemetry.shed).toEqual([]);
      expect(statements.slice(LANE_CAP)).toHaveLength(1);
      expect(await rowsIn(table)).toEqual(Array.from({ length: BURST }, (_, n) => n));
    });
  });

  describe("when they cannot share a statement", () => {
    /** @scenario only inserts that can share a statement share one */
    it("sends each alone and sheds those the wait queue cannot hold", async () => {
      const table = `burst_alone_${RUN}`;
      await createTable(table);
      const { client, telemetry, statements } = boundedClient();

      const outcomes = await burst(client, table, { async_insert: 1, wait_for_async_insert: 1 });

      const refused = outcomes.filter((outcome) => outcome === "refused");
      expect(refused.length).toBeGreaterThan(0);
      expect(telemetry.shed).toHaveLength(refused.length);
      expect(statements).toHaveLength(BURST - refused.length);
      expect(await rowsIn(table)).toHaveLength(BURST - refused.length);
    });
  });
});
