/**
 * tRPC router for export progress subscriptions.
 *
 * Provides a real-time subscription that relays export progress events
 * from the BroadcastService (Redis pub/sub) to the client via SSE.
 * This replaces the custom in-memory progress-emitter approach,
 * enabling progress tracking across multi-instance Kubernetes deployments.
 */

import { on } from "node:events";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { checkProjectPermission, type Permission } from "../rbac";

const logger = createLogger("langwatch:api:export");

export const exportProgressEventSchema = z.object({
  exportId: z.string(),
  type: z.enum(["progress", "done", "error"]),
  exported: z.number().optional(),
  total: z.number().optional(),
  message: z.string().optional(),
});

export type ExportProgressEvent = z.infer<typeof exportProgressEventSchema>;

/**
 * Builds an export-progress subscription gated on a specific permission.
 *
 * Every export publishes to the same `export_progress` channel and is filtered
 * by `exportId`, so the relay is identical for all of them — only the
 * permission differs, because a scenario run export is authorized by
 * `scenarios:view` and a trace export by `traces:view`. Factored rather than
 * copied so the two cannot drift on filtering or teardown.
 */
function exportProgressSubscription(permission: Permission) {
  return protectedProcedure
    .input(z.object({ projectId: z.string(), exportId: z.string() }))
    .use(checkProjectPermission(permission))
    .subscription(async function* (opts) {
      const { projectId, exportId } = opts.input;
      const emitter = getApp().broadcast.getTenantEmitter(projectId);

      logger.info(
        { projectId, exportId },
        "Export progress subscription started",
      );

      try {
        for await (const eventArgs of on(emitter, "export_progress", {
          // @ts-expect-error - signal is not typed
          signal: opts.signal,
        })) {
          const event = eventArgs[0] as { event: string; timestamp: number };

          let parsed: ExportProgressEvent;
          try {
            parsed = JSON.parse(event.event) as ExportProgressEvent;
          } catch {
            logger.warn(
              { projectId, exportId },
              "Ignoring invalid export progress event",
            );
            continue;
          }

          // Only yield events for this specific export
          if (parsed.exportId !== exportId) continue;

          logger.debug(
            { projectId, exportId, event: parsed },
            "Export progress event received",
          );
          yield parsed;

          if (parsed.type === "done" || parsed.type === "error") {
            break;
          }
        }
      } finally {
        logger.debug(
          { projectId, exportId },
          "Export progress subscription cleanup",
        );
      }
    });
}

export const exportRouter = createTRPCRouter({
  /**
   * Trace export progress. Filters by exportId so a client only sees its own.
   */
  onExportProgress: exportProgressSubscription("traces:view"),

  /**
   * Scenario run export progress. Same relay, gated on `scenarios:view` — the
   * permission the export endpoint itself checks, so someone who can export
   * can also watch it finish.
   */
  onScenarioRunExportProgress: exportProgressSubscription("scenarios:view"),
});
