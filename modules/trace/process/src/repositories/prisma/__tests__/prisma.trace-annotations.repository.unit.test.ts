/**
 * @vitest-environment node
 * Trace reads annotation's rows and score names through annotation's shared tables (R40).
 * Spec: modules/trace/specs/trace-annotations.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaTraceAnnotationScoresRepository } from "../prisma.trace-annotation-scores.repository.ts";
import { PrismaTraceAnnotationsRepository } from "../prisma.trace-annotations.repository.ts";

const PROJECT = "project-1";
const QUALITY = "score-quality";

const traceAnchored = {
  id: "ann-1",
  traceId: "trace-1",
  isThumbsUp: true,
  comment: "looks right",
  expectedOutput: null,
  scoreOptions: { [QUALITY]: { value: "5", reason: "accurate" } },
  createdAt: new Date("2026-10-01T10:00:00.000Z"),
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
};
const spanAnchored = {
  ...traceAnchored,
  id: "ann-2",
  traceId: "trace-2",
  isThumbsUp: null,
  comment: "the tool call was wrong",
  scoreOptions: null,
  createdAt: new Date("2026-10-01T11:00:00.000Z"),
  anchorKind: "span",
  anchorId: "span-7",
  anchorPath: null,
};

describe("given annotation's shared Annotation table", () => {
  describe("when trace reads the annotations of a page's traces", () => {
    /** @scenario "Trace reads every annotation on a page's traces, oldest first, whatever its anchor" */
    it("asks that project's rows on those traces oldest first, and keeps scores keyed by id", async () => {
      const findMany = vi.fn().mockResolvedValue([traceAnchored, spanAnchored]);
      const repository = PrismaTraceAnnotationsRepository.create({
        prisma: prismaDouble({ annotation: { findMany } }),
      });

      const rows = await repository.findForTraces({
        projectId: PROJECT,
        traceIds: ["trace-1", "trace-2"],
      });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: PROJECT, traceId: { in: ["trace-1", "trace-2"] } },
          orderBy: { createdAt: "asc" },
        }),
      );
      expect(rows).toEqual([traceAnchored, { ...spanAnchored, scoreOptions: {} }]);
    });
  });
});

describe("given annotation's shared AnnotationScore table", () => {
  describe("when trace reads the project's score names", () => {
    /** @scenario "A soft-deleted score definition still names its old results" */
    it("asks every definition of the project, with no deletion filter", async () => {
      const findMany = vi.fn().mockResolvedValue([
        { id: QUALITY, name: "quality" },
        { id: "score-retired", name: "retired" },
      ]);
      const repository = PrismaTraceAnnotationScoresRepository.create({
        prisma: prismaDouble({ annotationScore: { findMany } }),
      });

      const names = await repository.findScoreNames({ projectId: PROJECT });

      expect(findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT },
        select: { id: true, name: true },
      });
      expect(names).toEqual([
        { id: QUALITY, name: "quality" },
        { id: "score-retired", name: "retired" },
      ]);
    });
  });
});
