/**
 * @vitest-environment node
 * The authz engine, installed as the api installs it over a live Postgres, reading a
 * cut-over organization's capped share link through AuthzApi.
 * @see modules/share/specs/share.feature
 */
import { AUTHZ_ENGINE_MIGRATION_NAME, AuthzApi } from "@langwatch/authz-contract";
import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing } from "@langwatch/eventing";
import { serverModules } from "@langwatch/installed-server-modules";
import { bootInstalledProcess, storesBackedMembers } from "@langwatch/kernel";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import {
  GrantPrincipalType,
  GrantScopeType,
  type Organization,
  type PrismaClient,
  type Project,
  ShareResourceType,
  ShareVisibility,
  type Team,
} from "@langwatch/prisma-client/generated";
import { processConfig } from "@langwatch/process-server";
import { memoryStores } from "@langwatch/process-stores";
import { createTestLogger } from "@langwatch/test-harness";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      logger: createLogger("share-link-engine-test"),
      guard: new AllowTestQueries(),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;
const prisma = connection?.client as PrismaClient;

const ns = `share-engine-${generate("test").toString()}`;
const MAX_VIEWS = 2;

const authz = serverModules.filter((module) => module.name === "authz");

/** The authz module alone, installed as the api installs it, over the live database. */
const bootAuthz = () =>
  bootInstalledProcess({
    role: "api",
    modules: authz,
    config: parseProcessConfig({
      owners: processConfig(authz, "api"),
      environment: { NODE_ENV: "test" },
    }),
    members: storesBackedMembers(memoryStores(), {
      logger: createTestLogger().logger,
      prisma,
      redis: memoryRedisDouble(),
      eventing: new EventSourcing({ enabled: false, processManagerMode: "producer-only" }),
    }),
  });

describe.skipIf(!databaseUrl)("given a cut-over organization's capped share link", () => {
  let organization: Organization;
  let team: Team;
  let project: Project;
  let traceId: string;
  let token: string;
  let grantId: string;

  const canView = (authz: AuthzApi) =>
    authz.can({
      principal: { type: "anonymous" },
      permission: "traces:view",
      scope: {
        type: "resource",
        kind: "trace",
        id: traceId,
        shareTokens: [token],
        projectId: project.id,
        teamId: team.id,
        organizationId: organization.id,
      },
    });

  const spendViews = (viewCount: number) =>
    prisma.grantUsage.upsert({
      where: { grantId },
      create: { grantId, organizationId: organization.id, projectId: project.id, viewCount },
      update: { viewCount },
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Share Engine Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Share Engine Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Share Engine Project",
        slug: `--test-project-${ns}`,
        apiKey: `--test-key-${ns}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });
    traceId = `trace_${ns}`;
    token = `--test-share-token-${ns}`;

    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: organization.id,
        status: "finalized",
        occurredAt: new Date(),
      },
    });
    const shareLink = await prisma.shareLink.create({
      data: {
        token,
        resourceType: ShareResourceType.TRACE,
        resourceId: traceId,
        projectId: project.id,
        visibility: ShareVisibility.PUBLIC,
        maxViews: MAX_VIEWS,
        viewCount: 1,
      },
    });
    grantId = shareLink.id;
    await prisma.grant.create({
      data: {
        id: grantId,
        organizationId: organization.id,
        principalType: GrantPrincipalType.ANYONE,
        principalId: null,
        roleKey: null,
        source: "cutover-import",
        scopeType: GrantScopeType.RESOURCE,
        scopeId: traceId,
        token,
        permission: "traces:view",
        resourceKind: "TRACE",
        projectId: project.id,
        maxViews: MAX_VIEWS,
        occurredAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (organization?.id) {
      await prisma.grantUsage.deleteMany({ where: { organizationId: organization.id } });
      await prisma.shareLink.deleteMany({ where: { projectId: project.id } });
      await prisma.grant.deleteMany({ where: { organizationId: organization.id } });
      await prisma.systemMigrationTenantState.deleteMany({
        where: { tenantId: organization.id },
      });
      await prisma.project.deleteMany({ where: { id: project.id } });
      await prisma.team.deleteMany({ where: { id: team.id } });
      await prisma.organization.deleteMany({ where: { id: organization.id } });
    }

    await connection?.closeOnce();
  });

  describe("when the engine reads the link back", () => {
    /** @scenario "A cut-over organization's share link consumes its remaining budget" */
    it("grants the view while the counted budget has one left", async () => {
      const runtime = await bootAuthz();

      try {
        await spendViews(MAX_VIEWS - 1);

        await expect(canView(runtime.service(AuthzApi))).resolves.toBe(true);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "An exhausted share link stays exhausted after cutover" */
    it("grants nothing once the counted budget is spent", async () => {
      const runtime = await bootAuthz();

      try {
        await spendViews(MAX_VIEWS);

        await expect(canView(runtime.service(AuthzApi))).resolves.toBe(false);
      } finally {
        await runtime.stop();
      }
    });
  });
});
