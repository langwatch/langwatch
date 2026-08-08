/**
 * @vitest-environment node
 *
 * The annotations a page of traces carries. This one read feeds the trace
 * table, the export and the dataset columns, so it answers per trace: a comment
 * left on one span of a trace is not part of what the trace says.
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
    // A kind this build does not recognise is not a comment about the whole
    // trace either, so it stays out of a per-trace answer.
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
    it("carries only the comment about the trace", async () => {
      const rows = await service.getAllTraceLevelForProjection({
        projectId,
        traceIds: [traceId],
      });

      expect(rows.map((row) => row.comment)).toEqual([
        "the whole trace is off",
      ]);
    });
  });

  describe("given no traces on the page", () => {
    it("reads nothing", async () => {
      expect(
        await service.getAllTraceLevelForProjection({
          projectId,
          traceIds: [],
        }),
      ).toEqual([]);
    });
  });
});
