// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The trace-destination cross-org guard (ADR-088 v7, Decision 9), against
 * real Postgres.
 *
 * The destination column decides where routed conversations — customer-
 * visible data — land, and the puller writes with a service-level Prisma
 * client, so this write-time check is the only gate: a stray id accepted
 * here would write one tenant's Genie conversations into another tenant's
 * project. Mirrors `assertTraceProjectBelongsToOrg` on the virtual-key path.
 *
 * Driven through the REAL save path (`createSource`/`updateSource`) so the
 * guard cannot be deleted without this failing.
 */

import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { FREE_PLAN } from "@ee/licensing/constants";
import type { PlanInfo } from "@ee/licensing/planInfo";
import { ValidationError } from "@langwatch/handled-error";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows, requireAssigned } from "~/test-utils/cleanupTestRows";

const ns = `trace-dest-${nanoid(8)}`;
// Enterprise so the source cap cannot reject a create for a reason that has
// nothing to do with what is under test.
const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };

let organizationId: string;
let foreignOrganizationId: string;
let ownProjectId: string;
let archivedProjectId: string;
let foreignProjectId: string;
let actorUserId: string;

async function mintOrgWithProject(suffix: string) {
  const organization = await prisma.organization.create({
    data: { name: `Trace Dest Org ${ns}-${suffix}`, slug: `--${ns}-${suffix}` },
  });
  const team = await prisma.team.create({
    data: {
      name: `Trace Dest Team ${ns}-${suffix}`,
      slug: `--${ns}-${suffix}-team`,
      organizationId: organization.id,
    },
  });
  const project = await prisma.project.create({
    data: {
      name: `Trace Dest Project ${ns}-${suffix}`,
      slug: `--${ns}-${suffix}-project`,
      teamId: team.id,
      language: "other",
      framework: "other",
      apiKey: `test-key-${ns}-${suffix}`,
    },
  });
  return {
    organizationId: organization.id,
    teamId: team.id,
    projectId: project.id,
  };
}

beforeAll(async () => {
  await resetApp();
  globalForApp.__langwatch_app = createTestApp({
    planProvider: PlanProviderService.create({
      getActivePlan: async () => enterprisePlan,
    }),
  });

  const own = await mintOrgWithProject("own");
  organizationId = own.organizationId;
  ownProjectId = own.projectId;

  const archived = await prisma.project.create({
    data: {
      name: `Trace Dest Archived ${ns}`,
      slug: `--${ns}-archived`,
      teamId: own.teamId,
      language: "other",
      framework: "other",
      apiKey: `test-key-${ns}-archived`,
      archivedAt: new Date(),
    },
  });
  archivedProjectId = archived.id;

  const foreign = await mintOrgWithProject("foreign");
  foreignOrganizationId = foreign.organizationId;
  foreignProjectId = foreign.projectId;

  const admin = await prisma.user.create({
    data: { name: "Admin", email: `${ns}-admin@example.com` },
  });
  actorUserId = admin.id;
});

afterAll(async () => {
  const orgIds = [organizationId, foreignOrganizationId].map((value) =>
    requireAssigned({ value, name: "organizationId" }),
  );
  const projectIds = (
    await prisma.project.findMany({
      where: { team: { organizationId: { in: orgIds } } },
      select: { id: true },
    })
  ).map((project) => project.id);
  await cleanupTestRows(prisma, [
    ["ingestionSource", { organizationId: { in: orgIds } }],
    ["projectSecret", { projectId: { in: projectIds } }],
    ["project", { team: { organizationId: { in: orgIds } } }],
    ["team", { organizationId: { in: orgIds } }],
    ["organization", { id: { in: orgIds } }],
    ["user", { email: `${ns}-admin@example.com` }],
  ]);
});

function createInput(
  traceProjectId: string | null | undefined,
  suffix: string,
) {
  return {
    organizationId,
    sourceType: "databricks_genie" as const,
    name: `genie-trace-dest-${ns}-${suffix}`,
    pullConfig: {
      adapter: "databricks_genie",
      workspaceUrl: "https://adb-1234567890123456.7.azuredatabricks.net",
      spaceIds: [],
      credentials: { token: `dapi-${nanoid(12)}` },
    },
    traceProjectId,
    actorUserId,
  };
}

describe("given an admin points a Genie source at a trace destination", () => {
  it("accepts a live project of the source's own organization", async () => {
    const service = IngestionSourceService.create(prisma);
    const { source } = await service.createSource(
      createInput(ownProjectId, "ok"),
    );
    expect(source.traceProjectId).toBe(ownProjectId);
  });

  it("rejects another organization's project at create time", async () => {
    const service = IngestionSourceService.create(prisma);
    await expect(
      service.createSource(createInput(foreignProjectId, "foreign")),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an archived project at create time", async () => {
    const service = IngestionSourceService.create(prisma);
    await expect(
      service.createSource(createInput(archivedProjectId, "archived")),
    ).rejects.toThrow(ValidationError);
  });
});

describe("given the destination is edited later (the virtual-key contract)", () => {
  it("re-validates a new destination, leaves an untouched one alone, and clears on null", async () => {
    const service = IngestionSourceService.create(prisma);
    const { source } = await service.createSource(
      createInput(ownProjectId, "edit"),
    );

    // A foreign destination is rejected on update exactly as on create.
    await expect(
      service.updateSource({
        id: source.id,
        organizationId,
        traceProjectId: foreignProjectId,
      }),
    ).rejects.toThrow(ValidationError);

    // An update that says nothing about the destination leaves it alone.
    const renamed = await service.updateSource({
      id: source.id,
      organizationId,
      name: `genie-trace-dest-${ns}-edit-renamed`,
    });
    expect(renamed.traceProjectId).toBe(ownProjectId);

    // Null stops routing.
    const cleared = await service.updateSource({
      id: source.id,
      organizationId,
      traceProjectId: null,
    });
    expect(cleared.traceProjectId).toBeNull();
  });
});
