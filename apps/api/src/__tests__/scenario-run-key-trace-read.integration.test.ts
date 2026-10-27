/**
 * The judge of a scenario run reads the agent's traces back with the key minted for the run, on
 * the api booted wholly live over Postgres, Redis and ClickHouse (§7).
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-execution.feature
 */
import { createHash, randomBytes } from "node:crypto";

import { API_KEY_PREFIX, WORKFLOW_RUN_API_KEY_NAME } from "@langwatch/api-key-contract";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bootLiveApi,
  liveDatabaseUrl,
  liveStoresConfigured,
  removeSeededTraces,
  seedTraceSummary,
} from "./api-live.fixture.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const stores = liveStoresConfigured;

const connection = stores
  ? PrismaConnectionService.create({
      logger: createLogger("langwatch:test:scenario-run-key-trace-read"),
      guard: new AllowTestQueries(),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = generate("test").toString().toLowerCase();

const TRACE_ID = `trace-${ns}`;

const RUN_KEY_PERMISSIONS = ["traces:create", "traces:view", "scenarios:create"];

describe.skipIf(!stores)("given a scenario run started with a service key", () => {
  let api: Awaited<ReturnType<typeof bootLiveApi>>;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let serviceKey: { id: string; token: string };
  let runKey: string;
  let unattendedRunKey: string;

  /** A restricted key granted `permissions` on the project, as the worker folds it. */
  async function seedKey({
    name,
    permissions,
    parentApiKeyId = null,
    isSystemManaged = false,
  }: {
    name: string;
    permissions: string[];
    parentApiKeyId?: string | null;
    isSystemManaged?: boolean;
  }): Promise<{ id: string; token: string }> {
    const lookupId = randomBytes(8).toString("hex");
    const secret = randomBytes(24).toString("hex");
    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        lookupId,
        hashedSecret: createHash("sha256").update(secret).digest("hex"),
        permissionMode: "restricted",
        userId: null,
        parentApiKeyId,
        isSystemManaged,
        organizationId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const roleId = `apikey:${apiKey.id}`;
    await prisma.role.create({
      data: {
        id: roleId,
        organizationId,
        name: roleId,
        permissions,
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

    return { id: apiKey.id, token: `${API_KEY_PREFIX}${lookupId}_${secret}` };
  }

  /** The judge's trace read: both headers, as the scenario SDK sends them. */
  async function readTrace({ token, path }: { token: string; path: string }) {
    const response = await api.fetch(path, {
      headers: {
        "X-Auth-Token": token,
        Authorization: `Bearer ${token}`,
        "X-Project-Id": projectId,
      },
    });

    return { status: response.status, body: await response.text() };
  }

  beforeAll(async () => {
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
    const project = await prisma.project.create({
      data: {
        name: "runs",
        slug: `--test-project-${ns}`,
        apiKey: `--test-key-${randomBytes(8).toString("hex")}-${ns}`,
        teamId,
        language: "python",
        framework: "openai",
      },
    });
    projectId = project.id;
    await seedTraceSummary({ tenantId: projectId, traceId: TRACE_ID });
    serviceKey = await seedKey({ name: `service ${ns}`, permissions: RUN_KEY_PERMISSIONS });
    runKey = (
      await seedKey({
        name: WORKFLOW_RUN_API_KEY_NAME,
        permissions: RUN_KEY_PERMISSIONS,
        parentApiKeyId: serviceKey.id,
        isSystemManaged: true,
      })
    ).token;
    unattendedRunKey = (
      await seedKey({
        name: WORKFLOW_RUN_API_KEY_NAME,
        permissions: RUN_KEY_PERMISSIONS,
        isSystemManaged: true,
      })
    ).token;
    api = await bootLiveApi();
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    if (projectId) await removeSeededTraces({ tenantIds: [projectId] });
    if (organizationId) {
      await prisma.grant.deleteMany({ where: { organizationId } });
      await prisma.role.deleteMany({ where: { organizationId } });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
      // Children first: a run key holds its parent by a foreign key.
      await prisma.apiKey.deleteMany({ where: { organizationId, parentApiKeyId: { not: null } } });
      await prisma.apiKey.deleteMany({ where: { organizationId } });
      if (teamId) {
        await prisma.project.deleteMany({ where: { teamId } });
        await prisma.team.deleteMany({ where: { id: teamId } });
      }
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await connection?.closeOnce();
  });

  describe("when the run's key was minted under the service key", () => {
    /** @scenario "A run started with a service key reads its own project's traces" */
    it.each([
      ["the legacy single-trace read", () => `/api/trace/${TRACE_ID}`],
      ["the v1 trace read", () => `/api/traces/${TRACE_ID}`],
    ])("reads the trace on %s", async (_, path) => {
      const read = await readTrace({ token: runKey, path: path() });

      expect(read.status, read.body).toBe(200);
      expect(read.body).toContain(TRACE_ID);
    });
  });

  describe("when the run's key names neither a person nor a starting key", () => {
    it("is refused with permission_denied", async () => {
      const read = await readTrace({ token: unattendedRunKey, path: `/api/trace/${TRACE_ID}` });

      expect(read.status).toBe(403);
      expect(read.body).toContain("permission_denied");
    });
  });
});
