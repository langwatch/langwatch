import { type Authorization, internalActor } from "@langwatch/actor";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { redactPatchForViewer } from "~/server/traces/edit-overlay/redactTraceEditOverlayPatch";
import { restoreWithheldEdits } from "~/server/traces/edit-overlay/restoreWithheldTraceEdits";
import { traceEditOverlayPatchSchema } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";
import type { Protections } from "~/server/traces/protections";
import { requireRouteAuthorization } from "../authorization";
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
  authorization,
  traceId,
  protections,
}: {
  /** Fences the summary read (ADR-144 block C). */
  authorization: Authorization;
  traceId: string;
  protections: Protections;
}): Promise<boolean> {
  const visibilityCutoffMs = protections.visibilityCutoffMs;
  if (visibilityCutoffMs === null || visibilityCutoffMs === undefined) {
    return false;
  }
  try {
    const summary = await getApp().traces.summary.getByTraceId({
      authorization,
      traceId,
      visibilityCutoffMs,
      full: false,
    });
    return summary.redactedByVisibilityWindow === true;
  } catch (error) {
    logger.warn(
      { error, traceId },
      "trace summary unreadable; withholding corrected content",
    );
    return true;
  }
}

/**
 * The proof the correction's own summary read is fenced by. A reviewer
 * holds annotation permissions, not trace ones, so the write procedures
 * mint no proof of their own: the server reads the summary for the project
 * the correction belongs to, own-only, to decide what the plan's window
 * withholds. The read widens through no grant, the same as before.
 */
function authorizeOverlaySummaryRead({
  projectId,
  route,
}: {
  projectId: string;
  route: string;
}): Promise<Authorization> {
  return getApp().authorization.authorizeInternal({
    actor: internalActor("api/routers/traceEditOverlay"),
    projectId,
    permission: "traces:view",
    purpose: { kind: "route", route },
  });
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
    .permission("traces:view")
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
        authorization: requireRouteAuthorization(ctx),
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
    .permission("annotations:update")
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
        authorization: await authorizeOverlaySummaryRead({
          projectId: input.projectId,
          route: "traceEditOverlay.upsert",
        }),
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
    .permission("annotations:update")
    .mutation(async ({ input }) => {
      await getApp().traces.editOverlay.delete({
        projectId: input.projectId,
        traceId: input.traceId,
      });
    }),
});
