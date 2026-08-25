/**
 * @vitest-environment node
 *
 * The annotations a page of traces carries. This one read feeds the trace
 * table, the export and the dataset columns, so it answers per trace with every
 * comment left on it, each one carrying the part of the trace it is about.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { AnnotationService } from "../annotation.service";

const projectId = "test-project-id";
const traceId = `test-trace-annotation-projection-${nanoid()}`;

describe("annotations for a page of traces", () => {
  const service = AnnotationService.create({ prisma });

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
      const rows = await service.getAllForProjection({
        projectId,
        traceIds: [traceId],
      });

      expect(rows.map((row) => row.comment).sort()).toEqual([
        "left by a newer build",
        "the whole trace is off",
        "this output is wrong",
        "this search returned nothing",
      ]);
    });

    it("carries the part of the trace each comment is about", async () => {
      const rows = await service.getAllForProjection({
        projectId,
        traceIds: [traceId],
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
        await service.getAllForProjection({
          projectId,
          traceIds: [],
        }),
      ).toEqual([]);
    });
  });
});
