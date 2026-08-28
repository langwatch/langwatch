/**
 * App-process transport mount for export-progress subscriptions.
 *
 * Relays export progress events from the process's broadcast channel (Redis
 * pub/sub with a local fallback) to a browser over SSE, so progress survives a
 * multi-instance deployment where the exporting pod is not the pod the client
 * is connected to.
 *
 * This one owns its procedures rather than delegating to a feature package,
 * and deliberately so: the two subscriptions are one relay over a channel the
 * PROCESS owns, distinguished only by the permission each demands — a scenario
 * run export is authorized by `scenarios:view`, a trace export by
 * `traces:view`. Splitting them across the trace and scenario packages would
 * rename the wire surface (`export.onExportProgress` is what clients call),
 * and putting both in either package would make that feature own the other
 * feature's permission. See
 * `dev/docs/plans/core-application-exit-decisions-for-review.md`.
 */
import { on } from "node:events";
import type { EventEmitter } from "node:events";
import { createLogger } from "@langwatch/observability";
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

const logger = createLogger("langwatch:api:export");

export const exportProgressEventSchema = z.object({
  exportId: z.string(),
  type: z.enum(["progress", "done", "error"]),
  exported: z.number().optional(),
  total: z.number().optional(),
  message: z.string().optional(),
});

export type ExportProgressEvent = z.infer<typeof exportProgressEventSchema>;

/** Fan-out to every browser watching one tenant, as this relay reads it. */
export interface ExportProgressBroadcast {
  getTenantEmitter(tenantId: string): EventEmitter;
}

/** The request context this transport reads. */
export type ExportTrpcContext = Readonly<{
  app: Readonly<{ broadcast: ExportProgressBroadcast }>;
}>;

const subscriptionInputSchema = z.object({
  projectId: z.string(),
  exportId: z.string(),
});

/**
 * The event this subscription should relay, or null when the payload is not
 * ours to yield.
 *
 * Two reasons to drop one: it did not parse, or it belongs to a different
 * export. The channel is per-tenant, so every concurrent export in a project
 * lands here and the exportId is what separates them.
 */
function readProgressEvent({
  raw,
  exportId,
  projectId,
}: {
  raw: string;
  exportId: string;
  projectId: string;
}): ExportProgressEvent | null {
  let parsed: ExportProgressEvent;
  try {
    parsed = JSON.parse(raw) as ExportProgressEvent;
  } catch {
    logger.warn({ projectId, exportId }, "Ignoring invalid export progress event");
    return null;
  }

  return parsed.exportId === exportId ? parsed : null;
}

/** Mounts `export.*` on the app process's tRPC root. */
export function createExportTrpcRouter<
  TContext extends ExportTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  const { policy } = createTrpcApiService(mount);

  /**
   * Builds an export-progress subscription gated on a specific permission.
   *
   * Every export publishes to the same `export_progress` channel and is
   * filtered by `exportId`, so the relay is identical for all of them — only
   * the permission differs. Factored rather than copied so the two cannot
   * drift on filtering or teardown.
   */
  const exportProgressSubscription = (permission: "traces:view" | "scenarios:view") =>
    policy(permission)(mount.protectedProcedure.input(subscriptionInputSchema)).subscription(
      async function* (opts: {
        input: { projectId: string; exportId: string };
        ctx: TContext;
        signal?: AbortSignal;
      }) {
        const { projectId, exportId } = opts.input;
        const emitter = opts.ctx.app.broadcast.getTenantEmitter(projectId);

        logger.info({ projectId, exportId }, "Export progress subscription started");

        try {
          for await (const eventArgs of on(emitter, "export_progress", {
            signal: opts.signal,
          })) {
            const event = eventArgs[0] as { event: string; timestamp: number };

            const parsed = readProgressEvent({
              raw: event.event,
              exportId,
              projectId,
            });
            if (!parsed) continue;

            logger.debug({ projectId, exportId, event: parsed }, "Export progress event received");
            yield parsed;

            if (parsed.type === "done" || parsed.type === "error") {
              break;
            }
          }
        } finally {
          logger.debug({ projectId, exportId }, "Export progress subscription cleanup");
        }
      },
    );

  return mount.root.router({
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
}
