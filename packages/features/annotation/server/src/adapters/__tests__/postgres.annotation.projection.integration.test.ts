/**
 * @vitest-environment node
 *
 * The annotations a page of traces carries. This one read feeds the trace
 * table, the export and the dataset columns, so it answers per trace with every
 * comment left on it, each one carrying the part of the trace it is about.
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

/**
 * The tenancy guard names a project on every query. This suite writes the rows
 * it then reads, so it composes the client without a guard rather than teaching
 * one about rows that do not exist yet.
 */
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
const traceId = `test-trace-annotation-projection-${nanoid()}`;

describe.skipIf(!databaseUrl)("annotations for a page of traces", () => {
  const service = PostgresAnnotationAdapter.create({
    database: prisma,
    projects: createAnnotationTestProjects(),
    organizations: createAnnotationTestOrganizations(),
  }).build();

  beforeAll(async () => {
    await prisma.annotation.create({
      data: {
        id: nanoid(),
        projectId,
        traceId,
        comment: "the whole trace is off",
      },
    });
    await prisma.annotation.create({
      data: {
        id: nanoid(),
        projectId,
        traceId,
        comment: "this search returned nothing",
        anchorKind: "span",
        anchorId: "span-search",
      },
    });
    await prisma.annotation.create({
      data: {
        id: nanoid(),
        projectId,
        traceId,
        comment: "this output is wrong",
        anchorKind: "field",
        anchorId: "span-search",
        anchorPath: "output",
      },
    });
    // A kind this build does not recognise still reads, as a comment about the
    // trace as a whole.
    await prisma.annotation.create({
      data: {
        id: nanoid(),
        projectId,
        traceId,
        comment: "left by a newer build",
        anchorKind: "gizmo",
        anchorId: "gizmo-1",
      },
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [["annotation", { projectId, traceId }]]);
  });

  describe("given a trace with one comment about it and three about its parts", () => {
    /** @scenario "A dataset column of annotations carries every comment, each naming its target" */
    it("carries every comment", async () => {
      const rows = await service.listForProjection({
        projectId,
        traceIds: [traceId],
        anchor: "all",
      });

      expect(rows.map((row) => row.comment).sort()).toEqual([
        "left by a newer build",
        "the whole trace is off",
        "this output is wrong",
        "this search returned nothing",
      ]);
    });

    it("carries the part of the trace each comment is about", async () => {
      const rows = await service.listForProjection({
        projectId,
        traceIds: [traceId],
        anchor: "all",
      });

      expect(rows.find((row) => row.comment === "this output is wrong")).toMatchObject({
        anchorKind: "field",
        anchorId: "span-search",
        anchorPath: "output",
      });
      expect(rows.find((row) => row.comment === "the whole trace is off")).toMatchObject({
        anchorKind: null,
        anchorId: null,
        anchorPath: null,
      });
    });
  });

  describe("given no traces on the page", () => {
    it("reads nothing", async () => {
      expect(
        await service.listForProjection({
          projectId,
          traceIds: [],
          anchor: "all",
        }),
      ).toEqual([]);
    });
  });
});
