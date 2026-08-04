/**
 * @vitest-environment node
 *
 * Service behavior around the stored correction: validation on write, merging
 * an output-only correction into an existing one, and degrading a stored patch
 * this build cannot interpret.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  TraceEditOverlayRepository,
  TraceEditOverlayRow,
} from "../traceEditOverlay.repository";
import type { TraceEditOverlayPatch } from "../traceEditOverlay.schemas";
import { TraceEditOverlayService } from "../traceEditOverlay.service";

const row = (patch: unknown): TraceEditOverlayRow =>
  ({
    id: "traceedit_1",
    projectId: "project-1",
    traceId: "trace-1",
    patch,
    createdById: "user-1",
    updatedById: "user-1",
    createdAt: new Date("2026-08-04T00:00:00.000Z"),
    updatedAt: new Date("2026-08-04T00:00:00.000Z"),
    createdBy: { id: "user-1", name: "First Reviewer", image: null },
    updatedBy: { id: "user-1", name: "First Reviewer", image: null },
  }) as TraceEditOverlayRow;

const buildService = (stored: unknown | null) => {
  const upsert = vi.fn(async ({ patch }: { patch: TraceEditOverlayPatch }) =>
    row(patch),
  );
  const repository = {
    findByProjectAndTrace: vi.fn(async () => (stored ? row(stored) : null)),
    findAllByProjectAndTraces: vi.fn(async () => (stored ? [row(stored)] : [])),
    upsert,
    delete: vi.fn(async () => undefined),
  } as unknown as TraceEditOverlayRepository;

  return {
    service: new TraceEditOverlayService(repository),
    repository,
    upsert,
  };
};

describe("TraceEditOverlayService", () => {
  describe("given a stored correction that deletes and renames spans", () => {
    /** @scenario "Merging a suggested output preserves the rest of the correction" */
    it("keeps the deletion and the rename when an output-only correction merges in", async () => {
      const { service, upsert } = buildService({
        version: 1,
        spans: [{ spanId: "span-1", name: "cleaned up" }],
        deletedSpanIds: ["span-noise"],
      });

      const merged = await service.mergeTraceOutputEdit({
        projectId: "project-1",
        traceId: "trace-1",
        output: "the right answer",
        userId: "user-2",
      });

      expect(merged.patch.trace?.output).toEqual({
        value: "the right answer",
      });
      expect(merged.patch.deletedSpanIds).toEqual(["span-noise"]);
      expect(merged.patch.spans).toEqual([
        { spanId: "span-1", name: "cleaned up" },
      ]);
      expect(upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a trace with no correction yet", () => {
    it("starts a correction holding only the suggested output", async () => {
      const { service } = buildService(null);

      const merged = await service.mergeTraceOutputEdit({
        projectId: "project-1",
        traceId: "trace-1",
        output: "the right answer",
        userId: "user-2",
      });

      expect(merged.patch).toEqual({
        version: 1,
        trace: { output: { value: "the right answer" } },
        spans: [],
        deletedSpanIds: [],
      });
    });
  });

  describe("given a stored patch this build cannot interpret", () => {
    it("reads as no correction", async () => {
      const { service } = buildService({ version: 99 });

      expect(
        await service.getByTraceId({
          projectId: "project-1",
          traceId: "trace-1",
        }),
      ).toBeNull();
    });

    it("is left out of the batch read", async () => {
      const { service } = buildService({ version: 99 });

      const patches = await service.getPatchesByTraceIds({
        projectId: "project-1",
        traceIds: ["trace-1"],
      });

      expect(patches.size).toBe(0);
    });

    it("is replaced wholesale rather than merged into", async () => {
      const { service } = buildService({ version: 99 });

      const merged = await service.mergeTraceOutputEdit({
        projectId: "project-1",
        traceId: "trace-1",
        output: "the right answer",
        userId: "user-2",
      });

      expect(merged.patch.spans).toEqual([]);
      expect(merged.patch.trace?.output).toEqual({
        value: "the right answer",
      });
    });
  });

  describe("when saving a correction that changes nothing", () => {
    it("rejects it and never writes", async () => {
      const { service, upsert } = buildService(null);

      await expect(
        service.upsert({
          projectId: "project-1",
          traceId: "trace-1",
          patch: { version: 1, spans: [], deletedSpanIds: [] },
          userId: "user-1",
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe("when saving a correction that is not shaped like a trace", () => {
    it("rejects it and never writes", async () => {
      const { service, upsert } = buildService(null);

      await expect(
        service.upsert({
          projectId: "project-1",
          traceId: "trace-1",
          patch: {
            version: 1,
            spans: [{ spanId: "span-1", input: { type: "nope", value: 1 } }],
            deletedSpanIds: [],
          },
          userId: "user-1",
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
      expect(upsert).not.toHaveBeenCalled();
    });
  });
});
