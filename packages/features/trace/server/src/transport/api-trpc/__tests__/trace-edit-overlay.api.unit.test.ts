/**
 * @vitest-environment node
 *
 * The `traceEditOverlay.*` tRPC surface's authorization wiring: writing a
 * correction is annotation-update work, refused for a caller who may only
 * view the project (specs/traces-v2/trace-edit-overlay.feature).
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { TraceApp } from "#app/trace.app";

import {
  TraceEditOverlayTrpcApi,
  type TraceEditOverlayTrpcContext,
  type TraceEditOverlayTrpcPorts,
} from "../trace-edit-overlay.api";

function harness({ canUpdateAnnotations = true }: { canUpdateAnnotations?: boolean } = {}) {
  const trpc = initTRPC.context<TraceEditOverlayTrpcContext>().create();
  const authenticated = trpc.procedure;
  const policy = (permission: string) => (procedure: unknown) => {
    if (permission !== "annotations:update") return procedure as never;
    return (procedure as unknown as { use: (mw: unknown) => unknown }).use(
      ({ next }: { next: () => unknown }) => {
        if (!canUpdateAnnotations) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return next();
      },
    ) as never;
  };

  const readTraceEditOverlay = vi.fn(async () => null);
  const saveTraceEditOverlay = vi.fn(async (input: { patch: unknown }, actor: { id: string }) => ({
    traceId: "trace-1",
    patch: input.patch,
    createdBy: actor,
    updatedBy: actor,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const traces = {
    readTraceEditOverlay,
    saveTraceEditOverlay,
    deleteTraceEditOverlay: vi.fn(async () => undefined),
    isTraceWindowRedacted: vi.fn(async () => false),
  } as unknown as TraceApp;

  const ports: TraceEditOverlayTrpcPorts<{ visibilityCutoffMs?: number | null }> = {
    getViewerProtections: async () => ({}),
    redactPatchForViewer: ({ patch }) => patch,
    restoreWithheldEdits: ({ incoming }) => incoming,
  };

  const router = TraceEditOverlayTrpcApi.create(
    trpc,
    { protected: authenticated, policy },
    ports,
  );

  const caller = router.createCaller({
    app: { traces },
    actor: () => ({ id: "user-1" }),
  });

  return { caller, saveTraceEditOverlay };
}

describe("given a trace nobody has corrected", () => {
  describe("when a caller who may only view the project saves a correction", () => {
    /** @scenario "Saving a correction without permission to update annotations is refused" */
    it("refuses the write", async () => {
      const { caller, saveTraceEditOverlay } = harness({ canUpdateAnnotations: false });

      await expect(
        caller.upsert({
          projectId: "project-1",
          traceId: "trace-1",
          patch: {
            version: 1,
            spans: [{ spanId: "span-1", name: "not allowed" }],
            deletedSpanIds: [],
          },
        }),
      ).rejects.toThrow();
      expect(saveTraceEditOverlay).not.toHaveBeenCalled();
    });
  });

  describe("when a caller who may update annotations saves a correction", () => {
    it("stores it", async () => {
      const { caller, saveTraceEditOverlay } = harness({ canUpdateAnnotations: true });

      await caller.upsert({
        projectId: "project-1",
        traceId: "trace-1",
        patch: {
          version: 1,
          spans: [{ spanId: "span-1", name: "cleaned up" }],
          deletedSpanIds: [],
        },
      });

      expect(saveTraceEditOverlay).toHaveBeenCalledOnce();
    });
  });
});
