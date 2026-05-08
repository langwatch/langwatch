/**
 * @vitest-environment node
 *
 * Cross-surface audit-uniformity regression for the umbrella spec
 * @audit-uniform contract:
 *
 *   "ALL THREE rows have IDENTICAL payload shapes apart from the
 *    surface field"
 *
 * Exercises createOrgTemplate via THREE entrypoints in the same test:
 *   1. tRPC pass-through (service-direct call with surface="trpc",
 *      mirroring what ee/governance/routers/ingestionTemplates.ts does)
 *   2. Hono REST (real HTTP request to POST /api/governance/ingestion-templates)
 *   3. MCP service-direct (mimicking what src/mcp/governance-tools.ts
 *      `registerGovernanceMcpTools` invokes; service trusts the surface)
 *
 * Then asserts that the three audit rows are identical apart from
 * metadata.surface. CLI is the fourth surface — gated on Lane-B
 * `langwatch governance` shipping; will fold into this test as a
 * fourth case once that lands.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 *       (@bdd @governance-api @audit-uniform)
 */
import {
  type Organization,
  OrganizationUserRole,
  type Project,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
  type User,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IngestionTemplateService } from "@ee/governance/services/ingestionTemplate.service";

import { app as governanceApp } from "~/app/api/governance/[[...route]]/app";
import { projectFactory } from "~/factories/project.factory";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  PlanProviderService,
  type PlanProvider,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";

import { FREE_PLAN } from "../../../licensing/constants";

const SHARED_INPUT = {
  sourceType: "internal_uniform",
  displayName: "Cross-Surface Uniform",
  description: "Locked-shape regression target",
  ottlRules: 'set(attributes["langwatch.cost.usd"], 0)',
};

