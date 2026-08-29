import {
  LangWatchQLService,
  type LangWatchQLExecuteInput,
  type LangWatchQLQueryResult,
  type LangWatchQLSchema,
  type LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import { SavedWorkbenchChartAlreadyExistsError } from "@langwatch/dashboard-contract";
import { SavedWorkbenchChartPolicy } from "../../../ports/dashboard.port";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DashboardGraphVisibilityPolicyPort,
  DashboardIdGenerator,
} from "../../../ports/dashboard.port";
import { PrismaDashboardRepository } from "../prisma.dashboard.repository";
import { DashboardService } from "../../../services/dashboard.service";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

class TestDashboardIds extends DashboardIdGenerator {
  generate(): string {
    return `dashboard-graph-${randomUUID()}`;
  }
}

class AllowSavedWorkbenchCharts extends SavedWorkbenchChartPolicy {
  validate(): void {}
}

class AllGraphsVisible extends DashboardGraphVisibilityPolicyPort {
  async placeableKinds(): Promise<readonly ("builder" | "workbench_sql")[]> {
    return ["builder", "workbench_sql"];
  }
}

class UnusedLangWatchQL extends LangWatchQLService {
  readonly available = false;

  async close(): Promise<void> {}

  describeSchema(): LangWatchQLSchema {
    return { database: "analytics", datasets: [] };
  }

  validate(_input: LangWatchQLValidationInput): unknown {
    return {};
  }

  async execute(_input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult> {
    throw new Error("This persistence suite does not execute LangWatchQL");
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

function service(): DashboardService {
  return DashboardService.create({
    repository: PrismaDashboardRepository.create(database()),
    ids: new TestDashboardIds(),
    savedWorkbenchChartPolicy: new AllowSavedWorkbenchCharts(),
    graphVisibility: new AllGraphsVisible(),
    langWatchQL: new UnusedLangWatchQL(),
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
    await database().customGraph.deleteMany({ where: { projectId } });
    await database().dashboard.deleteMany({ where: { projectId } });
  });

  afterAll(async () => {
    if (projectId) {
      await database().customGraph.deleteMany({ where: { projectId } });
      await database().dashboard.deleteMany({ where: { projectId } });
      await database().project.delete({ where: { id: projectId } });
      await database().team.delete({ where: { id: teamId } });
      await database().organization.delete({ where: { id: organizationId } });
    }
    await connection?.closeOnce();
  });

  it("places a saved chart after an existing builder without moving the builder", async () => {
    const dashboards = service();
    const dashboard = await createDashboard();
    const builder = await dashboards.createGraph({
      projectId,
      dashboardId: dashboard.id,
      name: "Builder",
      graph: {},
      layout: { gridRow: 4 },
    });
    const saved = await dashboards.createSavedWorkbenchChart({
      id: `saved-${randomUUID()}`,
      projectId,
      protections: {},
      name: "Saved",
      definition: { version: 1, sql: "SELECT 1", parameters: {} },
    });

    const placed = await dashboards.placeSavedWorkbenchChart({
      projectId,
      chartId: saved.id,
      dashboardId: dashboard.id,
    });

    await expect(graphRow(builder.id)).resolves.toEqual({ gridRow: 4, kind: "builder" });
    await expect(graphRow(placed.id)).resolves.toEqual({ gridRow: 5, kind: "workbench_sql" });
  });

  it("places a builder after an existing saved chart without moving the saved chart", async () => {
    const dashboards = service();
    const dashboard = await createDashboard();
    const saved = await dashboards.createSavedWorkbenchChart({
      id: `saved-${randomUUID()}`,
      projectId,
      protections: {},
      name: "Saved",
      definition: { version: 1, sql: "SELECT 1", parameters: {} },
    });
    await dashboards.placeSavedWorkbenchChart({
      projectId,
      chartId: saved.id,
      dashboardId: dashboard.id,
      gridRow: 4,
    });

    const builder = await dashboards.createGraph({
      projectId,
      dashboardId: dashboard.id,
      name: "Builder",
      graph: {},
    });

    await expect(graphRow(saved.id)).resolves.toEqual({ gridRow: 4, kind: "workbench_sql" });
    await expect(graphRow(builder.id)).resolves.toEqual({ gridRow: 5, kind: "builder" });
  });

  it("maps an explicit saved-chart id collision through the repository's Prisma catch", async () => {
    const dashboards = service();
    const input = {
      id: `saved-${randomUUID()}`,
      projectId,
      protections: {},
      name: "Saved",
      definition: { version: 1 as const, sql: "SELECT 1", parameters: {} },
    };

    await dashboards.createSavedWorkbenchChart(input);
    await expect(dashboards.createSavedWorkbenchChart(input)).rejects.toBeInstanceOf(
      SavedWorkbenchChartAlreadyExistsError,
    );
  });
});
