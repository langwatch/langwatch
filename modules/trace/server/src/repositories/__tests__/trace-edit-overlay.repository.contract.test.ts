/**
 * @vitest-environment node
 * The reviewer-correction contract, stated once and run against every backend
 * the package can reach. The memory twin runs always; a Postgres backend
 * joins the table when this package declares a datastore in its vitest
 * config.
 */
import { describe, expect, it } from "vitest";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import { MemoryTraceEditOverlayRepository } from "../memory/memory.trace-edit-overlay.repository.ts";
import type { TraceEditOverlayRepository } from "../trace-edit-overlay.repository.ts";

const backends: ReadonlyArray<{ name: string; create: () => TraceEditOverlayRepository }> = [
  { name: "memory", create: () => MemoryTraceEditOverlayRepository.create() },
];

const patch: TraceEditOverlayPatch = {
  version: 1,
  spans: [{ spanId: "span-1", name: "cleaned up" }],
  deletedSpanIds: [],
};

describe.each(backends)("given the $name trace edit overlay repository", ({ create }) => {
  describe("when nobody has corrected the trace", () => {
    /** @scenario "The memory and Postgres trace edit overlay repositories answer alike" */
    it("answers absence for a trace nobody corrected", async () => {
      const repository = create();

      await expect(
        repository.tryFindByProjectAndTrace({ projectId: "project-1", traceId: "trace-1" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a reviewer saves the first correction", () => {
    it("stores it and reads it back with attribution", async () => {
      const repository = create();

      const saved = await repository.upsert({
        projectId: "project-1",
        traceId: "trace-1",
        patch,
        userId: "user-1",
      });

      expect(saved.createdById).toBe("user-1");
      expect(saved.updatedById).toBe("user-1");

      await expect(
        repository.tryFindByProjectAndTrace({ projectId: "project-1", traceId: "trace-1" }),
      ).resolves.toMatchObject({ traceId: "trace-1", patch });
    });
  });

  describe("when a second reviewer corrects the same trace again", () => {
    it("keeps the original creator and updates the reviser", async () => {
      const repository = create();
      const created = await repository.upsert({
        projectId: "project-1",
        traceId: "trace-1",
        patch,
        userId: "user-1",
      });

      const updated = await repository.upsert({
        projectId: "project-1",
        traceId: "trace-1",
        patch,
        userId: "user-2",
      });

      expect(updated.id).toBe(created.id);
      expect(updated.createdById).toBe("user-1");
      expect(updated.updatedById).toBe("user-2");
    });
  });

  describe("when reading corrections for several traces at once", () => {
    it("returns only the traces that were corrected", async () => {
      const repository = create();
      await repository.upsert({
        projectId: "project-1",
        traceId: "trace-1",
        patch,
        userId: "user-1",
      });

      const rows = await repository.findAllByProjectAndTraces({
        projectId: "project-1",
        traceIds: ["trace-1", "trace-uncorrected"],
      });

      expect(rows.map((row) => row.traceId)).toEqual(["trace-1"]);
    });
  });

  describe("when a correction is deleted", () => {
    it("reads back as absent", async () => {
      const repository = create();
      await repository.upsert({
        projectId: "project-1",
        traceId: "trace-1",
        patch,
        userId: "user-1",
      });

      await repository.delete({ projectId: "project-1", traceId: "trace-1" });

      await expect(
        repository.tryFindByProjectAndTrace({ projectId: "project-1", traceId: "trace-1" }),
      ).resolves.toBeNull();
    });
  });
});