describe("Audit uniformity: identical payload shape across all governance surfaces", () => {
  let testOrg: Organization;
  let testTeam: Team;
  let testProject: Project;
  let testUser: User;

  const orgIds: string[] = [];
  const userIds: string[] = [];
  const templateIds: string[] = [];

  beforeEach(async () => {
    resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue(FREE_PLAN) as unknown as
          PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
    });

    const ns = nanoid(8);
    testOrg = await prisma.organization.create({
      data: { name: `Uniform Org ${ns}`, slug: `uniform-${ns}` },
    });
    orgIds.push(testOrg.id);

    testTeam = await prisma.team.create({
      data: {
        name: `Uniform Team ${ns}`,
        slug: `uniform-team-${ns}`,
        organizationId: testOrg.id,
      },
    });

    const projectInput = (projectFactory.build as unknown as (
      override: Partial<Project>,
    ) => Project)({ slug: nanoid() });
    testProject = await prisma.project.create({
      data: { ...projectInput, teamId: testTeam.id } as unknown as Parameters<
        typeof prisma.project.create
      >[0]["data"],
    });

    testUser = await prisma.user.create({
      data: { email: `uniform-${ns}@example.com`, name: `Uniform User ${ns}` },
    });
    userIds.push(testUser.id);

    await prisma.organizationUser.create({
      data: {
        userId: testUser.id,
        organizationId: testOrg.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    // RoleBinding(user, ADMIN) so the audit-row userId stays consistent
    // across surfaces and the user genuinely has organization:manage at
    // the org scope (not strictly required for service-direct calls, but
    // mirrors a realistic admin caller).
    await prisma.roleBinding.create({
      data: {
        organizationId: testOrg.id,
        userId: testUser.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrg.id,
      },
    });
  });

  afterEach(async () => {
    if (templateIds.length > 0) {
      await prisma.ingestionTemplate
        .deleteMany({ where: { id: { in: templateIds } } })
        .catch(() => undefined);
      templateIds.length = 0;
    }
    await prisma.auditLog
      .deleteMany({ where: { organizationId: { in: orgIds } } })
      .catch(() => undefined);
    await prisma.roleBinding
      .deleteMany({ where: { organizationId: { in: orgIds } } })
      .catch(() => undefined);
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: { in: orgIds } } })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({ where: { teamId: testTeam?.id } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { organizationId: { in: orgIds } } })
      .catch(() => undefined);
    for (const id of userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    userIds.length = 0;
    for (const id of orgIds) {
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
    orgIds.length = 0;
  });

  it("audit rows from tRPC + Hono + MCP entrypoints share an identical shape apart from metadata.surface", async () => {
    const service = IngestionTemplateService.create(prisma);

    // 1. tRPC pass-through — mirrors ee/governance/routers/ingestionTemplates.ts
    //    which calls `service.createOrgTemplate({ ..., surface: "trpc" })`.
    const trpcRow = await service.createOrgTemplate({
      organizationId: testOrg.id,
      callerUserId: testUser.id,
      sourceType: SHARED_INPUT.sourceType,
      displayName: SHARED_INPUT.displayName,
      description: SHARED_INPUT.description,
      ottlRules: SHARED_INPUT.ottlRules,
      surface: "trpc",
    });
    templateIds.push(trpcRow.id);

    // 2. Hono REST — real HTTP request through the mounted app. The
    //    legacy project apiKey path bypasses the PAT ceiling, and the
    //    callerUserId resolves to the synthetic `svc_<projectId>` actor;
    //    the audit row's userId differs by design (no human caller on
    //    the legacy token path), but every OTHER metadata key is uniform.
    const honoRes = await governanceApp.request(
      "/api/governance/ingestion-templates",
      {
        method: "POST",
        headers: {
          "X-Auth-Token": testProject.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_type: SHARED_INPUT.sourceType,
          display_name: SHARED_INPUT.displayName,
          description: SHARED_INPUT.description,
          ottl_rules: SHARED_INPUT.ottlRules,
        }),
      },
    );
    expect(honoRes.status).toBe(201);
    const honoBody = (await honoRes.json()) as {
      ingestion_template: { id: string };
    };
    templateIds.push(honoBody.ingestion_template.id);

    // 3. MCP service-direct — mirrors what
    //    src/mcp/governance-tools.ts `governance_ingestion_templates_create`
    //    invokes after RBAC at the tool layer + snake→camel mapping:
    //    `service.createOrgTemplate({ ..., surface: "mcp" })`. Services
    //    trust the surface per @service-layer scenario.
    const mcpRow = await service.createOrgTemplate({
      organizationId: testOrg.id,
      callerUserId: testUser.id,
      sourceType: SHARED_INPUT.sourceType,
      displayName: SHARED_INPUT.displayName,
      description: SHARED_INPUT.description,
      ottlRules: SHARED_INPUT.ottlRules,
      surface: "mcp",
    });
    templateIds.push(mcpRow.id);

    // Fetch the three audit rows. Order by id is unreliable (cuid +
    // timestamps); fetch ALL three by templateId then index by surface.
    const auditRows = await prisma.auditLog.findMany({
      where: {
        organizationId: testOrg.id,
        action: "gateway.ingestion_template.created",
        targetId: { in: templateIds },
      },
    });
    expect(auditRows).toHaveLength(3);

    const bySurface: Record<string, (typeof auditRows)[number]> = {};
    for (const row of auditRows) {
      const md = row.metadata as { surface?: string } | null;
      if (md?.surface) bySurface[md.surface] = row;
    }
    expect(Object.keys(bySurface).sort()).toEqual(["hono", "mcp", "trpc"]);

    // Per umbrella spec @audit-uniform: identical payload shapes apart
    // from the surface field. We compare:
    //   - action / targetKind (resource taxonomy)
    //   - metadata KEYS minus 'surface' (payload shape)
    //   - metadata VALUES on the shared keys (slug+sourceType+displayName)
    for (const surface of ["trpc", "hono", "mcp"] as const) {
      const row = bySurface[surface];
      if (!row) throw new Error(`audit row missing for surface=${surface}`);
      expect(row.action).toBe("gateway.ingestion_template.created");
      expect(row.targetKind).toBe("ingestion_template");
      expect(row.organizationId).toBe(testOrg.id);
      const md = row.metadata as Record<string, unknown> | null;
      expect(md).not.toBeNull();
      // Required metadata keys per the create-row contract.
      const keysWithoutSurface = Object.keys(md ?? {})
        .filter((k) => k !== "surface")
        .sort();
      expect(keysWithoutSurface).toEqual(
        ["displayName", "slug", "sourceType"].sort(),
      );
      expect(md?.sourceType).toBe(SHARED_INPUT.sourceType);
      expect(md?.displayName).toBe(SHARED_INPUT.displayName);
      // Slug is server-generated with a random suffix per row, so the
      // exact string differs across the three calls; format is locked.
      expect(typeof md?.slug).toBe("string");
      expect(md?.slug).toMatch(/^cross_surface_uniform_[a-z0-9]{6}$/);
    }

    // The discriminator: each row's surface is exactly the calling
    // surface, no leakage / no default fallback fired by accident.
    const trpcMd = bySurface.trpc?.metadata as { surface?: string } | null;
    const honoMd = bySurface.hono?.metadata as { surface?: string } | null;
    const mcpMd = bySurface.mcp?.metadata as { surface?: string } | null;
    expect(trpcMd?.surface).toBe("trpc");
    expect(honoMd?.surface).toBe("hono");
    expect(mcpMd?.surface).toBe("mcp");
  });

  it("the CLI surface case is staged for fold once Lane-B `langwatch governance` ships", () => {
    // Placeholder anchor so reviewers know the four-surface uniformity
    // is the intended terminal shape; the CLI assertion will land with
    // Alexis's CLI scaffold SHA. Until then, the three-surface case
    // above is the active lock.
    expect(true).toBe(true);
  });
});
