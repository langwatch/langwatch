/**
 * @vitest-environment node
 *
 * Every path that creates a project writes its LangWatchQL key-map row.
 *
 * The row policy on every LangWatchQL view resolves the tenant through
 * `lwql_api_key_tenant_map`, so a project without a row reads zero rows. The
 * deploy-time backfill runs only at boot, which on a fresh install is before
 * the first project exists. These cases drive the real creation paths against
 * real Postgres and the real ClickHouse key-map table from migration 00084.
 *
 * Spec: specs/lwql/project-key-map.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { lwqlTenantCapability } from "~/server/analytics/lwql/capability";
import { LwqlKeyMapClickHouseRepository } from "~/server/analytics/lwql/lwqlKeyMap.repository";
import { onboardingRouter } from "~/server/api/routers/onboarding/onboarding.router";
import { projectRouter } from "~/server/api/routers/project";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { resetAuthzGrantsCommandsForTests } from "~/server/app-layer/authz/ledger";
import { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { ProjectService } from "~/server/app-layer/projects/project.service";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { EventSourcing } from "~/server/event-sourcing/eventSourcing";
import type { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { app as projectsRestApp } from "../../../../app/api/projects/[[...route]]/app";

const suffix = nanoid(8);

let clickHouse: ClickHouseClient;
let eventSourcing: EventSourcing;
const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

async function keyMapRowsFor(tenantId: string) {
  const result = await clickHouse.query({
    query:
      "SELECT KeyHash, TenantId FROM lwql_api_key_tenant_map WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  return result.json<{ KeyHash: string; TenantId: string }>();
}

/** The one row a project should own: its own key hash, mapped to itself. */
async function expectKeyMapRow(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { lwqlKey: true },
  });
  const rows = await keyMapRowsFor(projectId);
  expect(rows).toEqual([
    {
      KeyHash: lwqlTenantCapability({ secret: project.lwqlKey }),
      TenantId: projectId,
    },
  ]);
}

async function seedUser(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `Key map ${label}`,
      email: `lwql-key-map-${label}-${suffix}@example.com`,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function sessionContext(user: {
  id: string;
  name: string | null;
  email: string | null;
}) {
  return createInnerTRPCContext({
    session: {
      user: { id: user.id, name: user.name, email: user.email },
      expires: "1",
    },
    permissionChecked: false,
  }) as never;
}

describe("LangWatchQL key-map row on project creation", () => {
  let user: Awaited<ReturnType<typeof seedUser>>;
  let organizationId: string;
  let teamId: string;

  beforeAll(async () => {
    ({ clickHouseClient: clickHouse } = await startTestContainers());

    // LangWatchQL counts as configured once the restricted identity has a
    // password; the connection derives from the test CLICKHOUSE_URL.
    vi.stubEnv("LWQL_CLICKHOUSE_PASSWORD", "lwql-key-map-test");
    vi.stubEnv("LWQL_CLICKHOUSE_URL", "");
    vi.stubEnv("LWQL_DATABASE", "");

    await resetApp();
    resetAuthzGrantsCommandsForTests();
    eventSourcing = createAuthzTestEventSourcing(prisma);
    globalForApp.__langwatch_app = createTestApp({
      _eventSourcing: eventSourcing,
      organizations: new OrganizationService(
        new PrismaOrganizationRepository(prisma),
        {
          seedForOrg: async () => {
            /* noop */
          },
        } as unknown as PromptTagRepository,
      ),
      projects: new ProjectService(
        new PrismaProjectRepository(prisma),
        new LwqlKeyMapClickHouseRepository(async () => clickHouse),
      ),
    });

    user = await seedUser("owner");
    const result = await onboardingRouter
      .createCaller(sessionContext(user))
      .initializeOrganization({
        orgName: `ACME Key Map ${suffix}`,
        primaryIntent: "LLM_OPS",
        projectName: `First project ${suffix}`,
        language: "other",
        framework: "other",
      });
    organizationId = result.organizationId;
    teamId = result.teamId;
    createdOrganizationIds.push(organizationId);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const orgId of createdOrganizationIds) {
      const projects = await prisma.project.findMany({
        where: { team: { organizationId: orgId } },
        select: { id: true },
      });
      const projectIds = projects.map((project) => project.id);
      if (projectIds.length > 0) {
        await prisma.projectSecret.deleteMany({
          where: { projectId: { in: projectIds } },
        });
        await clickHouse.command({
          query:
            "DELETE FROM lwql_api_key_tenant_map WHERE TenantId IN {ids:Array(String)}",
          query_params: { ids: projectIds },
        });
      }
      await cleanupTestRows(prisma, [
        ["grantUsage", { organizationId: orgId }],
        ["grant", { organizationId: orgId }],
        ["role", { organizationId: orgId }],
        ["project", { team: { organizationId: orgId } }],
        ["aiToolEntry", { organizationId: orgId }],
        ["roleBinding", { organizationId: orgId }],
        ["apiKey", { organizationId: orgId }],
        ["teamUser", { team: { organizationId: orgId } }],
        ["team", { organizationId: orgId }],
        ["organizationUser", { organizationId: orgId }],
        ["organization", { id: orgId }],
      ]);
    }
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await resetApp();
    resetAuthzGrantsCommandsForTests();
    await eventSourcing.close();
    await stopTestContainers();
  });

  describe("when a user finishes onboarding", () => {
    /** @scenario "The first project created during onboarding gets its key-map row" */
    it("writes the first project's key-map row", async () => {
      const firstProject = await prisma.project.findFirstOrThrow({
        where: { teamId, isPersonal: false },
        select: { id: true },
      });

      await expectKeyMapRow(firstProject.id);
    });
  });

  describe("when a user creates a project through the project router", () => {
    /** @scenario "A project created from the projects screen gets its key-map row" */
    it("writes the new project's key-map row", async () => {
      const { projectSlug } = await projectRouter
        .createCaller(sessionContext(user))
        .create({
          organizationId,
          teamId,
          name: `Second project ${suffix}`,
          language: "other",
          framework: "other",
        });
      const project = await prisma.project.findFirstOrThrow({
        where: { slug: projectSlug },
        select: { id: true },
      });

      await expectKeyMapRow(project.id);
    });
  });

  describe("when an organization API key creates a project through the REST API", () => {
    /** @scenario "A project created through the REST API gets its key-map row" */
    it("writes the new project's key-map row", async () => {
      const { token } = await ApiKeyService.create(prisma).create({
        name: `key-map-${nanoid(6)}`,
        userId: user.id,
        createdByUserId: user.id,
        organizationId,
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });

      const response = await projectsRestApp.request("/api/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `REST project ${suffix}`,
          teamId,
          language: "other",
          framework: "other",
        }),
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { id: string };

      await expectKeyMapRow(body.id);
    });
  });

  describe("when the user's personal workspace is provisioned", () => {
    /** @scenario "A personal workspace project gets its key-map row" */
    it("writes the personal project's key-map row", async () => {
      const workspace = await new PersonalWorkspaceService(prisma).ensure({
        userId: user.id,
        organizationId,
        displayName: user.name,
        displayEmail: user.email,
      });
      expect(workspace.created).toBe(true);

      await expectKeyMapRow(workspace.project.id);
    });
  });
});
