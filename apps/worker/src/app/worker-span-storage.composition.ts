import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import {
  ClickHouseTraceSpanStorageAdapter,
  SpanStorageStore,
  type TraceSpanStoragePort,
} from "@langwatch/trace-server";

/**
 * The `stored_spans` write path this process would persist canonical spans
 * through.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still
 * registers the span-storage projection and still owns the repository that
 * backs it — so nothing in this process writes a span yet. What has to be true
 * today is that this composition root CAN build the path from substrates it
 * already holds: the tenant-keyed ClickHouse client the event store resolves
 * through, and the retention default that store already stamps its own rows
 * with. That is the whole dependency list. The application's
 * `SpanStorageService` additionally carries blob-offload resolution and the
 * read-side visibility gate, and asking a writer for those is what kept this
 * path unbuildable outside the application.
 *
 * The retention number is read from the event store's own configuration rather
 * than from a second environment variable, so the rows this process writes and
 * the rows the event store writes cannot expire on different days.
 */
export function createWorkerSpanStorage(options: {
  resolveClickHouseClient: EventingClickHouseClientResolver;
  defaultRetentionDays: number;
}): SpanStorageStore {
  return SpanStorageStore.create({
    storage: createWorkerSpanStoragePort(options),
    defaultRetentionDays: options.defaultRetentionDays,
  });
}

/** The write capability on its own, for a consumer that is not a projection store. */
export function createWorkerSpanStoragePort(options: {
  resolveClickHouseClient: EventingClickHouseClientResolver;
  defaultRetentionDays: number;
}): TraceSpanStoragePort {
  return ClickHouseTraceSpanStorageAdapter.create({
    resolveClient: options.resolveClickHouseClient,
    defaultRetentionDays: options.defaultRetentionDays,
  });
}
