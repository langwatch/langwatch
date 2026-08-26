import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type EventSubscriberDefinition,
} from "@langwatch/eventing";
import { logCommandGroupKey } from "./canonical-log.adapter";
import { RecordCanonicalLogCommand } from "./record-canonical-log.adapter";
import { CanonicalLogStorageMapProjection } from "../projections/canonical-log-storage.projection";
import {
  LOG_COMMAND_COALESCE_MAX_BATCH,
  LOG_PROCESSING_EVENT_TYPES,
} from "@langwatch/telemetry-contract";
import type { LogProcessingEvent } from "./telemetry-event.adapter";
import type { CanonicalLogRecord } from "@langwatch/telemetry-contract";
import type { CanonicalLogRecordAppendPort } from "../ports/telemetry-repositories.port";
import { CanonicalLogAppendStore } from "../stores/log-record/log-record.store";

export interface LogProcessingPipelineDeps {
  canonicalLogAppendStore: AppendStore<CanonicalLogRecord>;
  logCommandShardCount: number;
  /** Cross-pipeline dispatchers (e.g. coding-agent log-facts, ADR-056). */
  subscribers?: EventSubscriberDefinition<LogProcessingEvent>[];
}

export interface LogProcessingAdapterOptions {
  repository: CanonicalLogRecordAppendPort;
  defaultRetentionDays: number;
  logCommandShardCount: number;
  subscribers?: EventSubscriberDefinition<LogProcessingEvent>[];
}

function createLogProcessingPipeline(deps: LogProcessingPipelineDeps) {
  let builder = definePipeline<LogProcessingEvent>({
    name: "log_processing",
    aggregate: defineAggregate({
      type: "log",
      events: defineEvents(LOG_PROCESSING_EVENT_TYPES),
    }),
  }).withClickHouseMapProjection(
    CanonicalLogStorageMapProjection.create({
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

export class LogProcessingAdapter {
  private constructor(private readonly options: LogProcessingAdapterOptions) {}

  static create(options: LogProcessingAdapterOptions): LogProcessingAdapter {
    return new LogProcessingAdapter(options);
  }

  build(): ReturnType<typeof createLogProcessingPipeline> {
    return createLogProcessingPipeline({
      canonicalLogAppendStore: CanonicalLogAppendStore.create(
        this.options.repository,
        this.options.defaultRetentionDays,
      ),
      logCommandShardCount: this.options.logCommandShardCount,
      subscribers: this.options.subscribers,
    });
  }
}

export { createLogProcessingPipeline };
