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
  type PulledUsageRetractedEvent,
} from "@langwatch/enterprise-governance-contract";
import {
  defineAggregate,
  defineCommand,
  defineEvents,
  definePipeline,
  type Event,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { CostRollupWatchProcess } from "../eventing/cost-rollup-watch.process.ts";
import { COST_ROLLUP_WATCH_PROCESS_NAME } from "../eventing/cost-rollup-watch.process.ts";
import type { PulledUsageLedgerProcess } from "../eventing/pulled-usage-ledger.process.ts";
import { PULLED_USAGE_LEDGER_PROCESS_NAME } from "../eventing/pulled-usage-ledger.process.ts";

/**
 * Both events the aggregate declares. The retraction is in the type as well as
 * in `PULLED_USAGE_PROCESSING_EVENT_TYPES`, so a process manager that handles
 * it is type-checked against the same set the pipeline registers.
 */
type PulledUsageEvent = (PulledUsageObservedEvent & Event) | (PulledUsageRetractedEvent & Event);

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
    // The amount and the code that denominates it, on the same span. A trace
    // showing only the figure cannot be read: 1_533_525_880 is a different
    // amount of money depending on the next line.
    "payload.cost_nano_minor": data.costNanoMinor,
    "payload.currency_code": data.currencyCode,
  }),
  makeJobId: (data) => pulledUsageObservationKey(data),
});

export class PulledUsageEventingAdapter {
  private constructor(
    private readonly ledger: PulledUsageLedgerProcess | undefined,
    private readonly costRollupWatch: CostRollupWatchProcess | undefined,
  ) {}

  static create(
    options: {
      ledger?: PulledUsageLedgerProcess;
      /** Absent in a deployment with no cost summary to check. */
      costRollupWatch?: CostRollupWatchProcess;
    } = {},
  ): PulledUsageEventingAdapter {
    return new PulledUsageEventingAdapter(options.ledger, options.costRollupWatch);
  }

  static commandHandlers(): { recordPulledUsage: typeof RecordPulledUsageCommand } {
    return { recordPulledUsage: RecordPulledUsageCommand } as const;
  }

  build(): StaticPipelineDefinition<
    PulledUsageEvent,
    Record<string, Projection>,
    RegisteredCommand
  > {
    const pipeline = definePipeline<PulledUsageEvent>({
      name: PULLED_USAGE_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: PULLED_USAGE_AGGREGATE_TYPE,
        events: defineEvents(PULLED_USAGE_PROCESSING_EVENT_TYPES),
      }),
    }).withCommand("recordPulledUsage", RecordPulledUsageCommand);
    if (this.ledger) {
      pipeline.withProcessManager(PULLED_USAGE_LEDGER_PROCESS_NAME, this.ledger.processManager());
    }
    if (this.costRollupWatch) {
      pipeline.withProcessManager(
        COST_ROLLUP_WATCH_PROCESS_NAME,
        this.costRollupWatch.processManager(),
      );
    }
    return pipeline.build();
  }
}
