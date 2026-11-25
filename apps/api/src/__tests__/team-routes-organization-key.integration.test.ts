/**
 * The teams REST family through the real organization door: an organization key is answered
 * on every route that names a team, at the team it names (§7, finding H4, live api).
 * @vitest-environment node
 * @see specs/teams/teams-rest-api.feature
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

const connection = stores
  ? PrismaConnectionService.create({
      logger: createLogger("langwatch:test:team-routes-organization-key"),
      guard: new AllowTestQueries(),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = generate("test").toString().toLowerCase();

const refusal = z.looseObject({ code: z.string().optional() });

describe.skipIf(!stores)("given an organization key on the live api", () => {
  let api: Awaited<ReturnType<typeof bootLiveApi>>;
  let userId: string;
  let outsiderId: string;
  let organizationId: string;
  let teamId: string;
  let otherTeamId: string;
  let foreignOrganizationId: string;
  let foreignTeamId: string;
  let key: string;
  let teamOnlyKey: string;

  const ask = async ({
    path,
    method = "GET",
    body,
    as = key,
  }: {
    path: string;
    method?: string;
    body?: unknown;
    as?: string;
  }) => {
    const response = await api.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${as}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const parsed = text ? refusal.safeParse(JSON.parse(text)) : null;

    return { status: response.status, code: parsed?.success ? parsed.data.code : undefined };
  };

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Ada", email: `ada-team-routes-${ns}@example.com` },
    });
    userId = user.id;
    const outsider = await prisma.user.create({
      data: { name: "Outsider", email: `outsider-team-routes-${ns}@example.com` },
    });
    outsiderId = outsider.id;
    const organization = await prisma.organization.create({
      data: { name: `teams ${ns}`, slug: `--test-org-team-routes-${ns}`, license: null },
    });
    organizationId = organization.id;
    await prisma.organizationUser.create({ data: { userId, organizationId, role: "ADMIN" } });
    const team = await prisma.team.create({
      data: { name: `Seeded ${ns}`, slug: `--test-team-routes-${ns}`, organizationId },
    });
    teamId = team.id;
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
        id: `grant-admin-team-routes-${ns}`,
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
    const lookupId = randomBytes(8).toString("hex");
    const secret = randomBytes(24).toString("hex");
    const apiKey = await prisma.apiKey.create({
      data: {
        name: `team routes ${ns}`,
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
        id: `grant-key-team-routes-${ns}`,
        organizationId,
        principalType: "API_KEY",
        principalId: apiKey.id,
        roleKey: "admin",
        source: "grants-service",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        occurredAt: new Date(),
      },
    });
    key = `${API_KEY_PREFIX}${lookupId}_${secret}`;

    const otherTeam = await prisma.team.create({
      data: { name: `Other ${ns}`, slug: `--test-team-routes-other-${ns}`, organizationId },
    });
    otherTeamId = otherTeam.id;
    const foreign = await prisma.organization.create({
      data: { name: `foreign ${ns}`, slug: `--test-org-team-routes-foreign-${ns}`, license: null },
    });
    foreignOrganizationId = foreign.id;
    const foreignTeam = await prisma.team.create({
      data: {
        name: `Foreign ${ns}`,
        slug: `--test-team-routes-foreign-${ns}`,
        organizationId: foreignOrganizationId,
      },
    });
    foreignTeamId = foreignTeam.id;

    const teamOnlyLookupId = randomBytes(8).toString("hex");
    const teamOnlySecret = randomBytes(24).toString("hex");
    const teamOnly = await prisma.apiKey.create({
      data: {
        name: `team routes one team ${ns}`,
        lookupId: teamOnlyLookupId,
        hashedSecret: createHash("sha256").update(teamOnlySecret).digest("hex"),
        permissionMode: "all",
        userId,
        createdByUserId: userId,
        organizationId,
      },
    });
    await prisma.grant.create({
      data: {
        id: `grant-key-one-team-routes-${ns}`,
        organizationId,
        principalType: "API_KEY",
        principalId: teamOnly.id,
        roleKey: "admin",
        source: "grants-service",
        scopeType: "TEAM",
        scopeId: teamId,
        occurredAt: new Date(),
      },
    });
    teamOnlyKey = `${API_KEY_PREFIX}${teamOnlyLookupId}_${teamOnlySecret}`;
    api = await bootLiveApi({});
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    if (organizationId) {
      await prisma.grant.deleteMany({ where: { organizationId } });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
      await prisma.apiKey.deleteMany({ where: { organizationId } });
      await prisma.team.deleteMany({ where: { organizationId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    if (foreignOrganizationId) {
      await prisma.team.deleteMany({ where: { organizationId: foreignOrganizationId } });
      await prisma.organization.deleteMany({ where: { id: foreignOrganizationId } });
    }
    await prisma?.user.deleteMany({ where: { id: { in: [userId, outsiderId].filter(Boolean) } } });
    await connection?.closeOnce();
  });

  /** Every route that names a team, asked of the team at `team` by the credential `as`. */
  const everyRoute = async ({ team, as = key }: { team: string; as?: string }) => {
    const path = `/api/teams/${team}`;

    return [
      await ask({ path, as }),
      await ask({ path, method: "PATCH", body: { name: `Renamed ${ns}` }, as }),
      await ask({ path: `${path}/members`, as }),
      await ask({ path: `${path}/projects`, as }),
      await ask({ path: `${path}/members`, method: "POST", body: { userId, role: "MEMBER" }, as }),
      await ask({ path: `${path}/members/${userId}`, method: "DELETE", as }),
      await ask({ path, method: "DELETE", as }),
    ];
  };

  describe("when a key granted on one team only asks every route naming another", () => {
    /** @scenario An organization key granted on one team is refused on every route naming another */
    it("refuses each with the handled 403, never a 500 and never an answer", async () => {
      const answered = await everyRoute({ team: otherTeamId, as: teamOnlyKey });

      expect(answered).toEqual(
        answered.map(() => ({ status: 403, code: "insufficient_permissions" })),
      );
      const other = await prisma.team.findUniqueOrThrow({ where: { id: otherTeamId } });
      expect(other.name).toBe(`Other ${ns}`);
      expect(other.archivedAt).toBeNull();
    });
  });

  describe("when it asks every route naming a team of another organization", () => {
    /** @scenario An organization key is told a team of another organization does not exist */
    it("answers 404 team_not_found on each and leaves that team untouched", async () => {
      const answered = await everyRoute({ team: foreignTeamId });

      expect(answered).toEqual(answered.map(() => ({ status: 404, code: "team_not_found" })));
      const foreign = await prisma.team.findUniqueOrThrow({ where: { id: foreignTeamId } });
      expect(foreign.name).toBe(`Foreign ${ns}`);
      expect(foreign.archivedAt).toBeNull();
    });
  });

  describe("when it asks a route naming a team that does not exist", () => {
    it("answers 404 team_not_found", async () => {
      expect(await ask({ path: `/api/teams/team_doesnotexist_${ns}` })).toEqual({
        status: 404,
        code: "team_not_found",
      });
    });
  });

  describe("when it asks every route that names a team", () => {
    /** @scenario An organization key is answered on every route that names a team */
    it("answers 200, 422 on a user outside the organization, and 404 on a member who holds no role", async () => {
      const team = `/api/teams/${teamId}`;

      const answered = {
        get: await ask({ path: team }),
        patch: await ask({ path: team, method: "PATCH", body: { name: `Renamed ${ns}` } }),
        members: await ask({ path: `${team}/members` }),
        projects: await ask({ path: `${team}/projects` }),
        addOutsider: await ask({
          path: `${team}/members`,
          method: "POST",
          body: { userId: outsiderId, role: "MEMBER" },
        }),
        removeUnbound: await ask({ path: `${team}/members/${userId}`, method: "DELETE" }),
        archive: await ask({ path: team, method: "DELETE" }),
      };

      expect(answered).toEqual({
        get: { status: 200, code: undefined },
        patch: { status: 200, code: undefined },
        members: { status: 200, code: undefined },
        projects: { status: 200, code: undefined },
        addOutsider: { status: 422, code: "user_not_in_organization" },
        removeUnbound: { status: 404, code: "team_membership_not_found" },
        archive: { status: 200, code: undefined },
      });
    });
  });
});
