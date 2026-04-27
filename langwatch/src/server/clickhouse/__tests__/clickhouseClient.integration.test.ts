/**
 * @vitest-environment node
 *
 * Integration tests for per-organization ClickHouse client routing.
 * Spins up two ClickHouse containers to verify that data is routed
 * to the correct instance based on env var configuration.
 *
 * Env var format: CLICKHOUSE_URL__<label>__<orgId>=<connectionUrl>
 */
import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { prisma } from "~/server/db";

const TEST_TABLE = "routing_test";
const TEST_DATABASE = "test_routing";

let sharedContainer: StartedClickHouseContainer;
let privateContainer: StartedClickHouseContainer;
let sharedClient: ClickHouseClient;
let privateClient: ClickHouseClient;
let sharedUrl: string;
let privateUrl: string;

// The org IDs we'll use — set the env var BEFORE importing clickhouseClient
const PRIVATE_ORG_ID = `test-private-org-${nanoid(6)}`;
const SHARED_ORG_ID = `test-shared-org-${nanoid(6)}`;

async function setupTestSchema(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${TEST_DATABASE}`,
  });
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${TEST_DATABASE}.${TEST_TABLE} (
      id String,
      project_id String,
      data String
    ) ENGINE = MergeTree()
    ORDER BY id`,
  });
}

async function insertTestRow(
  client: ClickHouseClient,
  { id, projectId, data }: { id: string; projectId: string; data: string },
): Promise<void> {
  await client.insert({
    table: `${TEST_DATABASE}.${TEST_TABLE}`,
    values: [{ id, project_id: projectId, data }],
    format: "JSONEachRow",
  });
}

async function queryTestRow(
  client: ClickHouseClient,
  id: string,
): Promise<{ id: string; project_id: string; data: string }[]> {
  const result = await client.query({
    query: `SELECT * FROM ${TEST_DATABASE}.${TEST_TABLE} WHERE id = {id:String}`,
    query_params: { id },
    format: "JSONEachRow",
  });
  return result.json();
}

async function createTestOrgWithProject({
  namespace,
  organizationId,
}: {
  namespace: string;
  organizationId?: string;
}): Promise<{ projectId: string; organizationId: string; teamId: string }> {
  const orgSlug = `--test-ch-routing-${namespace}-${nanoid(6)}`;
  const teamSlug = `--test-ch-team-${namespace}-${nanoid(6)}`;
  const projectSlug = `--test-ch-proj-${namespace}-${nanoid(6)}`;

  const organization = await prisma.organization.create({
    data: {
      ...(organizationId ? { id: organizationId } : {}),
      name: `Test CH Routing Org ${namespace}`,
      slug: orgSlug,
    },
  });

  const team = await prisma.team.create({
    data: {
      name: `Test CH Team ${namespace}`,
      slug: teamSlug,
      organizationId: organization.id,
    },
  });

  const project = await prisma.project.create({
    data: {
      name: `Test CH Project ${namespace}`,
      slug: projectSlug,
      apiKey: `test-ch-key-${nanoid()}`,
      teamId: team.id,
      language: "en",
      framework: "test",
    },
  });

  return {
    projectId: project.id,
    organizationId: organization.id,
    teamId: team.id,
  };
}

const createdProjectIds: string[] = [];
const createdTeamIds: string[] = [];
const createdOrgIds: string[] = [];

/**
 * Mock the shared client to return our shared test container client.
 */
vi.mock("../client", () => ({
  _getSharedClickHouseClient: () => sharedClient,
}));

