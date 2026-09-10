/**
 * The server half of `traceEditOverlay.*`. Reading needs `traces:view`;
 * writing needs `annotations:update`, the same family the suggest-an-output
 * flow sits in. Transport only - the two redaction rules are the same
 * functions the legacy trace read applies.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { TraceApi, traceEditOverlayTrpc } from "@langwatch/trace-contract";

import { TraceEditOverlayRedactionService } from "../services/edit-overlay/trace-edit-overlay-redaction.service.ts";
import { TraceEditOverlayRestoreService } from "../services/edit-overlay/trace-edit-overlay-restore.service.ts";

export const traceEditOverlayTrpcTransport = defineTrpcRouter(TraceApi, traceEditOverlayTrpc)
  .procedure("getByTraceId")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const overlay = await app.readTraceEditOverlay({
      projectId: input.projectId,
      traceId: input.traceId,
    });
    if (!overlay) return null;

    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const isWindowRedacted = await app.isTraceWindowRedacted({
      projectId: input.projectId,
      traceId: input.traceId,
      visibilityCutoffMs: protections.visibilityCutoffMs,
    });

    return {
      ...overlay,
      patch: TraceEditOverlayRedactionService.redactPatchForViewer({
        patch: overlay.patch,
        protections,
        isWindowRedacted,
      }),
    };
  })

  .procedure("upsert")
  .withPermission("annotations:update")
  .handle(async ({ app, input, actor }) => {
    const stored = await app.readTraceEditOverlay({
      projectId: input.projectId,
      traceId: input.traceId,
    });

    // The first correction on a trace has nothing to carry over and nothing
    // to redact: the answer is the caller's own patch.
    if (!stored) {
      return app.saveTraceEditOverlay(
        { projectId: input.projectId, traceId: input.traceId, patch: input.patch },
        { id: actor.id },
      );
    }

    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const isWindowRedacted = await app.isTraceWindowRedacted({
      projectId: input.projectId,
      traceId: input.traceId,
      visibilityCutoffMs: protections.visibilityCutoffMs,
    });

    const saved = await app.saveTraceEditOverlay(
      {
        projectId: input.projectId,
        traceId: input.traceId,
        patch: TraceEditOverlayRestoreService.restoreWithheldEdits({
          incoming: input.patch,
          stored: stored.patch,
          protections,
          isWindowRedacted,
        }),
      },
      { id: actor.id },
    );

    return {
      ...saved,
      patch: TraceEditOverlayRedactionService.redactPatchForViewer({
        patch: saved.patch,
        protections,
        isWindowRedacted,
      }),
    };
  })

  .procedure("delete")
  .withPermission("annotations:update")
  .handle(async ({ app, input }) => {
    await app.deleteTraceEditOverlay({ projectId: input.projectId, traceId: input.traceId });
  })
  .build();
