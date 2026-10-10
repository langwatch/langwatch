/** @vitest-environment node */

/**
 * Metric rows against two mutually isolated ClickHouse endpoints, written and
 * read through the routed `clickhouse` member the process hands this repository.
 * specs/private-dataplane/data-isolation.feature
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnection,
  ClickHouseQueryClient,
  createTenantRouter,
  DEFAULT_CLICKHOUSE_SETTINGS,
  isTransientClickHouseError,
  parseRoutingTable,
  PRIVATE_ROUTE_ENV_PREFIX,
  routingDriver,
  type ClickHouseClientCreationInput,
  type TenantDirectory,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  privateRouteOrgId,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import type { CanonicalMetricDataPoint } from "@langwatch/metric-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { point } from "../../../app/__tests__/metric.fixture.ts";
import { ClickHouseMetricDataPointAppendRepository } from "../clickhouse.metric-data-point-append.repository.ts";

const PRIVATE_ORGANIZATION = privateRouteOrgId("metric-isolation-private");
const SHARED_ORGANIZATION = privateRouteOrgId("metric-isolation-shared");
const PRIVATE_PROJECT = `proj-private-${randomUUID()}`;
const SHARED_PROJECT = `proj-shared-${randomUUID()}`;
/** Nothing listens on the discard port, so a statement routed here is refused at connect. */
const UNREACHABLE_URL = "http://127.0.0.1:9";
const POINT_TABLES = ["metric_data_points", "metric_usage_estimates"];

const directory: TenantDirectory = {
  organizationForTenant: async (tenantId) =>
    ({
      [PRIVATE_PROJECT]: PRIVATE_ORGANIZATION,
      [SHARED_PROJECT]: SHARED_ORGANIZATION,
    })[tenantId] ?? null,
};

class VendorFactory extends ClickHouseClientFactory<ClickHouseClient & { close(): Promise<void> }> {
  create(input: ClickHouseClientCreationInput): ClickHouseClient & { close(): Promise<void> } {
    return createClient({
      url: input.url,
      max_open_connections: input.maxOpenConnections,
      clickhouse_settings: {
        ...DEFAULT_CLICKHOUSE_SETTINGS,
        date_time_input_format: "best_effort",
      },
    });
  }
}

function routedMember({ sharedUrl, privateUrl }: { sharedUrl: string; privateUrl: string }) {
  const table = parseRoutingTable({
    [`${PRIVATE_ROUTE_ENV_PREFIX}acme__${PRIVATE_ORGANIZATION}`]: privateUrl,
  });
  const configuration = ClickHouseConfigService.create().resolve({
    shared: { url: sharedUrl, cluster: "test" },
    privateRoutes: [...table.routes].map(([organizationId, url]) => ({
      organizationId,
      url,
      cluster: "test",
    })),
  });
  const connection = ClickHouseConnection.create({
    configuration,
    router: createTenantRouter({ table, directory }),
    clientFactory: new VendorFactory(),
  });
  const clickhouse = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver: routingDriver(connection),
  });
  const metrics = ClickHouseMetricDataPointAppendRepository.create({
    resolveClient: ClickHouseMetricDataPointAppendRepository.resolverOver(clickhouse),
    defaultRetentionDays: 30,
  });
  return { connection, clickhouse, metrics };
}

function pointFor({
  tenantId,
  organizationId,
}: {
  tenantId: string;
  organizationId: string;
}): CanonicalMetricDataPoint {
  const now = Date.now();
  return point({
    tenantId,
    organizationId,
    pointId: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    timeUnixMs: now,
    acceptedAt: now,
    valueDouble: 1,
  });
}

