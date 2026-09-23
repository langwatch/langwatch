import {
  type AppendStore,
  defineAggregate,
  defineEventingModule,
  defineEvents,
  definePipeline,
  type EventingSetup,
  type EventSubscriberDefinition,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  type CanonicalLogRecord,
  type LogProcessingEvent,
  LOG_COMMAND_COALESCE_MAX_BATCH,
  LOG_PROCESSING_EVENT_TYPES,
  LOG_PROCESSING_PIPELINE_NAME,
  type RecordCanonicalLogCommandData,
} from "@langwatch/log-contract";

import type { LogApp } from "../app/log.app.ts";
import type { CanonicalLogRecordAppendRepository } from "../repositories/canonical-log-record-append.repository.ts";
import { CanonicalLogAdapter } from "../services/canonical-log.service.ts";
import { CanonicalLogRecordStore } from "./canonical-log-record.store.ts";
import { CanonicalLogStorageMapProjection } from "./canonical-log-storage.projection.ts";
import { RecordCanonicalLogCommand } from "./log.intent.ts";

export interface LogProcessingPipelineDeps {
  canonicalLogAppendStore: AppendStore<CanonicalLogRecord>;
  logCommandShardCount: number;
  /** Cross-pipeline dispatchers (e.g. coding-agent log-facts, ADR-056). */
  subscribers?: EventSubscriberDefinition<LogProcessingEvent>[];
}

export interface LogProcessingAdapterOptions {
  repository: CanonicalLogRecordAppendRepository;
  defaultRetentionDays: number;
  logCommandShardCount: number;
  subscribers?: EventSubscriberDefinition<LogProcessingEvent>[];
}

export type LogProcessingPipeline = StaticPipelineDefinition<
  LogProcessingEvent,
  Record<string, Projection>,
  { name: "recordLogRecord"; payload: RecordCanonicalLogCommandData }
>;

export function createLogProcessingPipeline(
  deps: LogProcessingPipelineDeps,
): LogProcessingPipeline {
  let builder = definePipeline<LogProcessingEvent>({
    name: LOG_PROCESSING_PIPELINE_NAME,
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
        CanonicalLogAdapter.logCommandGroupKey(payload.recordId, deps.logCommandShardCount),
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

  build(): LogProcessingPipeline {
    return createLogProcessingPipeline({
      canonicalLogAppendStore: CanonicalLogRecordStore.create(
        this.options.repository,
        this.options.defaultRetentionDays,
      ),
      logCommandShardCount: this.options.logCommandShardCount,
      subscribers: this.options.subscribers,
    });
  }
}

/**
 * The registration: the app builds the definition and the senders are bound back once built
 * (ADR-144). Cross-pipeline subscribers wait for the peer's `*Api` operation.
 * @see modules/log/adrs/001-log-processing-boundary.md
 */
export const logEventing = defineEventingModule({
  pipeline: LOG_PROCESSING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, LogApp>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
