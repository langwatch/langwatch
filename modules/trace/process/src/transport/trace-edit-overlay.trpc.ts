/**
 * The server half of `traceEditOverlay.*`. Reading needs `traces:view`,
 * writing `annotations:update`. Transport only — the two redaction rules
 * are the same functions the legacy trace read applies.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { TraceApi, traceEditOverlayTrpc } from "@langwatch/trace-contract";

import { redactPatchForViewer } from "../rules/trace-edit-overlay-redaction.rules.ts";
import { restoreWithheldEdits } from "../rules/trace-edit-overlay-restore.rules.ts";

export const traceEditOverlayTrpcTransport = defineTrpcRouter(TraceApi, traceEditOverlayTrpc)
  .procedure("getByTraceId")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const overlay = await app.findTraceEditOverlay({
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
      patch: redactPatchForViewer({
        patch: overlay.patch,
        protections,
        isWindowRedacted,
      }),
    };
  })

  .procedure("upsert")
  .withPermission("annotations:update")
  .handle(async ({ app, input, actor }) => {
    const stored = await app.findTraceEditOverlay({
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
        patch: restoreWithheldEdits({
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
      patch: redactPatchForViewer({
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
