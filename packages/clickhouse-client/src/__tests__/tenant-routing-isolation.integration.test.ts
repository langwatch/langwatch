/** @vitest-environment node */

/**
 * Two mutually isolated ClickHouse endpoints. Every assertion is a row read
 * back from a server, and the one that matters is the negative: the row is
 * NOT on the other. Spec: specs/private-dataplane/clickhouse-routing.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { privateRouteOrgId, startTestClickHouseEndpoints } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnection,
  createTenantRouter,
  parseRoutingTable,
  PLATFORM_TENANT,
  PRIVATE_ROUTE_ENV_PREFIX,
  type ClickHouseClientCreationInput,
  type TenantDirectory,
} from "../index";

const TEST_TABLE = "tenant_routing_isolation";

/** The endpoints outlive the run natively, so ids are per-run or the counts
 *  drift upward on the second pass and the assertions stop meaning anything. */
const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Organization A is served by its own endpoint; organization B is not. */
const PRIVATE_ORGANIZATION = privateRouteOrgId("routing-private");
const SHARED_ORGANIZATION = privateRouteOrgId("routing-shared");
const PRIVATE_PROJECT = "project-on-the-private-instance";
const SHARED_PROJECT = "project-on-the-shared-instance";
/** A person who belongs to the organization that has its own instance. */
const MEMBER_OF_PRIVATE_ORGANIZATION = "user-in-the-private-organization";

/** The routing question, answered from a table rather than a database: what
 *  this suite proves is where a statement LANDS, not how the answer is found. */
const directory: TenantDirectory = {
  organizationForTenant: async (tenantId) =>
    ({
      [PRIVATE_PROJECT]: PRIVATE_ORGANIZATION,
      [SHARED_PROJECT]: SHARED_ORGANIZATION,
      // Placed rather than resolved: a person reaches several organizations and
      // picking one would put their identity history on an instance chosen by
      // accident.
      [MEMBER_OF_PRIVATE_ORGANIZATION]: PLATFORM_TENANT,
    })[tenantId] ?? null,
};

class VendorFactory extends ClickHouseClientFactory<ClickHouseClient & { close(): Promise<void> }> {
  create(input: ClickHouseClientCreationInput): ClickHouseClient & { close(): Promise<void> } {
    return createClient({
      url: input.url,
      max_open_connections: input.maxOpenConnections,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  }
}

async function createTestSchema(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
      id String,
      tenant_id String,
      data String
    ) ENGINE = MergeTree()
    ORDER BY (tenant_id, id)`,
  });
}

async function rowsFor(
  client: ClickHouseClient,
  { tenantId, id }: { tenantId: string; id: string },
): Promise<{ id: string; tenant_id: string; data: string }[]> {
  const result = await client.query({
    query: `SELECT id, tenant_id, data FROM ${TEST_TABLE}
            WHERE tenant_id = {tenantId:String} AND id = {id:String}`,
    query_params: { tenantId, id },
    format: "JSONEachRow",
  });
  return result.json();
}

let sharedProbe: ClickHouseClient;
let privateProbe: ClickHouseClient;
let connection: ClickHouseConnection<ClickHouseClient & { close(): Promise<void> }>;

describe("given an organization served by its own ClickHouse instance", () => {
  beforeAll(async () => {
    const [shared, isolated] = await startTestClickHouseEndpoints({
      suite: "ch-routing",
      names: ["shared", "private"],
    });
    if (!shared || !isolated) throw new Error("Two ClickHouse endpoints were not provisioned");

    // The env var an operator actually writes, parsed by the code that reads
    // it in production, so the route under test is the one a deployment gets.
    const table = parseRoutingTable({
      [`${PRIVATE_ROUTE_ENV_PREFIX}acme__${PRIVATE_ORGANIZATION}`]: isolated.url,
    });
    const configuration = ClickHouseConfigService.create().resolve({
      shared: { url: shared.url, cluster: "test" },
      privateRoutes: [...table.routes].map(([organizationId, url]) => ({
        organizationId,
        url,
        cluster: "test",
      })),
    });
    connection = ClickHouseConnection.create({
      configuration,
      router: createTenantRouter({ table, directory }),
      clientFactory: new VendorFactory(),
    });

    sharedProbe = createClient({ url: shared.url });
    privateProbe = createClient({ url: isolated.url });
    await Promise.all([createTestSchema(sharedProbe), createTestSchema(privateProbe)]);
  }, 300_000);

  afterAll(async () => {
    await connection?.closeOnce();
    await Promise.all([sharedProbe?.close(), privateProbe?.close()]);
  }, 60_000);

  describe("when a row is written through the routed client for a project in that organization", () => {
    /** @scenario "Data written for a private-CH org does not appear in shared" */
    it("lands on the private instance and nowhere else", async () => {
      const client = await connection.resolve(PRIVATE_PROJECT);
      const id = `private-row-${RUN}`;
      await client.insert({
        table: TEST_TABLE,
        values: [{ id, tenant_id: PRIVATE_PROJECT, data: "private-data" }],
        format: "JSONEachRow",
      });

      const onPrivate = await rowsFor(privateProbe, { tenantId: PRIVATE_PROJECT, id });
      expect(onPrivate).toHaveLength(1);
      expect(onPrivate[0]?.data).toBe("private-data");

      expect(await rowsFor(sharedProbe, { tenantId: PRIVATE_PROJECT, id })).toHaveLength(0);
    });
  });

  describe("when a row is written through the routed client for a project in a standard organization", () => {
    /** @scenario "Data written for a standard org does not appear in private" */
    it("lands on the shared instance and nowhere else", async () => {
      const client = await connection.resolve(SHARED_PROJECT);
      const id = `shared-row-${RUN}`;
      await client.insert({
        table: TEST_TABLE,
        values: [{ id, tenant_id: SHARED_PROJECT, data: "shared-data" }],
        format: "JSONEachRow",
      });

      const onShared = await rowsFor(sharedProbe, { tenantId: SHARED_PROJECT, id });
      expect(onShared).toHaveLength(1);
      expect(onShared[0]?.data).toBe("shared-data");

      expect(await rowsFor(privateProbe, { tenantId: SHARED_PROJECT, id })).toHaveLength(0);
    });
  });

  describe("when a row is written for a user who belongs to that organization", () => {
    /** @scenario "A user in a private-dataplane organization still routes to shared" */
    it("lands on the shared instance, and their organization's own is untouched", async () => {
      const client = await connection.resolve(MEMBER_OF_PRIVATE_ORGANIZATION);
      const id = `user-tenant-row-${RUN}`;
      await client.insert({
        table: TEST_TABLE,
        values: [{ id, tenant_id: MEMBER_OF_PRIVATE_ORGANIZATION, data: "identity-data" }],
        format: "JSONEachRow",
      });

      const onShared = await rowsFor(sharedProbe, {
        tenantId: MEMBER_OF_PRIVATE_ORGANIZATION,
        id,
      });
      expect(onShared).toHaveLength(1);

      expect(
        await rowsFor(privateProbe, { tenantId: MEMBER_OF_PRIVATE_ORGANIZATION, id }),
      ).toHaveLength(0);
    });
  });
});
