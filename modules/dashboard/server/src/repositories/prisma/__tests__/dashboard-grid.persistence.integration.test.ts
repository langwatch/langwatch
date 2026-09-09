import { SavedWorkbenchChartAlreadyExistsError } from "@langwatch/dashboard-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDashboardTestAnalytics } from "../../../app/__tests__/dashboard.fixture.ts";
import { WorkbenchAccessPort } from "../../../ports/workbench-access.port.ts";
import { PrismaDashboardRepository } from "../prisma.dashboard.repository.ts";
import { DashboardService } from "../../../services/dashboard.service.ts";
import { SavedWorkbenchChartPolicyService } from "../../../services/saved-workbench-chart-policy.service.ts";
import { SavedWorkbenchChartService } from "../../../services/saved-workbench-chart.service.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

class WorkbenchOn extends WorkbenchAccessPort {
  async isWorkbenchEnabled(): Promise<boolean> {
    return true;
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for Dashboard grid persistence tests");
  }
  return connection.client;
}

const namespace = `dashboard-grid-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";

function graphs(): DashboardService {
  return DashboardService.create({
    repository: PrismaDashboardRepository.create({ prisma: database() }),
    workbenchAccess: new WorkbenchOn(),
  });
}

/** Governance is the policy service's; this suite is about the shared grid. */
function charts(): SavedWorkbenchChartService {
  const analytics = createDashboardTestAnalytics();

  return SavedWorkbenchChartService.create({
    repository: PrismaDashboardRepository.create({ prisma: database() }),
    policy: SavedWorkbenchChartPolicyService.create({ analytics }),
    analytics,
  });
}

async function createDashboard(): Promise<{ id: string }> {
  return database().dashboard.create({
    data: {
      id: `dashboard-${randomUUID()}`,
      projectId,
      name: "Reports",
      order: 0,
    },
    select: { id: true },
  });
}

async function graphRow(id: string): Promise<{ gridRow: number; kind: string }> {
  const row = await database().customGraph.findUniqueOrThrow({
    where: { id },
    select: { gridRow: true, kind: true },
  });
  return row;
}

describe.skipIf(!databaseUrl)("Dashboard shared grid persistence", () => {
  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await database().team.create({
      data: { name: namespace, slug: namespace, organizationId },
    });
    teamId = team.id;
    const project = await database().project.create({
      data: {
        name: namespace,
        slug: namespace,
        apiKey: namespace,
        teamId,
        language: "typescript",
        framework: "other",
      },
    });
    projectId = project.id;
  });

  beforeEach(async () => {
    await cleanupTestRows(database(), [
      ["customGraph", { projectId }],
      ["dashboard", { projectId }],
    ]);
  });

  afterAll(async () => {
    try {
      if (projectId) {
        await cleanupTestRows(database(), [
          ["customGraph", { projectId }],
          ["dashboard", { projectId }],
        ]);
        await database().project.delete({ where: { id: projectId } });
        await database().team.delete({ where: { id: teamId } });
        await database().organization.delete({ where: { id: organizationId } });
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  /**
   * @scenario "Placing a chart onto a dashboard already holding builder charts does not overlap them"
   */
  it("places a saved chart after an existing builder without moving the builder", async () => {
    const builders = graphs();
    const savedCharts = charts();
    const dashboard = await createDashboard();
    const builder = await builders.createGraph({
      projectId,
      dashboardId: dashboard.id,
      name: "Builder",
      graph: {},
      layout: { gridRow: 4 },
    });
    const saved = await savedCharts.create({
      id: `saved-${randomUUID()}`,
      projectId,
      protections: {},
      name: "Saved",
      definition: { version: 1, sql: "SELECT 1", parameters: {} },
    });

    const placed = await savedCharts.place({
      projectId,
      chartId: saved.id,
      dashboardId: dashboard.id,
    });

    await expect(graphRow(builder.id)).resolves.toEqual({ gridRow: 4, kind: "builder" });
    await expect(graphRow(placed.id)).resolves.toEqual({ gridRow: 5, kind: "workbench_sql" });
  });

  /** @scenario "Placing a saved workbench chart does not let a builder chart land on top of it" */
  it("places a builder after an existing saved chart without moving the saved chart", async () => {
    const builders = graphs();
    const savedCharts = charts();
    const dashboard = await createDashboard();
    const saved = await savedCharts.create({
      id: `saved-${randomUUID()}`,
      projectId,
      protections: {},
      name: "Saved",
      definition: { version: 1, sql: "SELECT 1", parameters: {} },
    });
    await savedCharts.place({
      projectId,
      chartId: saved.id,
      dashboardId: dashboard.id,
      gridRow: 4,
    });

    const builder = await builders.createGraph({
      projectId,
      dashboardId: dashboard.id,
      name: "Builder",
      graph: {},
    });

    await expect(graphRow(saved.id)).resolves.toEqual({ gridRow: 4, kind: "workbench_sql" });
    await expect(graphRow(builder.id)).resolves.toEqual({ gridRow: 5, kind: "builder" });
  });

  it("maps an explicit saved-chart id collision through the repository's Prisma catch", async () => {
    const savedCharts = charts();
    const input = {
      id: `saved-${randomUUID()}`,
      projectId,
      protections: {},
      name: "Saved",
      definition: { version: 1 as const, sql: "SELECT 1", parameters: {} },
    };

    await savedCharts.create(input);
    await expect(savedCharts.create(input)).rejects.toBeInstanceOf(
      SavedWorkbenchChartAlreadyExistsError,
    );
  });
});
