/**
 * The two backends the dashboard module's repository contracts run against: memory always, and
 * Postgres when a test database is named at `LANGWATCH_TEST_DATABASE_URL`. Each hands out the
 * board, Reports and widget repositories over one store, so one's write is the other's read.
 */
import { randomUUID } from "node:crypto";

import { DASHBOARD_SRCDOC_CHART_KIND } from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, beforeEach } from "vitest";

import type { BoardRepository } from "../board.repository.ts";
import type { DashboardWidgetRepository } from "../dashboard-widget.repository.ts";
import type { DashboardRepository } from "../dashboard.repository.ts";
import { MemoryBoardRepository } from "../memory/memory.board.repository.ts";
import { MemoryDashboardWidgetRepository } from "../memory/memory.dashboard-widget.repository.ts";
import { MemoryDashboardDatabase } from "../memory/memory.dashboard.database.ts";
import { MemoryDashboardRepository } from "../memory/memory.dashboard.repository.ts";
import { PrismaBoardRepository } from "../prisma/prisma.board.repository.ts";
import { PrismaDashboardWidgetRepository } from "../prisma/prisma.dashboard-widget.repository.ts";
import { PrismaDashboardRepository } from "../prisma/prisma.dashboard.repository.ts";

/** One backend under test, plus the two projects of one organization the cases read. */
export type DashboardBackend = Readonly<{
  boards: () => BoardRepository;
  dashboards: () => DashboardRepository;
  widgets: () => DashboardWidgetRepository;
  projectId: () => string;
  otherProjectId: () => string;
  organizationId: () => string;
  /** Writes a srcdoc row into CustomGraph, as the split left a copied widget behind. */
  seedStaleCopy: (input: {
    id: string;
    projectId: string;
    dashboardId: string | null;
    rowSpan?: number;
  }) => Promise<void>;
  /** The ids of the srcdoc rows CustomGraph still holds for the project. */
  findStaleCopyIds: (projectId: string) => Promise<string[]>;
  /** Puts a Reports row at Only me with an author, as a board made before the split could be. */
  seedOnlyMeReportsBoard: (input: { dashboardId: string; createdById: string }) => Promise<void>;
}>;

export const id = (prefix: string) => `${prefix}_${randomUUID()}`;

export const WIDGET_INPUT = {
  name: "Usage",
  code: "export default () => null;",
  queries: [{ name: "traces", sql: "SELECT count() AS value FROM analytics.traces" }],
};

/** A memory backend over a fresh store for every case. */
export function memoryBackend(): DashboardBackend {
  let database = MemoryDashboardDatabase.create();
  beforeEach(() => {
    database = MemoryDashboardDatabase.create();
  });
  return {
    boards: () => MemoryBoardRepository.create({ database }),
    dashboards: () => MemoryDashboardRepository.create({ database }),
    widgets: () => MemoryDashboardWidgetRepository.create({ database }),
    projectId: () => "project-1",
    otherProjectId: () => "project-2",
    organizationId: () => "organization-1",
    seedStaleCopy: async ({ rowSpan = 1, ...input }) => {
      const at = database.now();
      database.charts.push({
        ...input,
        name: "Usage",
        kind: "dashboard_srcdoc",
        graph: { version: 1, code: WIDGET_INPUT.code, queries: [] },
        filters: null,
        gridColumn: 0,
        gridRow: 0,
        colSpan: 1,
        rowSpan,
        createdAt: at,
        updatedAt: at,
      });
    },
    findStaleCopyIds: async (projectId) =>
      database.charts
        .filter((chart) => chart.projectId === projectId && chart.kind === "dashboard_srcdoc")
        .map((chart) => chart.id),
    seedOnlyMeReportsBoard: async ({ dashboardId, createdById }) => {
      database.dashboards = database.dashboards.map((row) =>
        row.id === dashboardId ? { ...row, scope: "PRIVATE" as const, createdById } : row,
      );
    },
  };
}

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

export const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("dashboard-repository-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

export function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

/** A Postgres backend over two projects of one organization made for the suite. */
export function postgresBackend(namespace: string): DashboardBackend {
  let projectId = "";
  let otherProjectId = "";
  let organizationId = "";
  const projects = () => ({ in: [projectId, otherProjectId] });

  const clean = () =>
    cleanupTestRows(database(), [
      ["triggerSent", { projectId: projects() }],
      ["trigger", { projectId: projects() }],
      ["dashboardFavourite", { projectId: projects() }],
      ["dashboardWidget", { projectId: projects() }],
      ["dashboardsV2", { projectId: projects() }],
      ["customGraph", { projectId: projects() }],
      ["dashboard", { projectId: projects() }],
    ]);

  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await database().team.create({
      data: { name: namespace, slug: namespace, organizationId: organization.id },
    });
    const project = (slug: string) =>
      database().project.create({
        data: {
          name: slug,
          slug,
          apiKey: slug,
          teamId: team.id,
          language: "typescript",
          framework: "other",
        },
        select: { id: true },
      });
    projectId = (await project(`${namespace}-a`)).id;
    otherProjectId = (await project(`${namespace}-b`)).id;
  });

  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await cleanupTestRows(database(), [
      ["project", { id: projects() }],
      ["team", { slug: namespace }],
      ["organization", { slug: namespace }],
    ]);
  });

  return {
    boards: () => PrismaBoardRepository.create({ prisma: database() }),
    dashboards: () => PrismaDashboardRepository.create({ prisma: database() }),
    widgets: () => PrismaDashboardWidgetRepository.create({ prisma: database() }),
    projectId: () => projectId,
    otherProjectId: () => otherProjectId,
    organizationId: () => organizationId,
    seedStaleCopy: async (input) => {
      await database().customGraph.create({
        data: {
          ...input,
          name: "Usage",
          kind: DASHBOARD_SRCDOC_CHART_KIND,
          graph: { version: 1, code: WIDGET_INPUT.code, queries: [] },
        },
      });
    },
    findStaleCopyIds: async (projectId) => {
      const rows = await database().customGraph.findMany({
        where: { projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    seedOnlyMeReportsBoard: async ({ dashboardId, createdById }) => {
      await database().dashboard.update({
        where: { id: dashboardId },
        data: { scope: "PRIVATE", createdById },
      });
    },
  };
}
