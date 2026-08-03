import { definePipeline } from "../..";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import { logCommandGroupKey } from "./canonicalLog";
import { RecordCanonicalLogCommand } from "./commands/recordCanonicalLogCommand";
import { CanonicalLogStorageMapProjection } from "./projections/canonicalLogStorage.mapProjection";
import { LOG_COMMAND_COALESCE_MAX_BATCH } from "./schemas/constants";
import type { LogProcessingEvent } from "./schemas/events";
import type { CanonicalLogRecord } from "./schemas/logRecord";

export interface LogProcessingPipelineDeps {
  canonicalLogAppendStore: AppendStore<CanonicalLogRecord>;
  logCommandShardCount: number;
  /** Cross-pipeline dispatchers (e.g. coding-agent log-facts, ADR-056). */
  subscribers?: EventSubscriberDefinition<LogProcessingEvent>[];
}

export function createLogProcessingPipeline(deps: LogProcessingPipelineDeps) {
  let builder = definePipeline<LogProcessingEvent>()
    .withName("log_processing")
    .withAggregateType("log")
    .withMapProjection(
      "canonicalLogStorage",
      new CanonicalLogStorageMapProjection({
        store: deps.canonicalLogAppendStore,
        shardCount: deps.logCommandShardCount,
      }),
    );

  for (const subscriber of deps.subscribers ?? []) {
    builder = builder.withEventSubscriber(subscriber.name, subscriber);
  }

  return builder
    .withCommand("recordLogRecord", RecordCanonicalLogCommand, {
      getGroupKey: (payload) =>
        logCommandGroupKey(payload.recordId, deps.logCommandShardCount),
      // ADR-066 pillar 2: a shard funnels many records into one group, so a
      // backed-up shard appends one tiny insert per record. Coalesce its queued
      // records into one multi-row insert instead. Safe to fold: the handler
      // derives its event from its own command alone and never reads back a
      // same-batch append.
      coalesceMaxBatch: LOG_COMMAND_COALESCE_MAX_BATCH,
    })
    .build();
}
