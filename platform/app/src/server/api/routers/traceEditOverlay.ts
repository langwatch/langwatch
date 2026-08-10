import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { redactPatchForViewer } from "~/server/traces/edit-overlay/redactTraceEditOverlayPatch";
import { restoreWithheldEdits } from "~/server/traces/edit-overlay/restoreWithheldTraceEdits";
import { traceEditOverlayPatchSchema } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";
import type { Protections } from "~/server/traces/protections";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { getUserProtectionsForProject } from "../utils";

const logger = createLogger("langwatch:api:trace-edit-overlay");

/**
 * Whether the plan's visibility window teases this trace's content. Only free
 * plans have a window, so a plan without one answers without reading anything;
 * when there is one, the trace's own summary decides it, the same read the
 * drawer header uses. A summary that cannot be read answers "teased": a
 * correction quotes captured content, so a trace whose age we cannot establish
 * must not open it.
 */
async function isTraceWindowRedacted({
  projectId,
  traceId,
  protections,
}: {
  projectId: string;
  traceId: string;
  protections: Protections;
}): Promise<boolean> {
  const visibilityCutoffMs = protections.visibilityCutoffMs;
  if (visibilityCutoffMs === null || visibilityCutoffMs === undefined) {
    return false;
  }
  try {
    const summary = await getApp().traces.summary.getByTraceId(
      projectId,
      traceId,
      { visibilityCutoffMs, full: false },
    );
    return summary.redactedByVisibilityWindow === true;
  } catch (error) {
    logger.warn(
      { error, projectId, traceId },
      "trace summary unreadable; withholding corrected content",
    );
    return true;
  }
}

/**
 * Reviewer corrections for a trace.
 *
 * Reading one needs permission to view traces; writing one needs permission to
 * update annotations. Correcting a trace is review work, and external reviewers
 * hold annotation permissions rather than trace ones, which is the same family
 * the suggest-an-output flow already sits in.
 *
 * A correction quotes the trace it corrects, so the read applies the same
 * content gates the trace itself would: the caller's privacy policy and the
 * plan's visibility window decide which edits come back.
 */
export const traceEditOverlayRouter = createTRPCRouter({
  getByTraceId: protectedProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ ctx, input }) => {
      const overlay = await getApp().traces.editOverlay.getByTraceId({
        projectId: input.projectId,
        traceId: input.traceId,
      });
      if (!overlay) return null;

      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });
      const isWindowRedacted = await isTraceWindowRedacted({
        projectId: input.projectId,
        traceId: input.traceId,
        protections,
      });

      return {
        ...overlay,
        patch: redactPatchForViewer({
          patch: overlay.patch,
          protections,
          isWindowRedacted,
        }),
      };
    }),

  /**
   * Saves the correction, replacing the previous one.
   *
   * The saved patch is composed on top of what the read handed the caller, so
   * the edits withheld from them are carried over rather than dropped, and the
   * answer that goes back is redacted the same way the read is. Removing a
   * correction outright stays the separate, deliberate `delete`.
   */
  upsert: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        patch: traceEditOverlayPatchSchema,
      }),
    )
    .use(checkProjectPermission("annotations:update"))
    .mutation(async ({ ctx, input }) => {
      const editOverlay = getApp().traces.editOverlay;
      const stored = await editOverlay.getByTraceId({
        projectId: input.projectId,
        traceId: input.traceId,
      });

      // The first correction on a trace has nothing to carry over and nothing
      // to redact: the answer is the caller's own patch.
      if (!stored) {
        return editOverlay.upsert({
          projectId: input.projectId,
          traceId: input.traceId,
          patch: input.patch,
          userId: ctx.session.user.id,
        });
      }

      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });
      const isWindowRedacted = await isTraceWindowRedacted({
        projectId: input.projectId,
        traceId: input.traceId,
        protections,
      });

      const saved = await editOverlay.upsert({
        projectId: input.projectId,
        traceId: input.traceId,
        patch: restoreWithheldEdits({
          incoming: input.patch,
          stored: stored.patch,
          protections,
          isWindowRedacted,
        }),
        userId: ctx.session.user.id,
      });

      return {
        ...saved,
        patch: redactPatchForViewer({
          patch: saved.patch,
          protections,
          isWindowRedacted,
        }),
      };
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(checkProjectPermission("annotations:update"))
    .mutation(async ({ input }) => {
      await getApp().traces.editOverlay.delete({
        projectId: input.projectId,
        traceId: input.traceId,
      });
    }),
});
