/**
 * `/api/v1/me/project` answers any key bound to a project with that project's identity, an
 * ingestion key holding only `traces:create` included, on the api booted wholly live (§7).
 * @vitest-environment node
 * @see modules/user/specs/user.feature
 */
import { createHash, randomBytes } from "node:crypto";

import { API_KEY_PREFIX, INGESTION_PERMISSIONS } from "@langwatch/api-key-contract";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bootLiveApi,
  liveStoresConfigured,
  openLivePrisma,
  type LiveApi,
} from "./api-live.fixture.ts";

const stores = liveStoresConfigured;

const ns = generate("test").toString().toLowerCase();

type SeededProject = { id: string; name: string; slug: string };

describe.skipIf(!stores)("given keys bound to a project", () => {
  let connection: ReturnType<typeof openLivePrisma> | null = null;
  let prisma: PrismaClient;
  let api: LiveApi;
  let organizationId: string;
  let teamId: string;
  let userId: string;
  let project: SeededProject;
  let otherProject: SeededProject;
  let legacyKey: string;
  let ingestionKey: string;
  let otherIngestionKey: string;
  let revokedKey: string;

  /** A personal key with only the ingestion permissions on one project, as the mint writes it. */
  async function seedIngestionKey({
    projectId,
    revoked = false,
  }: {
    projectId: string;
    revoked?: boolean;
  }): Promise<string> {
    const lookupId = randomBytes(8).toString("hex");
    const secret = randomBytes(24).toString("hex");
    const apiKey = await prisma.apiKey.create({
      data: {
        name: `ingestion ${ns}`,
        lookupId,
        hashedSecret: createHash("sha256").update(secret).digest("hex"),
        permissionMode: "restricted",
        userId,
        createdByUserId: userId,
        organizationId,
        ...(revoked ? { revokedAt: new Date() } : {}),
      },
    });
    const roleId = `apikey:${apiKey.id}`;
    await prisma.role.create({
      data: {
        id: roleId,
        organizationId,
        name: roleId,
        permissions: [...INGESTION_PERMISSIONS],
        kind: "system_api_key",
        occurredAt: new Date(),
      },
    });
    await prisma.grant.create({
      data: {
        id: `grant-${apiKey.id}`,
        organizationId,
        principalType: "API_KEY",
        principalId: apiKey.id,
        roleKey: `custom:${roleId}`,
        source: "grants-service",
        scopeType: "PROJECT",
        scopeId: projectId,
        occurredAt: new Date(),
      },
    });

    return `${API_KEY_PREFIX}${lookupId}_${secret}`;
  }

  async function seedProject({ label, apiKey }: { label: string; apiKey: string }) {
    return prisma.project.create({
      data: {
        name: `Project ${label}`,
        slug: `--test-project-${label}-${ns}`,
        apiKey,
        teamId,
        language: "python",
        framework: "openai",
      },
      select: { id: true, name: true, slug: true },
    });
  }

  async function readMeProject({
    token,
    headers = {},
  }: {
    token: string;
    headers?: Record<string, string>;
  }) {
    const response = await api.fetch("/api/v1/me/project", {
      headers: { Authorization: `Bearer ${token}`, ...headers },
    });

    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  beforeAll(async () => {
    connection = openLivePrisma({ label: "me-project-any-key" });
    prisma = connection.prisma;
    const organization = await prisma.organization.create({
      data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: organizationId,
        status: "finalized",
        occurredAt: new Date(),
      },
    });
    const team = await prisma.team.create({
      data: { name: "Platform", slug: `--test-team-${ns}`, organizationId },
    });
    teamId = team.id;
    const user = await prisma.user.create({
      data: { email: `ingest-${ns}@example.com`, name: "Ingest" },
    });
    userId = user.id;
    await prisma.organizationUser.create({ data: { organizationId, userId, role: "ADMIN" } });
    await prisma.grant.create({
      data: {
        id: `grant-user-${ns}`,
        organizationId,
        principalType: "USER",
        principalId: userId,
        roleKey: "admin",
        source: "grants-service",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        occurredAt: new Date(),
      },
    });
    legacyKey = `sk-lw-${randomBytes(16).toString("hex")}`;
    project = await seedProject({ label: "ingest", apiKey: legacyKey });
    otherProject = await seedProject({
      label: "other",
      apiKey: `sk-lw-${randomBytes(16).toString("hex")}`,
    });
    ingestionKey = await seedIngestionKey({ projectId: project.id });
    otherIngestionKey = await seedIngestionKey({ projectId: otherProject.id });
    revokedKey = await seedIngestionKey({ projectId: project.id, revoked: true });
    api = await bootLiveApi();
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    if (organizationId) {
      await prisma.grant.deleteMany({ where: { organizationId } });
      await prisma.role.deleteMany({ where: { organizationId } });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
      await prisma.apiKey.deleteMany({ where: { organizationId } });
      if (teamId) {
        await prisma.project.deleteMany({ where: { teamId } });
        await prisma.team.deleteMany({ where: { id: teamId } });
      }
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await connection?.close();
  });

  /** @scenario "An ingestion key reads the identity of the project it is bound to" */
  it("answers an ingestion key holding only traces:create with its project's identity", async () => {
    const { status, body } = await readMeProject({ token: ingestionKey });

    expect(status).toBe(200);
    expect(body).toEqual({
      id: project.id,
      name: project.name,
      slug: project.slug,
      isPersonal: false,
    });
  });

  /** @scenario "A legacy project key reads the identity of its project" */
  it("answers a legacy project key with its project's identity", async () => {
    const { status, body } = await readMeProject({ token: legacyKey });

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: project.id, slug: project.slug });
  });

  /** @scenario "A key cannot read the identity of a project it is not bound to" */
  it("refuses a key that names another project with 401", async () => {
    const { status, body } = await readMeProject({
      token: otherIngestionKey,
      headers: { "X-Project-Id": project.id },
    });

    expect(status).toBe(401);
    expect(JSON.stringify(body)).not.toContain(project.slug);
    expect(JSON.stringify(body)).not.toContain(project.name);
  });

  /** @scenario "A revoked key is refused the project's identity" */
  it("refuses a revoked key with 401", async () => {
    const { status, body } = await readMeProject({ token: revokedKey });

    expect(status).toBe(401);
    expect(JSON.stringify(body)).not.toContain(project.slug);
  });
});
