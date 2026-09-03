import {
  INGESTION_PULL_AGGREGATE_TYPE,
  INGESTION_PULL_COMMAND_TYPES,
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
  INGESTION_PULL_PROCESSING_EVENT_TYPES,
  ingestionPullConfiguredCommandDataSchema,
  ingestionPullDisabledEventDataSchema,
  ingestionPullRunCompletedEventDataSchema,
  ingestionPullRunFailedEventDataSchema,
  type IngestionPullProcessingEvent,
} from "@langwatch/enterprise-governance-contract";
import {
  defineAggregate,
  defineCommand,
  defineEvents,
  definePipeline,
  type Event,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  type IngestionPullRunStatusData,
  IngestionPullRunStatusEventingProjection,
} from "../projections/ingestion-pull-run-status-eventing.projection";
import {
  INGESTION_PULL_PROCESS_NAME,
  IngestionPullProcess,
} from "../processes/ingestion-pull.process";

type EventingIngestionPullEvent = IngestionPullProcessingEvent & Event;

export type IngestionPullEventingAdapterOptions = {
  runStatusStore: StateProjectionStore<IngestionPullRunStatusData>;
  process: IngestionPullProcess;
};

export class IngestionPullEventingAdapter {
  private constructor(private readonly options: IngestionPullEventingAdapterOptions) {}

  static create(options: IngestionPullEventingAdapterOptions): IngestionPullEventingAdapter {
    return new IngestionPullEventingAdapter(options);
  }

  static commandHandlers() {
    return {
      configure: ConfigureIngestionPullCommand,
      disable: DisableIngestionPullCommand,
      recordRunCompleted: RecordIngestionPullRunCompletedCommand,
      recordRunFailed: RecordIngestionPullRunFailedCommand,
    } as const;
  }

  build() {
    return definePipeline<EventingIngestionPullEvent>({
      name: "ingestion_pull_processing",
      aggregate: defineAggregate({
        type: INGESTION_PULL_AGGREGATE_TYPE,
        events: defineEvents(INGESTION_PULL_PROCESSING_EVENT_TYPES),
      }),
    })
      .withPostgresProjection(
        IngestionPullRunStatusEventingProjection.create(this.options.runStatusStore),
      )
      .withCommand("configure", ConfigureIngestionPullCommand)
      .withCommand("disable", DisableIngestionPullCommand)
      .withCommand("recordRunCompleted", RecordIngestionPullRunCompletedCommand)
      .withCommand("recordRunFailed", RecordIngestionPullRunFailedCommand)
      .withProcessManager(INGESTION_PULL_PROCESS_NAME, this.options.process.processManager())
      .build();
  }
}

const ConfigureIngestionPullCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.CONFIGURE,
  eventType: INGESTION_PULL_EVENT_TYPES.CONFIGURED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.CONFIGURED,
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  schema: ingestionPullConfiguredCommandDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) => `${data.sourceId}:ingestion_pull:configure:${data.configVersion}`,
  spanAttributes: (data) => ({ "payload.source_id": data.sourceId }),
  makeJobId: (data) => `${data.sourceId}:ingestion_pull:configure:${data.configVersion}`,
});

const DisableIngestionPullCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.DISABLE,
  eventType: INGESTION_PULL_EVENT_TYPES.DISABLED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.DISABLED,
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  schema: ingestionPullDisabledEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) => `${data.sourceId}:ingestion_pull:disable:${data.configVersion}`,
  spanAttributes: (data) => ({ "payload.source_id": data.sourceId }),
  makeJobId: (data) => `${data.sourceId}:ingestion_pull:disable:${data.configVersion}`,
});

const RecordIngestionPullRunCompletedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_COMPLETED,
  eventType: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED,
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  schema: ingestionPullRunCompletedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) => `${data.sourceId}:ingestion_pull:${data.runId}:completed`,
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.run_id": data.runId,
    "payload.event_count": data.eventCount,
  }),
  makeJobId: (data) => `${data.sourceId}:ingestion_pull:${data.runId}:completed`,
});

const RecordIngestionPullRunFailedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_FAILED,
  eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.RUN_FAILED,
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  schema: ingestionPullRunFailedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) => `${data.sourceId}:ingestion_pull:${data.runId}:failed`,
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.run_id": data.runId,
  }),
  makeJobId: (data) => `${data.sourceId}:ingestion_pull:${data.runId}:failed`,
});
