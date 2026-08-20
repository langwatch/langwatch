/**
 * @vitest-environment node
 *
 * Integration tests for per-organization ClickHouse client routing.
 * Uses two isolated ClickHouse endpoints to verify that data is routed
 * to the correct endpoint based on env var configuration. An endpoint is a
 * database on the local server natively, and a container in CI; either way a
 * client built for one cannot read the other's rows, which is the property
 * these tests turn on.
 *
 * Env var format: CLICKHOUSE_URL__<label>__<orgId>=<connectionUrl>
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "~/server/db";
import {
  privateRouteOrgId,
  startTestClickHouseEndpoints,
} from "~/test-utils/clickhouseTestEndpoints";

const TEST_TABLE = "routing_test";

let sharedClient: ClickHouseClient;
let privateClient: ClickHouseClient;

// The org IDs we'll use — set the env var BEFORE importing clickhouseClient
const PRIVATE_ORG_ID = privateRouteOrgId("test-private-org");
const SHARED_ORG_ID = privateRouteOrgId("test-shared-org");
// An organization that owns no project, because it is the tenant itself: the
// grants ledger's aggregate is one organization (ADR-092 §13).
const PRIVATE_ORG_ID_WITHOUT_PROJECTS = privateRouteOrgId(
  "test-private-org-tenant",
);

// Table names stay unqualified throughout: each endpoint's client carries its
// own database in the connection URL, and that is precisely the separation
// under test: a query can only ever reach the database its client was built
// for.
async function setupTestSchema(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
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
    table: TEST_TABLE,
    values: [{ id, project_id: projectId, data }],
    format: "JSONEachRow",
  });
}

// project_id leads the predicate even though the row id is already unique per
// run: the tenant column is what every read of a real table is scoped by, and a
// fixture is the first thing someone copies when writing the next one.
async function queryTestRow(
  client: ClickHouseClient,
  { id, projectId }: { id: string; projectId: string },
): Promise<{ id: string; project_id: string; data: string }[]> {
  const result = await client.query({
    query: `SELECT * FROM ${TEST_TABLE} WHERE project_id = {projectId:String} AND id = {id:String}`,
    query_params: { projectId, id },
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
    const [shared, private_] = await startTestClickHouseEndpoints({
      suite: "ch-routing",
      names: ["shared", "private"],
    });

    const sharedUrl = shared!.url;
    const privateUrl = private_!.url;

    // Set the private CH env var BEFORE importing clickhouseClient
    process.env[`CLICKHOUSE_URL__testcustomer__${PRIVATE_ORG_ID}`] = privateUrl;
    process.env[
      `CLICKHOUSE_URL__grantsledger__${PRIVATE_ORG_ID_WITHOUT_PROJECTS}`
    ] = privateUrl;

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
    const { clearCustomClientCache, clearTenantOrgCache } = await import(
      "../clickhouseClient"
    );
    await clearCustomClientCache();
    clearTenantOrgCache();

    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({
        where: { id: { in: createdProjectIds } },
      });
    }
    if (createdTeamIds.length > 0) {
      await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    }
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
    }

    await Promise.all([sharedClient?.close(), privateClient?.close()]);

    // Clean up env var
    delete process.env[`CLICKHOUSE_URL__testcustomer__${PRIVATE_ORG_ID}`];
    delete process.env[
      `CLICKHOUSE_URL__grantsledger__${PRIVATE_ORG_ID_WITHOUT_PROJECTS}`
    ];
  }, 60_000);

  describe("when org has no private ClickHouse env var", () => {
    /** @scenario No private ClickHouse env vars results in empty map */
    /** @scenario Org without private ClickHouse gets the shared client */
    /** @scenario Project in a standard org routes to the shared instance */
    /** @scenario Data written for a standard org does not appear in private */
    it("returns the shared (default) client", async () => {
      const { getClickHouseClientForTenant } = await import(
        "../clickhouseClient"
      );

      const { projectId, organizationId, teamId } =
        await createTestOrgWithProject({
          namespace: "no-custom",
          organizationId: SHARED_ORG_ID,
        });
      createdProjectIds.push(projectId);
      createdTeamIds.push(teamId);
      createdOrgIds.push(organizationId);

      const client = await getClickHouseClientForTenant(projectId);
      expect(client).toBe(sharedClient);

      const rowId = `shared-${nanoid(8)}`;
      await insertTestRow(client!, {
        id: rowId,
        projectId,
        data: "shared-data",
      });

      const rows = await queryTestRow(sharedClient, { id: rowId, projectId });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data).toBe("shared-data");

      const privateRows = await queryTestRow(privateClient, {
        id: rowId,
        projectId,
      });
      expect(privateRows).toHaveLength(0);
    });
  });

  describe("when org has a private ClickHouse env var configured", () => {
    /** @scenario Parse private ClickHouse URL from env var */
    /** @scenario Multiple private ClickHouse env vars are parsed */
    /** @scenario Org with private ClickHouse gets a dedicated client */
    /** @scenario Project in a private-CH org routes to the private instance */
    /** @scenario Data written for a private-CH org does not appear in shared */
    it("returns a client connected to the private instance", async () => {
      const { getClickHouseClientForTenant } = await import(
        "../clickhouseClient"
      );

      const { projectId, organizationId, teamId } =
        await createTestOrgWithProject({
          namespace: "with-private",
          organizationId: PRIVATE_ORG_ID,
        });
      createdProjectIds.push(projectId);
      createdTeamIds.push(teamId);
      createdOrgIds.push(organizationId);

      const client = await getClickHouseClientForTenant(projectId);
      expect(client).not.toBe(sharedClient);

      const rowId = `private-${nanoid(8)}`;
      await insertTestRow(client!, {
        id: rowId,
        projectId,
        data: "private-data",
      });

      const privateRows = await queryTestRow(privateClient, {
        id: rowId,
        projectId,
      });
      expect(privateRows).toHaveLength(1);
      expect(privateRows[0]!.data).toBe("private-data");

      const sharedRows = await queryTestRow(sharedClient, {
        id: rowId,
        projectId,
      });
      expect(sharedRows).toHaveLength(0);
    });
  });

  describe("when the tenant is an organization rather than a project", () => {
    /** @scenario An organization is a tenant in its own right */
    it("routes by that organization, with no project of that id", async () => {
      const { getClickHouseClientForTenant } = await import(
        "../clickhouseClient"
      );

      // The grants ledger's aggregate is an organization, so this is the id
      // its event-store writes arrive with — no project carries it, and the
      // resolver used to refuse it and park the tenant.
      const privateOrganization = await prisma.organization.create({
        data: {
          id: PRIVATE_ORG_ID_WITHOUT_PROJECTS,
          name: "Test CH Routing Org grants-ledger",
          slug: `--test-ch-routing-orgtenant-${nanoid(6)}`,
        },
      });
      createdOrgIds.push(privateOrganization.id);

      const client = await getClickHouseClientForTenant(privateOrganization.id);
      expect(client).not.toBeNull();

      const rowId = `org-tenant-${nanoid(8)}`;
      await insertTestRow(client!, {
        id: rowId,
        projectId: privateOrganization.id,
        data: "org-tenant-data",
      });

      const privateRows = await queryTestRow(privateClient, {
        id: rowId,
        projectId: privateOrganization.id,
      });
      expect(privateRows).toHaveLength(1);

      const sharedRows = await queryTestRow(sharedClient, {
        id: rowId,
        projectId: privateOrganization.id,
      });
      expect(sharedRows).toHaveLength(0);
    });
  });

  describe("when the tenant names neither a project nor an organization", () => {
    /** @scenario A tenant that names neither a project nor an organization is refused */
    it("refuses rather than falling back to the shared client", async () => {
      const { getClickHouseClientForTenant } = await import(
        "../clickhouseClient"
      );

      const strangerId = `not-a-tenant-${nanoid(8)}`;

      await expect(getClickHouseClientForTenant(strangerId)).rejects.toThrow(
        strangerId,
      );
    });
  });

  describe("when called twice for the same organization", () => {
    /** @scenario Private clients are cached per organization */
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
      const { getClickHouseClientForOrganization } = await import(
        "../clickhouseClient"
      );

      const client = await getClickHouseClientForOrganization(PRIVATE_ORG_ID);
      expect(client).not.toBeNull();

      const pingResult = await client!.ping();
      expect(pingResult.success).toBe(true);
    });
  });

  describe("when getAllClickHouseInstances is called", () => {
    /** @scenario getAllClickHouseInstances returns shared and all private instances */
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
