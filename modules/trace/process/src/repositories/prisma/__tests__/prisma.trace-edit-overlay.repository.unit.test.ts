/**
 * @vitest-environment node
 * Tests correction row writes: dual-constraint upserts can race into duplicate inserts.
 */

import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { Temporal } from "@langwatch/time";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { PrismaTraceEditOverlayRepository } from "../prisma.trace-edit-overlay.repository.ts";

const patch: TraceEditOverlayPatch = {
  version: 1,
  spans: [{ spanId: "span-1", name: "cleaned up" }],
  deletedSpanIds: [],
};

const uniqueViolation = () =>
  Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

const row = {
  id: "traceedit_1",
  projectId: "project-1",
  traceId: "trace-1",
  patch,
  createdById: "user-1",
  updatedById: "user-1",
  createdAt: new Date("2026-08-04T00:00:00.000Z"),
  updatedAt: new Date("2026-08-04T00:00:01.000Z"),
  createdBy: { id: "user-1", name: "First Reviewer", image: null },
  updatedBy: { id: "user-1", name: "Second Reviewer", image: null },
};

describe("saving a correction", () => {
  describe("when another reviewer inserts the first correction at the same moment", () => {
    /** @scenario "Two reviewers saving the first correction at once both succeed" */
    it("retries the losing insert as an update", async () => {
      const upsert = vi.fn().mockRejectedValueOnce(uniqueViolation());
      const update = vi.fn().mockResolvedValue(row);
      const repository = PrismaTraceEditOverlayRepository.create(
        prismaDouble({ traceEditOverlay: { upsert, update } }),
      );

      const saved = await repository.upsert({
        projectId: "project-1",
        traceId: "trace-1",
        patch,
        userId: "user-1",
      });

      expect(saved).toEqual({
        ...row,
        createdAt: Temporal.Instant.from("2026-08-04T00:00:00.000Z"),
        updatedAt: Temporal.Instant.from("2026-08-04T00:00:01.000Z"),
      });
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
      const repository = PrismaTraceEditOverlayRepository.create(
        prismaDouble({ traceEditOverlay: { upsert, update } }),
      );

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
