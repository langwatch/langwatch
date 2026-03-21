/**
 * @vitest-environment node
 *
 * Integration tests for per-organization ClickHouse client routing.
 * Spins up two ClickHouse containers to verify that data is routed
 * to the correct instance based on organization configuration.
 */
import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { encrypt } from "~/utils/encryption";
import { prisma } from "~/server/db";
import type { CustomClickhouseConfig } from "../clickhouseClient";

const TEST_TABLE = "routing_test";
const TEST_DATABASE = "test_routing";

let sharedContainer: StartedClickHouseContainer;
let privateContainer: StartedClickHouseContainer;
let sharedClient: ClickHouseClient;
let privateClient: ClickHouseClient;
let sharedUrl: string;
let privateUrl: string;

/**
 * Creates the test database and a simple table in the given ClickHouse container.
 */
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

/**
 * Inserts a test row and returns the connection URL used (for verification).
 */
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

/**
 * Queries the test table for a row by id.
 */
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

/**
 * Creates a test organization, team, and project in Prisma.
 * Returns the project ID for use in routing tests.
 */
async function createTestOrgWithProject({
  namespace,
  customClickhouse,
}: {
  namespace: string;
  customClickhouse: string | null;
}): Promise<{ projectId: string; organizationId: string; teamId: string }> {
  const orgSlug = `--test-ch-routing-${namespace}-${nanoid(6)}`;
  const teamSlug = `--test-ch-team-${namespace}-${nanoid(6)}`;
  const projectSlug = `--test-ch-proj-${namespace}-${nanoid(6)}`;

  const organization = await prisma.organization.create({
    data: {
      name: `Test CH Routing Org ${namespace}`,
      slug: orgSlug,
      customClickhouse,
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

// Track created resources for cleanup
const createdProjectIds: string[] = [];
const createdTeamIds: string[] = [];
const createdOrgIds: string[] = [];

/**
 * Mock getClickHouseClient to return our shared test container client.
 * This simulates the default/env-var ClickHouse instance.
 */
vi.mock("../client", () => ({
  _getSharedClickHouseClient: () => sharedClient,
}));

describe("getClickHouseClientForProject()", () => {
  beforeAll(async () => {
    // Ensure CREDENTIALS_SECRET is set for encryption/decryption
    if (!process.env.CREDENTIALS_SECRET) {
      process.env.CREDENTIALS_SECRET =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }

    // Start two ClickHouse containers in parallel (reusable for faster subsequent runs)
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

    // Create clients for direct verification
    sharedClient = createClient({
      url: sharedUrl,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });

    privateClient = createClient({
      url: privateUrl,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });

    // Set up test schema in both containers
    await Promise.all([
      setupTestSchema(sharedClient),
      setupTestSchema(privateClient),
    ]);
  }, 300_000);

  afterAll(async () => {
    // Import and clear the custom client cache
    const { clearCustomClientCache } = await import("../clickhouseClient");
    await clearCustomClientCache();

    // Clean up Prisma data in reverse order (projects -> teams -> orgs)
    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({
        where: { id: { in: createdProjectIds } },
      });
    }
    if (createdTeamIds.length > 0) {
      await prisma.team.deleteMany({
        where: { id: { in: createdTeamIds } },
      });
    }
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
    }

    // Close ClickHouse clients
    await Promise.all([
      sharedClient?.close(),
      privateClient?.close(),
    ]);

    // Reusable containers stay running for faster subsequent test runs.
    // To stop: docker rm -f $(docker ps -q --filter "label=langwatch.test.routing")
  }, 60_000);

  describe("when org has no customClickhouse configured", () => {
    it("returns the shared (default) client", async () => {
      const { getClickHouseClientForProject } = await import(
        "../clickhouseClient"
      );

      const { projectId, organizationId, teamId } =
        await createTestOrgWithProject({
          namespace: "no-custom",
          customClickhouse: null,
        });
      createdProjectIds.push(projectId);
      createdTeamIds.push(teamId);
      createdOrgIds.push(organizationId);

      const client = await getClickHouseClientForProject(projectId);

      // The returned client should be the shared (mocked) client
      expect(client).toBe(sharedClient);

      // Verify we can insert and read from the shared container
      const rowId = `shared-${nanoid(8)}`;
      await insertTestRow(client!, {
        id: rowId,
        projectId,
        data: "shared-data",
      });

      const rows = await queryTestRow(sharedClient, rowId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data).toBe("shared-data");

      // Verify data is NOT in the private container
      const privateRows = await queryTestRow(privateClient, rowId);
      expect(privateRows).toHaveLength(0);
    });
  });

  describe("when org has customClickhouse configured", () => {
    it("returns a client connected to the private instance", async () => {
      const { getClickHouseClientForProject } = await import(
        "../clickhouseClient"
      );

      const privateConfig: CustomClickhouseConfig = {
        url: privateUrl,
        user: "default",
        password: "",
      };
      const encryptedConfig = encrypt(JSON.stringify(privateConfig));

      const { projectId, organizationId, teamId } =
        await createTestOrgWithProject({
          namespace: "with-custom",
          customClickhouse: encryptedConfig,
        });
      createdProjectIds.push(projectId);
      createdTeamIds.push(teamId);
      createdOrgIds.push(organizationId);

      const client = await getClickHouseClientForProject(projectId);

      // The returned client should NOT be the shared client
      expect(client).not.toBe(sharedClient);

      // Insert via the routed client
      const rowId = `private-${nanoid(8)}`;
      await insertTestRow(client!, {
        id: rowId,
        projectId,
        data: "private-data",
      });

      // Verify data IS in the private container
      const privateRows = await queryTestRow(privateClient, rowId);
      expect(privateRows).toHaveLength(1);
      expect(privateRows[0]!.data).toBe("private-data");

      // Verify data is NOT in the shared container
      const sharedRows = await queryTestRow(sharedClient, rowId);
      expect(sharedRows).toHaveLength(0);
    });
  });

  describe("when called twice for the same organization", () => {
    it("returns the same cached client instance", async () => {
      const { getClickHouseClientForProject, clearCustomClientCache } =
        await import("../clickhouseClient");

      // Clear cache to start fresh for this test
      await clearCustomClientCache();

      const privateConfig: CustomClickhouseConfig = {
        url: privateUrl,
        user: "default",
        password: "",
      };
      const encryptedConfig = encrypt(JSON.stringify(privateConfig));

      const { projectId, organizationId, teamId } =
        await createTestOrgWithProject({
          namespace: "cache-test",
          customClickhouse: encryptedConfig,
        });
      createdProjectIds.push(projectId);
      createdTeamIds.push(teamId);
      createdOrgIds.push(organizationId);

      const client1 = await getClickHouseClientForProject(projectId);
      const client2 = await getClickHouseClientForProject(projectId);

      // Same instance returned both times (referential equality)
      expect(client1).toBe(client2);
    });
  });

  describe("when two orgs have different customClickhouse configs", () => {
    it("returns different client instances", async () => {
      const { getClickHouseClientForProject, clearCustomClientCache } =
        await import("../clickhouseClient");

      // Clear cache to start fresh for this test
      await clearCustomClientCache();

      // Org A points to private container
      const configA: CustomClickhouseConfig = {
        url: privateUrl,
        user: "default",
        password: "",
      };
      const encryptedConfigA = encrypt(JSON.stringify(configA));

      const orgA = await createTestOrgWithProject({
        namespace: "diff-org-a",
        customClickhouse: encryptedConfigA,
      });
      createdProjectIds.push(orgA.projectId);
      createdTeamIds.push(orgA.teamId);
      createdOrgIds.push(orgA.organizationId);

      // Org B also points to private container (same URL, but different org = different client)
      const configB: CustomClickhouseConfig = {
        url: privateUrl,
        user: "default",
        password: "",
      };
      const encryptedConfigB = encrypt(JSON.stringify(configB));

      const orgB = await createTestOrgWithProject({
        namespace: "diff-org-b",
        customClickhouse: encryptedConfigB,
      });
      createdProjectIds.push(orgB.projectId);
      createdTeamIds.push(orgB.teamId);
      createdOrgIds.push(orgB.organizationId);

      const clientA = await getClickHouseClientForProject(orgA.projectId);
      const clientB = await getClickHouseClientForProject(orgB.projectId);

      // Different orgs get different client instances (even if same URL)
      expect(clientA).not.toBe(clientB);

      // Both are distinct from the shared client
      expect(clientA).not.toBe(sharedClient);
      expect(clientB).not.toBe(sharedClient);
    });
  });

  describe("when customClickhouse contains encrypted credentials", () => {
    it("decrypts and connects successfully", async () => {
      const { getClickHouseClientForProject, clearCustomClientCache } =
        await import("../clickhouseClient");

      // Clear cache to start fresh
      await clearCustomClientCache();

      const config: CustomClickhouseConfig = {
        url: privateUrl,
        user: "default",
        password: "",
      };

      // Encrypt the config (this is what gets stored in the database)
      const encryptedConfig = encrypt(JSON.stringify(config));

      // Verify the encrypted string has the expected format (iv:data:authTag)
      const parts = encryptedConfig.split(":");
      expect(parts).toHaveLength(3);

      const { projectId, organizationId, teamId } =
        await createTestOrgWithProject({
          namespace: "encrypt-test",
          customClickhouse: encryptedConfig,
        });
      createdProjectIds.push(projectId);
      createdTeamIds.push(teamId);
      createdOrgIds.push(organizationId);

      // Verify the routing function can decrypt and connect
      const client = await getClickHouseClientForProject(projectId);
      expect(client).not.toBeNull();

      // Prove the connection works by pinging the server
      const pingResult = await client!.ping();
      expect(pingResult.success).toBe(true);

      // Prove we can read/write through the decrypted connection
      const rowId = `encrypted-${nanoid(8)}`;
      await insertTestRow(client!, {
        id: rowId,
        projectId,
        data: "encrypted-credentials-work",
      });

      const rows = await queryTestRow(privateClient, rowId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data).toBe("encrypted-credentials-work");
    });
  });
});
