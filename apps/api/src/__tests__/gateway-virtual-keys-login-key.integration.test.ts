/**
 * The virtual key routes, asked with the organization key `langwatch login` mints, through the
 * door auth binds, on the api booted wholly live over Postgres, Redis and ClickHouse (§7).
 * @vitest-environment node
 * @see specs/ai-gateway/public-rest-api.feature
 * @see specs/security/api-endpoint-authorization.feature
 */
import { createHash, randomBytes } from "node:crypto";

import { API_KEY_PREFIX } from "@langwatch/api-key-contract";
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

/** The suite's own connection, for the rows a device login leaves and for cleanup. */
const connection = stores
  ? PrismaConnectionService.create({
      logger: createLogger("langwatch:test:virtual-keys-login-key"),
      guard: new AllowTestQueries(),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = generate("test").toString().toLowerCase();

const wireBody = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  data: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  virtual_key: z.object({ id: z.string() }).optional(),
  virtual_key_id: z.string().optional(),
  spent_usd: z.string().optional(),
  requests: z.number().optional(),
});

/** The live api, asked over HTTP the way the CLI asks the gateway routes. */
async function bootInstallation() {
  const api = await bootLiveApi();

  return {
    stop: () => api.close(),
    send: async ({
      path,
      token,
      projectId,
      method = "GET",
      body,
    }: {
      path: string;
      token: string;
      projectId?: string;
      method?: string;
      body?: object;
    }) => {
      const response = await api.fetch(`/api/gateway/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(projectId ? { "X-Project-Id": projectId } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      return { status: response.status, answer: wireBody.parse(await response.json()) };
    },
  };
}

describe.skipIf(!stores)("given the organization key a CLI login holds", () => {
  let installation: Awaited<ReturnType<typeof bootInstallation>>;
  let organizationId: string;
  let userId: string;
  let teamId: string;
  let personalProjectId: string;
  let otherProjectId: string;
  let otherTeamId: string;
  let billingProjectId: string;
  let loginKey: string;
  let teamKey: string;
  let emptyKey: string;
  let virtualKeyId: string;
  let checkoutKeyId: string;
  let billingKeyId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Ada", email: `ada-${ns}@example.com` },
    });
    userId = user.id;
    const organization = await prisma.organization.create({
      data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    await prisma.organizationUser.create({ data: { userId, organizationId, role: "ADMIN" } });
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: organizationId,
        status: "finalized",
        occurredAt: new Date(),
      },
    });
    await prisma.grant.create({
      data: {
        id: `grant-admin-${ns}`,
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
    const team = await prisma.team.create({
      data: { name: "Platform", slug: `--test-team-${ns}`, organizationId },
    });
    teamId = team.id;
    await prisma.teamUser.create({ data: { userId, teamId, role: "ADMIN" } });
    const otherTeam = await prisma.team.create({
      data: { name: "Payments", slug: `--test-team-payments-${ns}`, organizationId },
    });
    otherTeamId = otherTeam.id;
    const project = async (name: string, inTeamId = teamId) =>
      (
        await prisma.project.create({
          data: {
            name,
            slug: `--test-project-${name}-${ns}`,
            apiKey: `--test-key-${name}-${ns}`,
            teamId: inTeamId,
            language: "python",
            framework: "openai",
          },
        })
      ).id;
    personalProjectId = await project("personal");
    otherProjectId = await project("checkout");
    billingProjectId = await project("billing", otherTeamId);

    installation = await bootInstallation();

    // The rows a device login leaves once the worker has folded the key's grant.
    const seedKey = async ({
      name,
      scopeType,
      scopeId,
      roleKey = "admin",
    }: {
      name: string;
      scopeType: "ORGANIZATION" | "TEAM";
      scopeId: string;
      roleKey?: string;
    }) => {
      const lookupId = randomBytes(8).toString("hex");
      const secret = randomBytes(24).toString("hex");
      const apiKey = await prisma.apiKey.create({
        data: {
          name: `${name} ${ns}`,
          lookupId,
          hashedSecret: createHash("sha256").update(secret).digest("hex"),
          permissionMode: "all",
          userId,
          createdByUserId: userId,
          organizationId,
        },
      });
      await prisma.grant.create({
        data: {
          id: `grant-key-${name}-${ns}`,
          organizationId,
          principalType: "API_KEY",
          principalId: apiKey.id,
          roleKey,
          source: "grants-service",
          scopeType,
          scopeId,
          occurredAt: new Date(),
        },
      });

      return `${API_KEY_PREFIX}${lookupId}_${secret}`;
    };
    loginKey = await seedKey({ name: "login", scopeType: "ORGANIZATION", scopeId: organizationId });
    teamKey = await seedKey({ name: "team", scopeType: "TEAM", scopeId: teamId });
    // A role no catalogue names gives its key no permission at all.
    emptyKey = await seedKey({
      name: "empty",
      scopeType: "TEAM",
      scopeId: teamId,
      roleKey: `--test-role-without-permissions-${ns}`,
    });

    const createIn = async (projectId: string) => {
      const created = await installation.send({
        path: "/virtual-keys",
        method: "POST",
        token: loginKey,
        projectId,
        body: { name: `login-key-${projectId}` },
      });
      if (!created.answer.virtual_key) {
        throw new Error(`the virtual key was not created: ${JSON.stringify(created)}`);
      }

      return created.answer.virtual_key.id;
    };
    virtualKeyId = await createIn(personalProjectId);
    checkoutKeyId = await createIn(otherProjectId);
    billingKeyId = await createIn(billingProjectId);
  }, 240_000);

  afterAll(async () => {
    await installation?.stop();
    if (organizationId) {
      await prisma.virtualKeyScope.deleteMany({ where: { virtualKey: { organizationId } } });
      await prisma.virtualKey.deleteMany({ where: { organizationId } });
      await prisma.grant.deleteMany({ where: { organizationId } });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
      await prisma.apiKey.deleteMany({ where: { organizationId } });
      await prisma.project.deleteMany({ where: { teamId: { in: [teamId, otherTeamId] } } });
      await prisma.teamUser.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: { in: [teamId, otherTeamId] } } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await connection?.closeOnce();
  });

  describe("when it names no project", () => {
    /** @scenario "A login key that names no project lists every virtual key it can see" */
    it("lists the keys of every project and reads one key and its spend", async () => {
      const listed = await installation.send({ path: "/virtual-keys", token: loginKey });
      const read = await installation.send({
        path: `/virtual-keys/${billingKeyId}`,
        token: loginKey,
      });
      const spend = await installation.send({
        path: `/virtual-keys/${billingKeyId}/spend`,
        token: loginKey,
      });

      expect(listed.status).toBe(200);
      expect(listed.answer.data?.map((key) => key.id).toSorted()).toEqual(
        [virtualKeyId, checkoutKeyId, billingKeyId].toSorted(),
      );
      expect(read).toMatchObject({ status: 200, answer: { virtual_key: { id: billingKeyId } } });
      expect(spend).toMatchObject({
        status: 200,
        answer: { virtual_key_id: billingKeyId, requests: 0 },
      });
    });

    /** @scenario "A key that names no project manages a virtual key by its scopes" */
    it("creates, disables, enables and revokes a key by the scopes it names", async () => {
      const created = await installation.send({
        path: "/virtual-keys",
        method: "POST",
        token: loginKey,
        body: {
          name: `scoped-${ns}`,
          scopes: [{ scope_type: "project", scope_id: otherProjectId }],
        },
      });
      const id = created.answer.virtual_key?.id;
      const statuses: number[] = [];
      for (const step of ["disable", "enable", "revoke"]) {
        const answered = await installation.send({
          path: `/virtual-keys/${id}/${step}`,
          method: "POST",
          token: loginKey,
          body: {},
        });
        statuses.push(answered.status);
      }
      const unscoped = await installation.send({
        path: "/virtual-keys",
        method: "POST",
        token: loginKey,
        body: { name: `unscoped-${ns}` },
      });

      expect(created.status).toBe(201);
      expect(statuses).toEqual([200, 200, 200]);
      expect(unscoped).toMatchObject({ status: 422, answer: { code: "validation_error" } });
    });

    it("still tells a project route to name its project", async () => {
      const refused = await installation.send({ path: "/cache-rules", token: loginKey });

      expect(refused).toMatchObject({ status: 400, answer: { code: "project_required" } });
    });
  });

  describe("when it names the project it acts on", () => {
    /** @scenario "A login key narrows the listing to the project it names" */
    it("lists that project's virtual keys only and reads one key's spend", async () => {
      const listed = await installation.send({
        path: "/virtual-keys",
        token: loginKey,
        projectId: personalProjectId,
      });
      const spend = await installation.send({
        path: `/virtual-keys/${virtualKeyId}/spend`,
        token: loginKey,
        projectId: personalProjectId,
      });

      expect(listed.status).toBe(200);
      expect(listed.answer.data?.map((key) => key.id)).toEqual([virtualKeyId]);
      expect(spend).toMatchObject({
        status: 200,
        answer: { virtual_key_id: virtualKeyId, requests: 0 },
      });
    });

    it("does not read a sibling project's key by id", async () => {
      const read = await installation.send({
        path: `/virtual-keys/${checkoutKeyId}`,
        token: loginKey,
        projectId: personalProjectId,
      });

      expect(read).toMatchObject({ status: 404, answer: { code: "virtual_key_not_found" } });
    });
  });

  describe("given a key granted on one team only, naming no project", () => {
    /** @scenario "A key that names no project sees only the virtual keys its grants reach" */
    it("lists its team's keys and answers another team's key as not found", async () => {
      const listed = await installation.send({ path: "/virtual-keys", token: teamKey });
      const read = await installation.send({
        path: `/virtual-keys/${billingKeyId}`,
        token: teamKey,
      });

      expect(listed.status).toBe(200);
      expect(listed.answer.data?.map((key) => key.id)).not.toContain(billingKeyId);
      expect(listed.answer.data?.map((key) => key.id)).toEqual(
        expect.arrayContaining([virtualKeyId, checkoutKeyId]),
      );
      expect(read).toMatchObject({ status: 404, answer: { code: "virtual_key_not_found" } });
    });
  });

  describe("given a key whose grants hold no virtual key permission, naming no project", () => {
    /** @scenario "A key that holds a virtual key permission on none of its grants is refused" */
    it("is refused before any virtual key is read", async () => {
      const listed = await installation.send({ path: "/virtual-keys", token: emptyKey });
      const read = await installation.send({
        path: `/virtual-keys/${virtualKeyId}`,
        token: emptyKey,
      });

      expect(listed).toMatchObject({ status: 403, answer: { code: "permission_denied" } });
      expect(read).toMatchObject({ status: 403, answer: { code: "permission_denied" } });
    });
  });

  describe("when the token stands for no key at all", () => {
    it("is still refused as an invalid credential", async () => {
      const refused = await installation.send({
        path: "/virtual-keys",
        token: `${loginKey.slice(0, -4)}0000`,
      });

      expect(refused).toMatchObject({ status: 401, answer: { code: "invalid_credentials" } });
    });
  });
});