async function pointIdsOn(
  client: ClickHouseClient,
  { table, tenantId }: { table: string; tenantId: string },
): Promise<string[]> {
  const result = await client.query({
    query: `SELECT PointId FROM ${table} WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  return (await result.json<{ PointId: string }>()).map((row) => row.PointId);
}

let sharedProbe: ClickHouseClient;
let privateProbe: ClickHouseClient;
let routed: ReturnType<typeof routedMember>;
let down: ReturnType<typeof routedMember>;

describe("given one organization on a private ClickHouse instance and one on the shared instance", () => {
  beforeAll(async () => {
    const [shared, isolated] = await startTestClickHouseEndpoints({
      suite: "ch-metric-isolation",
      names: ["shared", "private"],
      environment: process.env,
    });
    if (!shared || !isolated) throw new Error("Two ClickHouse endpoints were not provisioned");

    for (const endpoint of [shared, isolated]) {
      await migrateTestClickHouseOnce({
        url: endpoint.url,
        migrate: async () => {
          // CLICKHOUSE_CLUSTER switches every engine to its Replicated form,
          // which needs a Keeper no test server has.
          const previousCluster = process.env.CLICKHOUSE_CLUSTER;
          delete process.env.CLICKHOUSE_CLUSTER;
          try {
            await ClickHouseMigrateTask.createFromConfig({
              config: {
                buildTime: false,
                skipped: false,
                sharedUrl: endpoint.url,
                privateEndpoints: [],
                settings: {
                  coldStorageEnabled: false,
                  hotDayOverrides: {},
                  childEnvironment: { PATH: process.env.PATH, HOME: process.env.HOME },
                },
              },
            }).execute();
          } finally {
            if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
          }
        },
      });
    }

    routed = routedMember({ sharedUrl: shared.url, privateUrl: isolated.url });
    down = routedMember({ sharedUrl: shared.url, privateUrl: UNREACHABLE_URL });
    sharedProbe = createClient({ url: shared.url });
    privateProbe = createClient({ url: isolated.url });
  }, 600_000);

  afterAll(async () => {
    await Promise.all([routed?.connection.closeOnce(), down?.connection.closeOnce()]);
    await Promise.all([sharedProbe?.close(), privateProbe?.close()]);
  }, 60_000);

  describe("when a metric point is written for the private-instance organization", () => {
    /** @scenario "Metric points for a private-CH org land in the private instance only" */
    it("stores the point and its usage estimate on the private instance and nowhere else", async () => {
      const written = pointFor({ tenantId: PRIVATE_PROJECT, organizationId: PRIVATE_ORGANIZATION });
      await routed.metrics.ensureDataPoint({ point: written });

      for (const table of POINT_TABLES) {
        expect(await pointIdsOn(privateProbe, { table, tenantId: PRIVATE_PROJECT })).toContain(
          written.pointId,
        );
        expect(await pointIdsOn(sharedProbe, { table, tenantId: PRIVATE_PROJECT })).toEqual([]);
      }
    });
  });

  describe("when the private-instance organization reads its data points", () => {
    /** @scenario "Metric reads for a private-CH org come from the private instance only" */
    it("returns the point held only on the private instance", async () => {
      const written = pointFor({ tenantId: PRIVATE_PROJECT, organizationId: PRIVATE_ORGANIZATION });
      await routed.metrics.ensureDataPoint({ point: written });
      expect(
        await pointIdsOn(sharedProbe, { table: "metric_data_points", tenantId: PRIVATE_PROJECT }),
      ).toEqual([]);

      const read = await routed.clickhouse.query<{ PointId: string }>({
        tenantId: PRIVATE_PROJECT,
        sql: `SELECT PointId FROM metric_data_points
              WHERE TenantId = {tenantId:String} AND PointId = {pointId:String}`,
        params: { tenantId: PRIVATE_PROJECT, pointId: written.pointId },
      });

      expect(read.rows.map((row) => row.PointId)).toEqual([written.pointId]);
    });
  });

  describe("when the shared-instance organization reads by the private organization's point id", () => {
    /** @scenario "Another org's metric reads never see a private-CH org's points" */
    it("returns nothing", async () => {
      const written = pointFor({ tenantId: PRIVATE_PROJECT, organizationId: PRIVATE_ORGANIZATION });
      await routed.metrics.ensureDataPoint({ point: written });

      // Routed as the shared project, naming the private one: the shared route must not reach it.
      const read = await routed.clickhouse.query<{ PointId: string }>({
        tenantId: SHARED_PROJECT,
        sql: `SELECT PointId FROM metric_data_points
              WHERE TenantId = {tenantId:String} AND PointId = {pointId:String}`,
        params: { tenantId: PRIVATE_PROJECT, pointId: written.pointId },
      });

      expect(read.rows).toEqual([]);
    });
  });

  describe("when the private instance is unreachable", () => {
    /** @scenario "Metric writes for a private-CH org fail retryably while its private instance is down" */
    it("fails the private write transiently, writes nothing shared, and still serves the shared organization", async () => {
      const privatePoint = pointFor({
        tenantId: PRIVATE_PROJECT,
        organizationId: PRIVATE_ORGANIZATION,
      });
      const sharedPoint = pointFor({
        tenantId: SHARED_PROJECT,
        organizationId: SHARED_ORGANIZATION,
      });

      await expect(down.metrics.ensureDataPoint({ point: privatePoint })).rejects.toSatisfy(
        (error) => isTransientClickHouseError({ error }),
      );
      for (const table of POINT_TABLES) {
        expect(await pointIdsOn(sharedProbe, { table, tenantId: PRIVATE_PROJECT })).toEqual([]);
      }

      await down.metrics.ensureDataPoint({ point: sharedPoint });
      expect(
        await pointIdsOn(sharedProbe, { table: "metric_data_points", tenantId: SHARED_PROJECT }),
      ).toContain(sharedPoint.pointId);
    });
  });
});
