import {
  PULLED_USAGE_AGGREGATE_TYPE,
  PULLED_USAGE_COMMAND_TYPES,
  PULLED_USAGE_EVENT_TYPES,
  PULLED_USAGE_EVENT_VERSIONS,
  PULLED_USAGE_PIPELINE_NAME,
  pulledUsageObservationKey,
  pulledUsageObservedEventDataSchema,
  pulledUsageRetractedEventDataSchema,
  pulledUsageRetractionKey,
  type PulledUsageObservedEvent,
  type PulledUsageRetractedEvent,
  pulledUsageObservedEventSchema,
  pulledUsageRetractedEventSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  defineAggregate,
  defineCommand,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GovernanceApp } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import type { CostRollupWatchProcess } from "./cost-rollup-watch.process.ts";
import { COST_ROLLUP_WATCH_PROCESS_NAME } from "./cost-rollup-watch.process.ts";
import type { GovernanceCostRollupFoldProjection } from "./governance-cost-rollup.projection.ts";
import type { PulledUsageLedgerProcess } from "./pulled-usage-ledger.process.ts";
import { PULLED_USAGE_LEDGER_PROCESS_NAME } from "./pulled-usage-ledger.process.ts";

/**
 * Both events the aggregate declares. The retraction is in the type as well as
 * in `PULLED_USAGE_PROCESSING_EVENT_TYPES`, so a process manager that handles
 * it is type-checked against the same set the pipeline registers.
 */
type PulledUsageEvent = (PulledUsageObservedEvent & Event) | (PulledUsageRetractedEvent & Event);

export type PulledUsageDefinition = StaticPipelineDefinition<
  PulledUsageEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

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

/**
 * Main's `retractPulledUsage`: registered unconditionally although only the ledger process
 * sends it, so a deployment without the ledger still applies a withdrawal already logged.
 */
const RetractPulledUsageCommand = defineCommand({
  commandType: PULLED_USAGE_COMMAND_TYPES.RETRACT,
  eventType: PULLED_USAGE_EVENT_TYPES.RETRACTED,
  eventVersion: PULLED_USAGE_EVENT_VERSIONS.RETRACTED,
  aggregateType: PULLED_USAGE_AGGREGATE_TYPE,
  schema: pulledUsageRetractedEventDataSchema,
  aggregateId: (data) => data.restatementKey,
  idempotencyKey: (data) => pulledUsageRetractionKey(data),
  spanAttributes: (data) => ({
    "payload.source": data.source,
    "payload.ingestion_source_id": data.ingestionSourceId,
    "payload.currency_code": data.currencyCode,
    "payload.retracted_model": data.model,
  }),
  makeJobId: (data) => pulledUsageRetractionKey(data),
});

export class PulledUsageEventingAdapter {
  private constructor(
    private readonly ledger: PulledUsageLedgerProcess | undefined,
    private readonly costRollupWatch: CostRollupWatchProcess | undefined,
    private readonly costRollup: GovernanceCostRollupFoldProjection | undefined,
  ) {}

  static create(
    options: {
      ledger?: PulledUsageLedgerProcess;
      /** Absent in a deployment with no cost summary to check. */
      costRollupWatch?: CostRollupWatchProcess;
      /** Main's `governanceCostRollup` fold; the worker hosts it, the api constructs none. */
      costRollup?: GovernanceCostRollupFoldProjection;
    } = {},
  ): PulledUsageEventingAdapter {
    return new PulledUsageEventingAdapter(
      options.ledger,
      options.costRollupWatch,
      options.costRollup,
    );
  }

  static commandHandlers(): {
    recordPulledUsage: typeof RecordPulledUsageCommand;
    retractPulledUsage: typeof RetractPulledUsageCommand;
  } {
    return {
      recordPulledUsage: RecordPulledUsageCommand,
      retractPulledUsage: RetractPulledUsageCommand,
    } as const;
  }

  build(): PulledUsageDefinition {
    const pipeline = definePipeline({
      name: PULLED_USAGE_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: PULLED_USAGE_AGGREGATE_TYPE,
      }),
    })
      .withEvents([pulledUsageObservedEventSchema, pulledUsageRetractedEventSchema])
      .withCommand("recordPulledUsage", RecordPulledUsageCommand)
      .withCommand("retractPulledUsage", RetractPulledUsageCommand);
    if (this.costRollup) {
      pipeline.withClickHouseFoldProjection(this.costRollup);
    }
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

/** The api only sends; the worker also hosts main's cost rollup fold (`pipeline.ts` on main). */
export const pulledUsageEventing = defineEventingModule({
  pipeline: PULLED_USAGE_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<GovernanceRepositories, GovernanceApp>) =>
    app.pulledUsagePipeline({ participation }),
  connect: ({ app, commands }) => app.connectPulledUsage(commands),
});
