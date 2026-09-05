/**
 * @vitest-environment node
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestRows } from "@langwatch/test-harness";
import { PostgresAnnotationAdapter } from "../postgres.annotation.adapter";
import {
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
} from "./support/annotation-test-services";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const projectId = "test-project-id";
const traceId = `test-trace-annotation-list-${nanoid()}`;
const userId = `test-user-annotation-list-${nanoid()}`;

describe.skipIf(!databaseUrl)("annotations list, export and queueing", () => {
  const service = PostgresAnnotationAdapter.create({
    database: prisma,
    projects: createAnnotationTestProjects(),
    organizations: createAnnotationTestOrganizations(),
  }).build();

  const spanIds = ["span-1", "span-2", "span-3"];
  const everyComment = ["about span-1", "about span-2", "about span-3", "the whole trace is off"];

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId } });
    await prisma.annotation.create({
      data: { id: nanoid(), projectId, traceId, comment: "the whole trace is off" },
    });
    for (const spanId of spanIds) {
      await prisma.annotation.create({
        data: {
          id: nanoid(),
          projectId,
          traceId,
          comment: `about ${spanId}`,
          anchorKind: "span",
          anchorId: spanId,
        },
      });
    }
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["annotation", { projectId, traceId }],
      ["annotationQueueItem", { projectId, traceId }],
    ]);
    await prisma.user.delete({ where: { id: userId } });
  });

  describe("given a trace with one comment about it and three about its spans", () => {
    /** @scenario "The project's annotations list holds every comment with its target named" */
    /** @scenario "Exporting the annotations list exports the rows the list shows" */
    it("lists and exports all four comments, each naming what it is about", async () => {
      const listed = await service.list({ projectId, traceIds: [traceId], anchor: "all" });

      expect(listed.map((row) => row.comment).sort()).toEqual(everyComment);
      // The export is taken from the rows the list holds, so it carries the
      // same four rows and the same anchors.
      expect(
        listed
          .filter((row) => row.anchorKind === "span")
          .map((row) => row.anchorId)
          .sort(),
      ).toEqual(spanIds);
    });

    /** @scenario "A comment on one part of a trace never becomes a queue item" */
    it("creates no queue item merely from commenting on the trace's spans", async () => {
      expect(await prisma.annotationQueueItem.count({ where: { projectId, traceId } })).toBe(0);
    });

    /** @scenario "Sending a commented trace to a queue sends the trace once" */
    it("holds exactly one queue item after one createQueueItems call", async () => {
      await service.createQueueItems({
        projectId,
        traceIds: [traceId],
        queueIds: [],
        userIds: [userId],
        createdByUserId: userId,
      });

      expect(await prisma.annotationQueueItem.count({ where: { projectId, traceId } })).toBe(1);
    });
  });
});
