/**
 * The agent cache reached with the two credentials a run holds, through the door auth binds, on
 * the api booted wholly live over Postgres, Redis and ClickHouse (§7): the legacy project key
 * and the key minted for the runs of a project.
 * @vitest-environment node
 * @see specs/agent-cache/agent-cache.feature
 */
import { createHash, randomBytes } from "node:crypto";

import { API_KEY_PREFIX, AGENT_SANDBOX_PERMISSIONS } from "@langwatch/api-key-contract";
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
import { z } from "zod";

import { bootLiveApi, liveDatabaseUrl, liveStoresConfigured } from "./api-live.fixture.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const stores = liveStoresConfigured;

/** The suite's own connection, for the rows a project and its key rest on, and for cleanup. */
const connection = stores
  ? PrismaConnectionService.create({
      logger: createLogger("langwatch:test:agent-cache-credentials"),
      guard: new AllowTestQueries(),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = generate("test").toString().toLowerCase();

const wireBody = z.looseObject({
  code: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
});

describe.skipIf(!stores)("given the agent cache on the live api", () => {
  let api: Awaited<ReturnType<typeof bootLiveApi>>;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let projectKey: string;
  let runKey: string;

  /** The agent cache route, asked over HTTP the way a run's code asks it. */
  async function send({
    path,
    token,
    method = "GET",
    body,
  }: {
    path: string;
    token: string;
    method?: string;
    body?: object;
  }) {
    const response = await api.fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    return { status: response.status, answer: wireBody.parse(await response.json()) };
  }

  /** Stores an entry and reads it back, as a run does. */
  async function storeAndRead({ token, name }: { token: string; name: string }) {
    const stored = await send({
      path: `/api/agent-cache/${name}`,
      token,
      method: "PUT",
      body: { value: `value-of-${name}` },
    });
    const read = await send({ path: `/api/agent-cache/${name}`, token });

    return { stored, read };
  }

  /**
   * The rows `mintRunKey` leaves once the worker has folded the key's role and grant: the key,
   * the role holding exactly the sandbox permissions, and its grant on the project. The api
   * alone cannot land the fold, so the rows stand in for it (the mint itself has its own tests).
   */
  async function seedRunKey(): Promise<string> {
    const lookupId = randomBytes(8).toString("hex");
    const secret = randomBytes(24).toString("hex");
    const apiKey = await prisma.apiKey.create({
      data: {
        name: `run ${ns}`,
        lookupId,
        hashedSecret: createHash("sha256").update(secret).digest("hex"),
        permissionMode: "restricted",
        userId: null,
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
        permissions: [...AGENT_SANDBOX_PERMISSIONS],
        kind: "system_api_key",
        occurredAt: new Date(),
      },
    });
    await prisma.grant.create({
      data: {
        id: `grant-run-key-${ns}`,
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
    projectKey = `--test-key-${randomBytes(8).toString("hex")}-${ns}`;
    const project = await prisma.project.create({
      data: {
        name: "runs",
        slug: `--test-project-${ns}`,
        apiKey: projectKey,
        teamId,
        language: "python",
        framework: "openai",
      },
    });
    projectId = project.id;
    api = await bootLiveApi();
    runKey = await seedRunKey();
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    if (organizationId) {
      await prisma.grant.deleteMany({ where: { organizationId } });
      await prisma.role.deleteMany({ where: { organizationId } });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
      await prisma.apiKey.deleteMany({ where: { organizationId } });
      await prisma.project.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await connection?.closeOnce();
  });

  describe("when the caller carries the legacy project key", () => {
    /** @scenario "A legacy project key reaches the agent cache" */
    it("stores an entry and reads it back", async () => {
      const { stored, read } = await storeAndRead({ token: projectKey, name: "LEGACY_SESSION" });

      expect(stored.status).toBe(200);
      expect(read).toMatchObject({
        status: 200,
        answer: { name: "LEGACY_SESSION", value: "value-of-LEGACY_SESSION" },
      });
    });
  });

  describe("when the caller carries the key minted for the runs of the project", () => {
    /** @scenario "The sandbox key reaches the agent cache" */
    it("stores an entry and reads it back", async () => {
      const { stored, read } = await storeAndRead({ token: runKey, name: "SANDBOX_SESSION" });

      expect(stored.status).toBe(200);
      expect(read).toMatchObject({
        status: 200,
        answer: { name: "SANDBOX_SESSION", value: "value-of-SANDBOX_SESSION" },
      });
    });

    /** @scenario "The sandbox key reaches nothing else" */
    it("is refused as forbidden on another route of the same project", async () => {
      const refused = await send({
        path: "/api/gateway/v1/virtual-keys",
        token: runKey,
      });

      expect(refused).toMatchObject({ status: 403, answer: { code: "permission_denied" } });
    });
  });
});
