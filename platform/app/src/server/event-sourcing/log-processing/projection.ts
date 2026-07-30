import type { ClickHouseClient } from "@langwatch/clickhouse";
import {
  type AggregateEvent,
  createMapExecutor,
  type Metrics,
} from "@langwatch/event-sourcing";
import { logRecord } from "./aggregate";
import { assertCanonicalLogStorageMountIsLegal } from "./mount";
import type { CanonicalLogRecord } from "./schema";
import { createCanonicalLogStore } from "./store";

const PROJECTION_NAME = "canonicalLogStorage";

/**
 * The `canonicalLogStorage` map projection (ADR-098 §2, ADR-105 §6).
 *
 * A map has no accumulator, and this one needs none: `logRecord.apply`
 * already *is* the identity map from event to record (`aggregate.ts`), so
 * `map(event)` below is a direct read of `event.data`, not a transformation.
 * The old pipeline's `mapLogRecordReceived` did exactly this and nothing
 * more. `eventTypes.includes` rather than an equality check against a single
 * literal, so this stays correct if the aggregate ever gains a second event
 * this projection should also store.
 *
 * There is deliberately no `withMapProjection`/`withFold` builder call here —
 * that mount point lives in `pipeline.ts` under ADR-102's static pipeline
 * builder, which has not been rewritten yet (only the aggregate declaration,
 * projection execution and storage layer have). What this module exposes is
 * the piece a future composition root needs: an executor already wired to
 * this pipeline's store, with its mount validated eagerly rather than left
 * for the builder to discover.
 */
export function createCanonicalLogStorageProjection(args: {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
}): ReturnType<typeof createMapExecutor<AggregateEvent, CanonicalLogRecord>> {
  assertCanonicalLogStorageMountIsLegal();

  const store = createCanonicalLogStore({ client: args.client });

  return createMapExecutor<AggregateEvent, CanonicalLogRecord>({
    store,
    map: (event) =>
      logRecord.eventTypes.includes(
        event.type as (typeof logRecord.eventTypes)[number],
      )
        ? (event.data as CanonicalLogRecord)
        : null,
    projectionName: PROJECTION_NAME,
    metrics: args.metrics,
  });
}
