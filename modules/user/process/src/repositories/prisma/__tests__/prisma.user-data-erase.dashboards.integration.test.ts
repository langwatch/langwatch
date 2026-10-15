/**
 * @vitest-environment node
 *
 * The erasure against a real Postgres for the Dashboards tables: a person's Only me boards and
 * stars go, a board others can see stays without its author.
 * @see modules/user/specs/data-erasure.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaGdprUserDataEraseRepository } from "../prisma.user-data-erase.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `erase-${randomUUID()}`;
const SHARED_PROJECT = `${RUN}-shared`;

/** The erase is cross-tenant by design, so it runs unscoped. */
class AllowEraseQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}
const OWNED_PROJECT = `${RUN}-owned`;

describe.skipIf(!databaseUrl)("given a user's boards, widgets and stars in Dashboards", () => {
  let connection: PrismaConnection;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: new AllowEraseQueries(),
      logger: createLogger("langwatch:user-data-erase:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    userId = (await prisma.user.create({ data: { name: "Ada", email: `ada@${RUN}.test` } })).id;
    otherId = (await prisma.user.create({ data: { name: "Kay", email: `kay@${RUN}.test` } })).id;

    await prisma.dashboardsV2.createMany({
      data: [
        board("only-me", { createdById: userId, scope: "PRIVATE" }),
        board("shared", { createdById: userId, scope: "PROJECT" }),
        board("others", { createdById: otherId, scope: "PROJECT" }),
        board("owned", { createdById: otherId, scope: "PROJECT", projectId: OWNED_PROJECT }),
      ],
    });
    await prisma.dashboardWidget.createMany({
      data: [widget("only-me"), widget("shared"), widget("others"), widget("owned", OWNED_PROJECT)],
    });
    await prisma.dashboardFavourite.createMany({
      data: [
        star(userId, "only-me"),
        star(otherId, "only-me"),
        star(userId, "shared"),
        star(otherId, "shared"),
        star(otherId, "owned", OWNED_PROJECT),
      ],
    });

    await PrismaGdprUserDataEraseRepository.create({
      database: prisma,
    }).eraseUserAndOwnedResources({
      userId,
      projectIds: [OWNED_PROJECT],
      soleOwnedTeamIds: [],
      soleOwnedOrgIds: [],
    });
  });

  afterAll(async () => {
    const prisma = connection.client;
    const projectId = { in: [SHARED_PROJECT, OWNED_PROJECT] };
    await prisma.dashboardFavourite.deleteMany({ where: { projectId } });
    await prisma.dashboardWidget.deleteMany({ where: { projectId } });
    await prisma.dashboardsV2.deleteMany({ where: { projectId } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
    await prisma.$disconnect();
  });

  describe("when the user is erased", () => {
    /** @scenario "Erasing a user removes their Only me boards and their stars, and keeps shared boards" */
    it("removes their Only me board with its widget and stars, and their own stars", async () => {
      const prisma = connection.client;

      await expect(boardsOf(SHARED_PROJECT)).resolves.toEqual([
        { id: id("others"), createdById: otherId },
        { id: id("shared"), createdById: null },
      ]);
      await expect(
        prisma.dashboardWidget.findMany({
          where: { projectId: SHARED_PROJECT },
          select: { dashboardId: true },
          orderBy: { dashboardId: "asc" },
        }),
      ).resolves.toEqual([{ dashboardId: id("others") }, { dashboardId: id("shared") }]);
      await expect(
        prisma.dashboardFavourite.findMany({
          where: { projectId: SHARED_PROJECT },
          select: { userId: true, dashboardId: true },
        }),
      ).resolves.toEqual([{ userId: otherId, dashboardId: id("shared") }]);
    });

    /** @scenario "Erasing a user removes their Only me boards and their stars, and keeps shared boards" */
    it("removes the boards, widgets and stars of the project only they owned", async () => {
      const prisma = connection.client;
      const where = { projectId: OWNED_PROJECT };

      await expect(boardsOf(OWNED_PROJECT)).resolves.toEqual([]);
      await expect(prisma.dashboardWidget.count({ where })).resolves.toBe(0);
      await expect(prisma.dashboardFavourite.count({ where })).resolves.toBe(0);
    });
  });

  function boardsOf(projectId: string) {
    return connection.client.dashboardsV2.findMany({
      where: { projectId },
      select: { id: true, createdById: true },
      orderBy: { id: "asc" },
    });
  }
});

const id = (name: string) => `${RUN}-${name}`;

function board(
  name: string,
  fields: { createdById: string; scope: "PRIVATE" | "PROJECT"; projectId?: string },
) {
  return {
    id: id(name),
    projectId: fields.projectId ?? SHARED_PROJECT,
    name,
    createdById: fields.createdById,
    scope: fields.scope,
  };
}

function widget(boardName: string, projectId = SHARED_PROJECT) {
  return {
    id: `${id(boardName)}-widget`,
    projectId,
    dashboardId: id(boardName),
    name: "Widget",
    definition: {},
  };
}

function star(userId: string, boardName: string, projectId = SHARED_PROJECT) {
  return { userId, projectId, dashboardId: id(boardName), position: 0 };
}
