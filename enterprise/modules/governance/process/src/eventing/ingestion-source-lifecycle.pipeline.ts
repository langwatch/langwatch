// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  INGESTION_SOURCE_CREATED_EVENT_TYPE,
  INGESTION_SOURCE_LIFECYCLE_AGGREGATE_TYPE,
  INGESTION_SOURCE_LIFECYCLE_COMMAND_TYPES,
  INGESTION_SOURCE_LIFECYCLE_EVENT_VERSION,
  INGESTION_SOURCE_LIFECYCLE_PIPELINE_NAME,
  INGESTION_SOURCE_WENT_LIVE_EVENT_TYPE,
  type IngestionSourceFactData,
  ingestionSourceFactDataSchema,
} from "@langwatch/enterprise-governance-contract/ingestion-source-lifecycle";
import {
  type Command,
  type CommandHandler,
  createTenantId,
  defineAggregate,
  defineCommandSchema,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  EventSchema,
  EventUtils,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { z } from "zod";

import type { GovernanceModule } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";

const ingestionSourceCreatedEventSchema = z.object({
  ...EventSchema.shape,
  aggregateType: z.literal(INGESTION_SOURCE_LIFECYCLE_AGGREGATE_TYPE),
  type: z.literal(INGESTION_SOURCE_CREATED_EVENT_TYPE),
  version: z.literal(INGESTION_SOURCE_LIFECYCLE_EVENT_VERSION),
  data: ingestionSourceFactDataSchema,
});
type IngestionSourceCreatedEvent = z.infer<typeof ingestionSourceCreatedEventSchema>;

const ingestionSourceWentLiveEventSchema = z.object({
  ...EventSchema.shape,
  aggregateType: z.literal(INGESTION_SOURCE_LIFECYCLE_AGGREGATE_TYPE),
  type: z.literal(INGESTION_SOURCE_WENT_LIVE_EVENT_TYPE),
  version: z.literal(INGESTION_SOURCE_LIFECYCLE_EVENT_VERSION),
  data: ingestionSourceFactDataSchema,
});
type IngestionSourceWentLiveEvent = z.infer<typeof ingestionSourceWentLiveEventSchema>;

type IngestionSourceLifecycleEvent = IngestionSourceCreatedEvent | IngestionSourceWentLiveEvent;

type IngestionSourceLifecycleDefinition = StaticPipelineDefinition<
  IngestionSourceLifecycleEvent & Event,
  Record<string, Projection>,
  | { name: "recordIngestionSourceCreated"; payload: IngestionSourceFactData }
  | { name: "recordIngestionSourceWentLive"; payload: IngestionSourceFactData }
>;

// Hand-written rather than `defineCommand`, which strips the tenant and instant from the data:
// a peer reads both off the fact itself, as it does gateway's and organization's.

/** Records that a source was created, once per source. */
export class RecordIngestionSourceCreatedCommand implements CommandHandler<
  Command<IngestionSourceFactData>,
  IngestionSourceCreatedEvent
> {
  static readonly schema = defineCommandSchema(
    INGESTION_SOURCE_LIFECYCLE_COMMAND_TYPES.RECORD_CREATED,
    ingestionSourceFactDataSchema,
    "Record that an ingestion source was created",
  );

  handle(command: Command<IngestionSourceFactData>): IngestionSourceCreatedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<IngestionSourceCreatedEvent>({
        aggregateType: INGESTION_SOURCE_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.sourceId,
        tenantId: createTenantId(command.tenantId),
        type: INGESTION_SOURCE_CREATED_EVENT_TYPE,
        version: INGESTION_SOURCE_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.sourceId}:created`,
      }),
    ];
  }

  static getAggregateId(payload: IngestionSourceFactData): string {
    return payload.sourceId;
  }
}

/** Records that a source took its first data, once per source. */
export class RecordIngestionSourceWentLiveCommand implements CommandHandler<
  Command<IngestionSourceFactData>,
  IngestionSourceWentLiveEvent
> {
  static readonly schema = defineCommandSchema(
    INGESTION_SOURCE_LIFECYCLE_COMMAND_TYPES.RECORD_WENT_LIVE,
    ingestionSourceFactDataSchema,
    "Record that an ingestion source took its first data",
  );

  handle(command: Command<IngestionSourceFactData>): IngestionSourceWentLiveEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<IngestionSourceWentLiveEvent>({
        aggregateType: INGESTION_SOURCE_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.sourceId,
        tenantId: createTenantId(command.tenantId),
        type: INGESTION_SOURCE_WENT_LIVE_EVENT_TYPE,
        version: INGESTION_SOURCE_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.sourceId}:went_live`,
      }),
    ];
  }

  static getAggregateId(payload: IngestionSourceFactData): string {
    return payload.sourceId;
  }
}

/** A fact-only pipeline: governance records a source's lifecycle, nurturing reacts to it. */
function buildIngestionSourceLifecyclePipeline(): IngestionSourceLifecycleDefinition {
  return definePipeline({
    name: INGESTION_SOURCE_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: INGESTION_SOURCE_LIFECYCLE_AGGREGATE_TYPE }),
  })
    .withEvents([ingestionSourceCreatedEventSchema, ingestionSourceWentLiveEventSchema])
    .withCommand("recordIngestionSourceCreated", RecordIngestionSourceCreatedCommand)
    .withCommand("recordIngestionSourceWentLive", RecordIngestionSourceWentLiveCommand)
    .build();
}

export const ingestionSourceLifecycleEventing = defineEventingModule({
  pipeline: INGESTION_SOURCE_LIFECYCLE_PIPELINE_NAME,
  build: (_setup: EventingSetup<GovernanceRepositories, GovernanceModule>) =>
    buildIngestionSourceLifecyclePipeline(),
  connect: ({ app, commands }) => app.connectIngestionSourceFacts(commands),
});
