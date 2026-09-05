/**
 * The saved-views tRPC surface's actual CRUD, against a real Postgres row.
 *
 * Lifted from
 * `platform/app/src/server/api/routers/__tests__/savedViews.integration.test.ts`
 * (deleted with `platform/app`); the lifecycle lives in
 * `SavedViewService` + `SavedViewRepository` in this package now, so this
 * suite drives the service directly rather than a mounted tRPC router.
 *
 * @see specs/traces/saved-views.feature
 */
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
import { PrismaSavedViewRepository } from "../prisma.saved-view.repository";
import { SavedViewService } from "../../../services/saved-view.service";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
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
    throw new Error("DATABASE_URL is required for saved view persistence tests");
  }
  return connection.client;
}

function service(): SavedViewService {
  return SavedViewService.create({
    repository: PrismaSavedViewRepository.create({ database: database() }),
  });
}

const namespace = `saved-view-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";

async function createProject(slug: string): Promise<string> {
  const project = await database().project.create({
    data: {
      name: slug,
      slug,
      apiKey: slug,
      teamId,
      language: "typescript",
      framework: "other",
    },
    select: { id: true },
  });
  return project.id;
}

describe.skipIf(!databaseUrl)("Saved view persistence", () => {
  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await database().team.create({
      data: { name: namespace, slug: namespace, organizationId },
    });
    teamId = team.id;
    projectId = await createProject(namespace);
  });

  beforeEach(async () => {
    await cleanupTestRows(database(), [["savedView", { projectId }]]);
  });

  afterAll(async () => {
    try {
      if (projectId) {
        await cleanupTestRows(database(), [
          ["savedView", { projectId }],
          ["project", { id: projectId }],
        ]);
        await database().team.delete({ where: { id: teamId } });
        await database().organization.delete({ where: { id: organizationId } });
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("getAll", () => {
    /** @scenario First-visit projects auto-seed and show All Traces plus 4 seed views */
    it("seeds views on first access for a project", async () => {
      const result = await service().getAll({ projectId });

      expect(result).toHaveLength(5);
      expect(result.map((v) => v.name)).toEqual([
        "Application",
        "Evaluations",
        "Simulations",
        "Playground",
        "Gateway",
      ]);
    });

    /** @scenario getAll returns views ordered by position */
    it("returns views ordered by the order field ascending", async () => {
      const result = await service().getAll({ projectId });

      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.order).toBeGreaterThanOrEqual(result[i - 1]!.order);
      }
    });
  });

  describe("createView", () => {
    /** @scenario create adds a new view at the end */
    it("adds a view whose order comes after every existing one", async () => {
      const before = await service().getAll({ projectId });
      const lastOrder = Math.max(...before.map((v) => v.order));

      const created = await service().createView({
        projectId,
        input: { name: "Custom View", filters: { "spans.model": ["gpt-4"] } },
      });

      expect(created.name).toBe("Custom View");
      expect(created.order).toBe(lastOrder + 1);
    });
  });

  describe("delete", () => {
    /** @scenario delete removes a view */
    it("removes the view from the database", async () => {
      const created = await service().createView({
        projectId,
        input: { name: "To Delete", filters: {} },
      });

      await service().delete({ projectId, viewId: created.id, userId: "user-1" });

      const all = await service().getAll({ projectId });
      expect(all.find((v) => v.id === created.id)).toBeUndefined();
    });
  });

  describe("rename", () => {
    /** @scenario rename updates the view name */
    it("updates the view name in the database", async () => {
      const created = await service().createView({
        projectId,
        input: { name: "Old Name", filters: {} },
      });

      const renamed = await service().rename({
        projectId,
        viewId: created.id,
        name: "New Name",
        userId: "user-1",
      });

      expect(renamed.name).toBe("New Name");
      expect(renamed.id).toBe(created.id);
    });
  });

  describe("reorder", () => {
    /** @scenario reorder updates the order of all views */
    it("updates the order field for each view and getAll reflects it", async () => {
      const viewA = await service().createView({
        projectId,
        input: { name: "View A", filters: {} },
      });
      const viewB = await service().createView({
        projectId,
        input: { name: "View B", filters: {} },
      });
      const viewC = await service().createView({
        projectId,
        input: { name: "View C", filters: {} },
      });

      await service().reorder({ projectId, viewIds: [viewC.id, viewA.id, viewB.id] });

      const result = await service().getAll({ projectId });
      const reordered = result
        .map((v) => v.name)
        .filter((name) => ["View A", "View B", "View C"].includes(name));
      expect(reordered).toEqual(["View C", "View A", "View B"]);
    });
  });
});
