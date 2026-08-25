import {
  PULLED_USAGE_AGGREGATE_TYPE,
  PULLED_USAGE_COMMAND_TYPES,
  PULLED_USAGE_EVENT_TYPES,
  PULLED_USAGE_EVENT_VERSIONS,
  PULLED_USAGE_PIPELINE_NAME,
  PULLED_USAGE_PROCESSING_EVENT_TYPES,
  pulledUsageObservationKey,
  pulledUsageObservedEventDataSchema,
  type PulledUsageObservedEvent,
} from "@langwatch/enterprise-governance-contract";
import {
  defineAggregate,
  defineCommand,
  defineEvents,
  definePipeline,
  type Event,
} from "@langwatch/eventing";
import {
  PULLED_USAGE_LEDGER_PROCESS_NAME,
  PulledUsageLedgerProcess,
} from "../processes/pulled-usage-ledger.process";

type PulledUsageEvent = PulledUsageObservedEvent & Event;

const RecordPulledUsageCommand = defineCommand({
  commandType: PULLED_USAGE_COMMAND_TYPES.RECORD,
  eventType: PULLED_USAGE_EVENT_TYPES.OBSERVED,
  eventVersion: PULLED_USAGE_EVENT_VERSIONS.OBSERVED,
  aggregateType: PULLED_USAGE_AGGREGATE_TYPE,
  schema: pulledUsageObservedEventDataSchema,
  aggregateId: (data) => data.restatementKey,
  idempotencyKey: (data) => pulledUsageObservationKey(data),
  spanAttributes: (data) => ({
    "payload.source": data.source,
    "payload.ingestion_source_id": data.ingestionSourceId,
    "payload.cost_basis": data.costBasis,
    "payload.cost_status": data.costStatus,
    "payload.cost_nano_usd": data.costNanoUsd,
  }),
  makeJobId: (data) => pulledUsageObservationKey(data),
});

export class PulledUsageEventingAdapter {
  private constructor(
    private readonly ledger: PulledUsageLedgerProcess | undefined,
  ) {}

  static create(
    options: {
      ledger?: PulledUsageLedgerProcess;
    } = {},
  ): PulledUsageEventingAdapter {
    return new PulledUsageEventingAdapter(options.ledger);
  }

  static commandHandlers() {
    return { recordPulledUsage: RecordPulledUsageCommand } as const;
  }

  build() {
    const pipeline = definePipeline<PulledUsageEvent>({
      name: PULLED_USAGE_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: PULLED_USAGE_AGGREGATE_TYPE,
        events: defineEvents(PULLED_USAGE_PROCESSING_EVENT_TYPES),
      }),
    }).withCommand("recordPulledUsage", RecordPulledUsageCommand);
    return this.ledger
      ? pipeline
          .withProcessManager(
            PULLED_USAGE_LEDGER_PROCESS_NAME,
            this.ledger.processManager(),
          )
          .build()
      : pipeline.build();
  }
}
