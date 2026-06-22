/**
 * ADR-032 Decision 5: the enqueue seam for the `datasetNormalize` GroupQueue
 * job.
 *
 * The dataset domain is still middleware-constructed (not on getApp), so the
 * job's registration lives in the event-sourcing `pipelineRegistry` (where the
 * GroupQueue is available) while the service that triggers a normalize only
 * holds `prisma`. This module is the thin process-wide seam between them,
 * mirroring `scheduleDeferred` in the trace pipeline:
 *
 *  - `registerDatasetNormalizeEnqueue(fn)` is resolved once at app init by the
 *    registry with a sender that `.send()`s onto the global queue.
 *  - `enqueueDatasetNormalize(...)` is what `DatasetService.finalizeUpload`
 *    calls. When the queue sender has been registered it dispatches onto it;
 *    otherwise (event sourcing disabled — no Redis — or a unit/dev process with
 *    no worker) it falls back to running the handler INLINE so the upload still
 *    normalizes end-to-end.
 *
 * Keeping the enqueue side here (rather than reaching into the registry from the
 * service) means the service depends on a small dataset-owned accessor, not on
 * the whole event-sourcing graph.
 */
import type { PrismaClient } from "@prisma/client";
import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger/server";
import { DatasetRepository } from "./dataset.repository";
import {
  createDatasetNormalizeHandler,
  type DatasetNormalizePayload,
} from "./dataset-normalize.job";
import { getDatasetStorage } from "./dataset-storage";

const logger = createLogger("langwatch:datasets:normalize:queue");

type Enqueue = (payload: DatasetNormalizePayload) => Promise<void>;

let registeredEnqueue: Enqueue | null = null;

/**
 * Latches the first inline-normalize warning per process. Without a queue sender
 * the warn condition is true for EVERY upload (S3-yes/Redis-no deploy, or the
 * narrow registry-init window on a rolling deploy), so a per-call warn would burst
 * identical WARN lines into production observability. Warn once per process
 * instead — a persistent misconfiguration belongs in a metric/healthcheck, not a
 * per-upload log line.
 */
let hasWarnedNoQueue = false;

/**
 * Wire the real GroupQueue sender. Called once by the pipeline registry at app
 * init; idempotent-safe to overwrite (registry runs once per process).
 */
export const registerDatasetNormalizeEnqueue = (fn: Enqueue): void => {
  registeredEnqueue = fn;
};

/**
 * The inline fallback handler, built from `prisma` + the storage accessor. Used
 * when no queue sender is registered (event sourcing disabled / no worker), so
 * dev and test still produce a `ready` dataset.
 */
const runInline = (prisma: PrismaClient): Enqueue => {
  const handler = createDatasetNormalizeHandler({
    repository: new DatasetRepository(prisma),
    getStorage: getDatasetStorage,
  });
  return (payload) => handler(payload);
};

/**
 * Enqueue (or inline-run) a dataset normalize. The service passes `prisma` so
 * the inline fallback can construct its own repository without this module
 * reaching for a module-global client.
 */
export const enqueueDatasetNormalize = async (params: {
  prisma: PrismaClient;
  payload: DatasetNormalizePayload;
}): Promise<void> => {
  if (!registeredEnqueue && env.NODE_ENV === "production" && !hasWarnedNoQueue) {
    // No queue sender registered in production means event sourcing / the worker
    // isn't wired — normalize runs INLINE in the request thread. Fine for a
    // single small pod, but on an S3-yes / Redis-no multi-pod deploy this blocks
    // the request and won't scale. Surface it ONCE per process (not per upload)
    // so the misconfiguration is visible without bursting the logs.
    hasWarnedNoQueue = true;
    logger.warn(
      {
        datasetId: params.payload.datasetId,
        projectId: params.payload.projectId,
      },
      "dataset normalize running in-request (no queue/worker registered); configure event sourcing + a worker for off-request processing",
    );
  }
  const enqueue = registeredEnqueue ?? runInline(params.prisma);
  await enqueue(params.payload);
};
