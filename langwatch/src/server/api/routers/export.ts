/**
 * tRPC router for export progress subscriptions.
 *
 * Provides a real-time subscription that relays export progress events
 * from the BroadcastService (Redis pub/sub) to the client via SSE.
 * This replaces the custom in-memory progress-emitter approach,
 * enabling progress tracking across multi-instance Kubernetes deployments.
 */

import { on } from "node:events";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { createLogger } from "~/utils/logger/server";
import { checkProjectPermission } from "../rbac";

const logger = createLogger("langwatch:api:export");

export const exportProgressEventSchema = z.object({
  exportId: z.string(),
  type: z.enum(["progress", "done", "error"]),
  exported: z.number().optional(),
  total: z.number().optional(),
  message: z.string().optional(),
});

export type ExportProgressEvent = z.infer<typeof exportProgressEventSchema>;

export const exportRouter = createTRPCRouter({
  /**
   * Subscribe to export progress events for a specific export.
   *
   * Filters events by exportId so the client only receives updates
   * for its own export. Terminates when the export completes or errors.
   */
  onExportProgress: protectedProcedure
    .input(z.object({ projectId: z.string(), exportId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .subscription(async function* (opts) {
      const { projectId, exportId } = opts.input;
      const emitter = getApp().broadcast.getTenantEmitter(projectId);

      logger.info({ projectId, exportId }, "Export progress subscription started");

      try {
        for await (const eventArgs of on(emitter, "export_progress", {
          // @ts-expect-error - signal is not typed
          signal: opts.signal,
        })) {
          const event = eventArgs[0] as { event: string; timestamp: number };
          const parsed = JSON.parse(event.event) as ExportProgressEvent;

          // Only yield events for this specific export
          if (parsed.exportId !== exportId) continue;

          logger.debug({ projectId, exportId, event: parsed }, "Export progress event received");
          yield parsed;

          if (parsed.type === "done" || parsed.type === "error") {
            break;
          }
        }
      } finally {
        logger.debug({ projectId, exportId }, "Export progress subscription cleanup");
      }
    }),
});
