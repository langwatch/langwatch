import type { Command, CommandHandler } from "@langwatch/eventing";
import {
  type AppendStore,
  createTenantId,
  defineAggregate,
  defineCommandSchema,
  defineEvents,
  definePipeline,
  type EventSubscriberDefinition,
  EventUtils,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type {
  CanonicalLogRecord,
  CanonicalLogRecordReceivedEvent,
  LogProcessingEvent,
} from "@langwatch/log-contract";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  LOG_COMMAND_COALESCE_MAX_BATCH,
  LOG_PROCESSING_EVENT_TYPES,
  RECORD_CANONICAL_LOG_COMMAND_TYPE,
  type RecordCanonicalLogCommandData,
  recordCanonicalLogCommandDataSchema,
} from "@langwatch/log-contract";
import { CanonicalLogStorageMapProjection } from "../projections/canonical-log-storage.projection";
import type { CanonicalLogRecordAppendRepository } from "../repositories/canonical-log-record-append.repository";
import { CanonicalLogRecordStore } from "../stores/eventing/eventing.canonical-log-record.store";
import { CanonicalLogAdapter } from "./canonical-log.adapter";

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

function createLogProcessingPipeline(deps: LogProcessingPipelineDeps): LogProcessingPipeline {
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

export { createLogProcessingPipeline };

export class RecordCanonicalLogCommand implements CommandHandler<
  Command<RecordCanonicalLogCommandData>,
  CanonicalLogRecordReceivedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_CANONICAL_LOG_COMMAND_TYPE,
    recordCanonicalLogCommandDataSchema,
    "Record one canonical OpenTelemetry log record",
  );

  handle(command: Command<RecordCanonicalLogCommandData>): CanonicalLogRecordReceivedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<CanonicalLogRecordReceivedEvent>({
        aggregateType: "log",
        aggregateId: data.recordId,
        tenantId: createTenantId(command.tenantId),
        type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
        version: CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        // Tenant-scoped like every other command's. A RecordId is a content
        // hash that already includes its tenant, so a collision is not
        // reachable today — but nothing states that invariant at this layer,
        // and a dedup key that silently depends on it would suppress another
        // tenant's work the day it changes.
        idempotencyKey: `${command.tenantId}:${data.recordId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordCanonicalLogCommandData): string {
    return payload.recordId;
  }

  static getSpanAttributes(
    payload: RecordCanonicalLogCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.log.record_id": payload.recordId,
      "payload.log.provider": payload.providerKind,
      "payload.log.severity": payload.severityNumber,
    };
  }
}
