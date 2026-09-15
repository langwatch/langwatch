import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import {
  TraceSpanStorageClickHouseRepository,
  SpanStorageStore,
  type TraceSpanStorageRepository,
} from "@langwatch/trace-server";

/**
 * Staged but not mounted; builds the span-storage path from ClickHouse and
 * retention configuration.
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
}): TraceSpanStorageRepository {
  return TraceSpanStorageClickHouseRepository.create({
    resolveClient: options.resolveClickHouseClient,
    defaultRetentionDays: options.defaultRetentionDays,
  });
}
