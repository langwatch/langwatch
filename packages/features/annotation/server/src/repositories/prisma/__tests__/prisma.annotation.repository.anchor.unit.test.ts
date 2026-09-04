/**
 * See specs/traces-v2/anchored-comments.feature.
 */
import { describe, expect, it, vi } from "vitest";
import type { AnnotationDatabase } from "../prisma.annotation.repository";
import { PrismaAnnotationRepository } from "../prisma.annotation.repository";

const NOW = new Date("2026-01-01T00:00:00Z");

function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "annotation-1",
    projectId: "project-1",
    traceId: "trace-1",
    comment: "a comment",
    isThumbsUp: null,
    userId: "user-1",
    email: null,
    scoreOptions: {},
    expectedOutput: null,
    anchorKind: null,
    anchorId: null,
    anchorPath: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function fakeDatabase(create: ReturnType<typeof vi.fn>): AnnotationDatabase {
  return { annotation: { create } } as unknown as AnnotationDatabase;
}

describe("PrismaAnnotationRepository.create anchoring", () => {
  describe("given a comment left on a span", () => {
    /** @scenario Commenting on a span records the span it was left on */
    it("stores the span anchor and copies nothing the span held", async () => {
      const create = vi.fn().mockResolvedValue(
        baseRow({ anchorKind: "span", anchorId: "span-search" }),
      );
      const repository = PrismaAnnotationRepository.create(fakeDatabase(create));

      const result = await repository.create({
        id: "annotation-1",
        projectId: "project-1",
        traceId: "trace-1",
        userId: "user-1",
        comment: "this search returned nothing",
        isThumbsUp: null,
        expectedOutput: null,
        anchorKind: "span",
        anchorId: "span-search",
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            anchorKind: "span",
            anchorId: "span-search",
            anchorPath: null,
          }),
        }),
      );
      expect(result.anchorKind).toBe("span");
      expect(result.anchorId).toBe("span-search");
      expect(result.anchorPath).toBeNull();
    });
  });

  describe("given a comment left on a span's field", () => {
    /** @scenario Commenting on a span's output records the field it was left on */
    it("stores the field separately for input and output", async () => {
      const create = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(baseRow({ ...data, email: null })),
      );
      const repository = PrismaAnnotationRepository.create(fakeDatabase(create));

      const onOutput = await repository.create({
        id: "annotation-output",
        projectId: "project-1",
        traceId: "trace-1",
        userId: "user-1",
        comment: "the output is wrong",
        isThumbsUp: null,
        expectedOutput: null,
        anchorKind: "field",
        anchorId: "span-search",
        anchorPath: "output",
      });
      const onInput = await repository.create({
        id: "annotation-input",
        projectId: "project-1",
        traceId: "trace-1",
        userId: "user-1",
        comment: "the query is wrong",
        isThumbsUp: null,
        expectedOutput: null,
        anchorKind: "field",
        anchorId: "span-search",
        anchorPath: "input",
      });

      expect(onOutput).toMatchObject({ anchorKind: "field", anchorPath: "output" });
      expect(onInput).toMatchObject({ anchorKind: "field", anchorPath: "input" });
    });
  });

  describe("given a comment left on the trace's own input, output or metadata", () => {
    /** @scenario Commenting on the trace's own input, output or metadata records which one */
    it("records which of the trace's own fields the comment is on", async () => {
      const create = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(baseRow({ ...data, email: null })),
      );
      const repository = PrismaAnnotationRepository.create(fakeDatabase(create));

      const results = await Promise.all(
        ["input", "output", "metadata.environment"].map((path, i) =>
          repository.create({
            id: `annotation-${i}`,
            projectId: "project-1",
            traceId: "trace-1",
            userId: "user-1",
            comment: `about ${path}`,
            isThumbsUp: null,
            expectedOutput: null,
            anchorKind: "field",
            anchorId: "trace-1",
            anchorPath: path,
          }),
        ),
      );

      expect(results.every((row) => row.anchorId === "trace-1")).toBe(true);
      expect(results.map((row) => row.anchorPath).sort()).toEqual([
        "input",
        "metadata.environment",
        "output",
      ]);
    });
  });

  describe("given a comment already anchored to a field", () => {
    /** @scenario A comment cannot be moved to another part of the trace */
    it("keeps the anchor when the comment is edited", async () => {
      const update = vi.fn().mockResolvedValue(
        baseRow({
          comment: "the output is wrong, here is why",
          anchorKind: "field",
          anchorId: "span-immutable",
          anchorPath: "output",
        }),
      );
      const database = { annotation: { update } } as unknown as AnnotationDatabase;
      const repository = PrismaAnnotationRepository.create(database);

      const updated = await repository.update({
        id: "annotation-1",
        projectId: "project-1",
        traceId: "trace-1",
        comment: "the output is wrong, here is why",
      });

      // The update payload never names anchorKind/anchorId/anchorPath —
      // updateAnnotationInputSchema is strict and carries no such field, so
      // there is no way an edit could move the anchor.
      const data = update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
      expect(data).not.toHaveProperty("anchorKind");
      expect(data).not.toHaveProperty("anchorId");
      expect(data).not.toHaveProperty("anchorPath");
      expect(updated.anchorKind).toBe("field");
      expect(updated.anchorId).toBe("span-immutable");
      expect(updated.anchorPath).toBe("output");
    });
  });

  describe("given a trace with a trace-level comment and three span comments", () => {
    /** @scenario The annotations API returns every annotation by default */
    it("returns all four annotations by default", async () => {
      const rows = [
        baseRow({ id: "a-trace", anchorKind: null, anchorId: null, anchorPath: null }),
        baseRow({ id: "a-span-1", anchorKind: "span", anchorId: "span-1" }),
        baseRow({ id: "a-span-2", anchorKind: "span", anchorId: "span-2" }),
        baseRow({ id: "a-span-3", anchorKind: "span", anchorId: "span-3" }),
      ];
      const findMany = vi.fn().mockResolvedValue(rows);
      const database = { annotation: { findMany } } as unknown as AnnotationDatabase;
      const repository = PrismaAnnotationRepository.create(database);

      const all = await repository.list({ projectId: "project-1", traceIds: ["trace-1"] });

      expect(all.map((a) => a.id)).toEqual(["a-trace", "a-span-1", "a-span-2", "a-span-3"]);
      // No anchor filter narrowed the read; "all" is the unfiltered default.
      expect(findMany.mock.calls[0]?.[0]?.where).not.toHaveProperty("anchorKind");
    });

    it("narrows to the trace-level comment only when asked", async () => {
      const findMany = vi.fn().mockResolvedValue([
        baseRow({ id: "a-trace", anchorKind: null, anchorId: null, anchorPath: null }),
      ]);
      const database = { annotation: { findMany } } as unknown as AnnotationDatabase;
      const repository = PrismaAnnotationRepository.create(database);

      const traceOnly = await repository.list({
        projectId: "project-1",
        traceIds: ["trace-1"],
        anchor: "trace",
      });

      expect(traceOnly.map((a) => a.id)).toEqual(["a-trace"]);
      expect(findMany.mock.calls[0]?.[0]?.where).toMatchObject({ anchorKind: null });
    });
  });
});
