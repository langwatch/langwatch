/**
 * @vitest-environment node
 *
 * The correction row's write path. Prisma compiles an upsert on a table with a
 * second unique constraint into a SELECT followed by an INSERT, so two first
 * saves for the same trace can both decide to insert.
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { TraceEditOverlayRepository } from "../traceEditOverlay.repository";
import type { TraceEditOverlayPatch } from "../traceEditOverlay.schemas";

const patch: TraceEditOverlayPatch = {
  version: 1,
  spans: [{ spanId: "span-1", name: "cleaned up" }],
  deletedSpanIds: [],
};

const uniqueViolation = () =>
  Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

const row = { id: "traceedit_1", traceId: "trace-1" };

describe("saving a correction", () => {
  describe("when another reviewer inserts the first correction at the same moment", () => {
    /** @scenario "Two reviewers saving the first correction at once both succeed" */
    it("retries the losing insert as an update", async () => {
      const upsert = vi.fn().mockRejectedValueOnce(uniqueViolation());
      const update = vi.fn().mockResolvedValue(row);
      const repository = new TraceEditOverlayRepository({
        traceEditOverlay: { upsert, update },
      } as unknown as PrismaClient);

      const saved = await repository.upsert({
        projectId: "project-1",
        traceId: "trace-1",
        patch,
        userId: "user-1",
      });

      expect(saved).toBe(row);
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId_traceId: { projectId: "project-1", traceId: "trace-1" },
          },
          data: { patch, updatedById: "user-1" },
        }),
      );
    });
  });

  describe("when the write fails for any other reason", () => {
    it("surfaces the failure instead of retrying", async () => {
      const upsert = vi.fn().mockRejectedValue(new Error("connection lost"));
      const update = vi.fn();
      const repository = new TraceEditOverlayRepository({
        traceEditOverlay: { upsert, update },
      } as unknown as PrismaClient);

      await expect(
        repository.upsert({
          projectId: "project-1",
          traceId: "trace-1",
          patch,
          userId: "user-1",
        }),
      ).rejects.toThrow("connection lost");
      expect(update).not.toHaveBeenCalled();
    });
  });
});