describe("ClickHouse routing via env vars", () => {
  beforeAll(async () => {
    const [shared, private_] = await Promise.all([
      new ClickHouseContainer("clickhouse/clickhouse-server:25.10.2.65")
        .withLabels({ "langwatch.test.routing": "shared" })
        .withReuse()
        .withStartupTimeout(120_000)
        .start(),
      new ClickHouseContainer("clickhouse/clickhouse-server:25.10.2.65")
        .withLabels({ "langwatch.test.routing": "private" })
        .withReuse()
        .withStartupTimeout(120_000)
        .start(),
    ]);

    sharedContainer = shared;
    privateContainer = private_;

    sharedUrl = sharedContainer.getConnectionUrl();
    privateUrl = privateContainer.getConnectionUrl();

    // Set the private CH env var BEFORE importing clickhouseClient
    process.env[`CLICKHOUSE_URL__testcustomer__${PRIVATE_ORG_ID}`] = privateUrl;

    sharedClient = createClient({
      url: sharedUrl,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });

    privateClient = createClient({
      url: privateUrl,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });

    await Promise.all([
      setupTestSchema(sharedClient),
      setupTestSchema(privateClient),
    ]);
  }, 300_000);

  afterAll(async () => {
    const { clearCustomClientCache, clearProjectOrgCache } = await import("../clickhouseClient");
    await clearCustomClientCache();
    clearProjectOrgCache();

    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
    }
    if (createdTeamIds.length > 0) {
      await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    }
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    }

    await Promise.all([sharedClient?.close(), privateClient?.close()]);

    // Clean up env var
    delete process.env[`CLICKHOUSE_URL__testcustomer__${PRIVATE_ORG_ID}`];
  }, 60_000);

  describe("when org has no private ClickHouse env var", () => {
    it("returns the shared (default) client", async () => {
      const { getClickHouseClientForProject } = await import("../clickhouseClient");

      const { projectId, organizationId, teamId } = await createTestOrgWithProject({
        namespace: "no-custom",
        organizationId: SHARED_ORG_ID,
      });
      createdProjectIds.push(projectId);
      createdTeamIds.push(teamId);
      createdOrgIds.push(organizationId);

      const client = await getClickHouseClientForProject(projectId);
      expect(client).toBe(sharedClient);

      const rowId = `shared-${nanoid(8)}`;
      await insertTestRow(client!, { id: rowId, projectId, data: "shared-data" });

      const rows = await queryTestRow(sharedClient, rowId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data).toBe("shared-data");

      const privateRows = await queryTestRow(privateClient, rowId);
      expect(privateRows).toHaveLength(0);
    });
  });

  describe("when org has a private ClickHouse env var configured", () => {
    it("returns a client connected to the private instance", async () => {
      const { getClickHouseClientForProject } = await import("../clickhouseClient");

      const { projectId, organizationId, teamId } = await createTestOrgWithProject({
        namespace: "with-private",
        organizationId: PRIVATE_ORG_ID,
      });
      createdProjectIds.push(projectId);
      createdTeamIds.push(teamId);
      createdOrgIds.push(organizationId);

      const client = await getClickHouseClientForProject(projectId);
      expect(client).not.toBe(sharedClient);

      const rowId = `private-${nanoid(8)}`;
      await insertTestRow(client!, { id: rowId, projectId, data: "private-data" });

      const privateRows = await queryTestRow(privateClient, rowId);
      expect(privateRows).toHaveLength(1);
      expect(privateRows[0]!.data).toBe("private-data");

      const sharedRows = await queryTestRow(sharedClient, rowId);
      expect(sharedRows).toHaveLength(0);
    });
  });

  describe("when called twice for the same organization", () => {
    it("returns the same cached client instance", async () => {
      const { getClickHouseClientForOrganization, clearCustomClientCache } =
        await import("../clickhouseClient");

      await clearCustomClientCache();

      const client1 = await getClickHouseClientForOrganization(PRIVATE_ORG_ID);
      const client2 = await getClickHouseClientForOrganization(PRIVATE_ORG_ID);

      expect(client1).toBe(client2);
    });
  });

  describe("when getClickHouseClientForOrganization is called", () => {
    it("routes to the private instance without any DB query", async () => {
      const { getClickHouseClientForOrganization } = await import("../clickhouseClient");

      const client = await getClickHouseClientForOrganization(PRIVATE_ORG_ID);
      expect(client).not.toBeNull();

      const pingResult = await client!.ping();
      expect(pingResult.success).toBe(true);
    });
  });

  describe("when getAllClickHouseInstances is called", () => {
    it("returns both shared and private instances", async () => {
      const { getAllClickHouseInstances } = await import("../clickhouseClient");

      const instances = await getAllClickHouseInstances();
      expect(instances.length).toBeGreaterThanOrEqual(2);

      const shared = instances.find((i) => i.target === "shared");
      expect(shared).toBeDefined();

      const private_ = instances.find((i) => i.target === PRIVATE_ORG_ID);
      expect(private_).toBeDefined();
    });
  });
});
