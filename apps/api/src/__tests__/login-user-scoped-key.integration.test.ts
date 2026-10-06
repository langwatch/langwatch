/**
 * The key `langwatch login` mints for the approving user, through the device flow's own routes and
 * then through the routes it opens, on the api and the worker booted wholly live (§7).
 * @vitest-environment node
 * @see specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
import { defaultCliKeyPermissions } from "@langwatch/api-key-contract";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { RedisConnectionService, type RedisConnection } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  bootLiveApi,
  liveStoresConfigured,
  openLivePrisma,
  removeSignedUpRows,
  seedProject,
  signUpSession,
  type LiveApi,
  type LiveSession,
} from "./api-live.fixture.ts";

const stores = liveStoresConfigured;

const exchangeSchema = z.object({
  kind: z.string(),
  cli_api_key: z.string(),
  cli_api_key_scope: z.object({
    kind: z.string(),
    project_ids: z.array(z.string()),
    permissions: z.array(z.string()),
  }),
  personal_project: z.object({ id: z.string(), slug: z.string(), name: z.string() }).strict(),
});

const projectListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
  pagination: z.object({}).passthrough(),
});

describe.skipIf(!stores)("given a person who signs in with langwatch login", () => {
  let api: LiveApi;
  let prisma: PrismaClient;
  let closePrisma: () => Promise<void>;
  let redis: RedisConnection;
  let organizationId: string;
  let teamId: string;
  let otherTeamId: string;
  let projectId: string;
  let otherProjectId: string;
  let owner: LiveSession;
  let demoted: LiveSession;
  let narrowed: LiveSession;

  const ns = Date.now().toString(36);

  async function grantAdmin({
    userId,
    scopeType,
    scopeId,
  }: {
    userId: string;
    scopeType: "ORGANIZATION" | "TEAM";
    scopeId: string;
  }) {
    await prisma.grant.create({
      data: {
        id: `grant-${scopeType}-${userId}-${ns}`,
        organizationId,
        principalType: "USER",
        principalId: userId,
        roleKey: "admin",
        source: "grants-service",
        scopeType,
        scopeId,
        occurredAt: new Date(),
      },
    });
  }

  /** The whole device login a browser and a terminal make together, as `person`. */
  async function login({ person, hostname }: { person: LiveSession; hostname: string }) {
    const json = { "content-type": "application/json" };
    const started = await api.fetch("/api/auth/cli/device-code", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ credential_type: "device_session" }),
    });
    const grant = z
      .object({ device_code: z.string(), user_code: z.string() })
      .parse(await started.json());
    const approved = await api.fetch("/api/auth/cli/approve", {
      method: "POST",
      headers: { ...person.headers, ...json },
      body: JSON.stringify({ user_code: grant.user_code, organization_id: organizationId }),
    });
    if (approved.status !== 200) throw new Error(`approve answered ${approved.status}`);
    const exchanged = await api.fetch("/api/auth/cli/exchange", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        device_code: grant.device_code,
        client_info: { hostname, platform: "linux" },
      }),
    });
    const body: unknown = await exchanged.json();
    if (exchanged.status !== 200) {
      throw new Error(`exchange answered ${exchanged.status}: ${JSON.stringify(body)}`);
    }
    const session = exchangeSchema.parse(body);
    const key = await prisma.apiKey.findFirstOrThrow({
      where: { organizationId, userId: person.userId, createdByDeviceLabel: hostname },
    });
    // The key's own grant is the worker's fold: the routes it opens answer once it landed.
    await waitFor(async () =>
      Boolean(await prisma.grant.findFirst({ where: { organizationId, principalId: key.id } })),
    );

    return { session, key };
  }

  /**
   * Takes every grant the person held, as the fold does when a grant is revoked: the rows go and
   * the organization's epoch moves, which is what retires the grants a running api has cached.
   */
  async function revokeGrants({ person }: { person: LiveSession }) {
    await prisma.grant.deleteMany({
      where: { organizationId, principalType: "USER", principalId: person.userId },
    });
    await prisma.organizationUser.updateMany({
      where: { organizationId, userId: person.userId },
      data: { role: "MEMBER" },
    });
    await redis.incr(`authz:epoch:${organizationId}`);
  }

  /** The permission list the key's custom role grants, read from the rows the mint left. */
  async function permissionsOf({ apiKeyId }: { apiKeyId: string }): Promise<string[]> {
    const grants = await prisma.grant.findMany({
      where: { organizationId, principalId: apiKeyId },
    });
    const roles = await prisma.customRole.findMany({
      where: {
        organizationId,
        id: { in: grants.flatMap((grant) => grant.roleKey?.replace(/^custom:/, "") ?? []) },
      },
    });

    return [
      ...new Set(roles.flatMap((role) => z.array(z.string()).parse(role.permissions))),
    ].toSorted();
  }

  const listProjects = async (cliKey: string) => {
    const response = await api.fetch("/api/projects", {
      headers: { Authorization: `Bearer ${cliKey}` },
    });

    return { status: response.status, body: await response.json() };
  };

  beforeAll(async () => {
    ({ prisma, close: closePrisma } = openLivePrisma({ label: "login-user-scoped-key" }));
    api = await bootLiveApi({ withWorker: true });
    redis = new RedisConnectionService().connect({
      url: process.env.LANGWATCH_TEST_REDIS_URL,
      clusterEndpoints: undefined,
      dbIndex: process.env.REDIS_DB_INDEX ? Number(process.env.REDIS_DB_INDEX) : undefined,
    })!;
    [owner, demoted, narrowed] = (await Promise.all(
      ["owner", "demoted", "narrowed"].map((label) => signUpSession({ api, label })),
    )) as [LiveSession, LiveSession, LiveSession];

    const organization = await prisma.organization.create({
      data: { name: `Login keys ${ns}`, slug: `--test-org-login-keys-${ns}` },
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
    const otherTeam = await prisma.team.create({
      data: { name: "Payments", slug: `--test-team-payments-${ns}`, organizationId },
    });
    teamId = team.id;
    otherTeamId = otherTeam.id;
    projectId = (await seedProject({ prisma, teamId, label: "platform" })).id;
    otherProjectId = (await seedProject({ prisma, teamId: otherTeamId, label: "payments" })).id;

    for (const person of [owner, demoted, narrowed]) {
      await prisma.organizationUser.create({
        data: { userId: person.userId, organizationId, role: "ADMIN" },
      });
      await grantAdmin({
        userId: person.userId,
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      });
    }
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    if (organizationId) {
      await prisma.roleBinding.deleteMany({ where: { organizationId } });
      await prisma.apiKey.deleteMany({ where: { organizationId } });
      await prisma.customRole.deleteMany({ where: { organizationId } });
      await prisma.teamUser.deleteMany({ where: { team: { organizationId } } });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
      await removeSignedUpRows({
        prisma,
        userIds: [owner, demoted, narrowed].map((person) => person.userId),
        organizationIds: [organizationId],
      });
    }
    await redis?.quit();
    await closePrisma?.();
  });

  describe("when the CLI exchanges an approved device code", () => {
    /** @scenario "exchange returns a user-owned scoped key" */
    it("answers a restricted key the person owns, and the personal project without its key", async () => {
      const { session, key } = await login({ person: owner, hostname: `owner-${ns}` });

      expect(session.kind).toBe("device_session");
      expect(session.cli_api_key).toMatch(/^sk-lw-[A-Za-z0-9]+_[A-Za-z0-9]+$/);
      expect(key).toMatchObject({ userId: owner.userId, permissionMode: "restricted" });
      expect(await permissionsOf({ apiKeyId: key.id })).toEqual(
        defaultCliKeyPermissions().toSorted(),
      );
      expect(session.cli_api_key_scope.permissions).toEqual(defaultCliKeyPermissions().toSorted());
      expect(session.personal_project).toEqual({
        id: expect.any(String),
        slug: expect.any(String),
        name: expect.any(String),
      });
    });
  });

  describe("when the owner is demoted after the key was minted", () => {
    /** @scenario "the key can never exceed the owner's live permissions" */
    it("refuses a trace search on a project the owner can no longer view", async () => {
      const { session } = await login({ person: demoted, hostname: `demoted-${ns}` });
      const search = () =>
        api.fetch("/api/traces/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.cli_api_key}`,
            "X-Project-Id": otherProjectId,
            "content-type": "application/json",
          },
          body: JSON.stringify({ startDate: Date.now() - 86_400_000, endDate: Date.now() }),
        });

      const before = await search();
      await revokeGrants({ person: demoted });
      const after = await search();

      expect(before.status).toBe(200);
      expect(after.status).toBe(403);
    });
  });

  describe("when the owner loses access to one team after the key was minted", () => {
    /** @scenario "the filtered list respects the owner's ceiling" */
    it("lists the projects of the team the owner still holds and not the other's", async () => {
      const { session } = await login({ person: narrowed, hostname: `narrowed-${ns}` });

      const before = await listProjects(session.cli_api_key);
      await revokeGrants({ person: narrowed });
      await grantAdmin({ userId: narrowed.userId, scopeType: "TEAM", scopeId: teamId });
      await redis.incr(`authz:epoch:${organizationId}`);
      const after = await listProjects(session.cli_api_key);

      const idsBefore = projectListSchema.parse(before.body).data.map((project) => project.id);
      expect(before.status).toBe(200);
      expect(idsBefore).toEqual(expect.arrayContaining([projectId, otherProjectId]));
      expect(after.status).toBe(200);
      const idsAfter = projectListSchema.parse(after.body).data.map((project) => project.id);
      expect(idsAfter).toContain(projectId);
      expect(idsAfter).not.toContain(otherProjectId);
    });
  });
});

/** Polls `condition` until it holds, so a fold the worker makes is awaited rather than slept on. */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`the condition did not hold within ${timeoutMs} ms`);
}
