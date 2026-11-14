/**
 * data_retention_retroactive (ADR-202 Decided 13): the api sends apply and cancel; one process per
 * project runs them as intents and wakes while rewrites run; a subscriber folds every fact.
 * Spec: modules/data-retention/specs/retroactive-retention-via-worker.feature
 */
import {
  RECORD_RETROACTIVE_PROGRESS_COMMAND_TYPE,
  REQUEST_RETROACTIVE_APPLY_COMMAND_TYPE,
  REQUEST_RETROACTIVE_CANCEL_COMMAND_TYPE,
  RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE,
  RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE,
  RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE,
  RETROACTIVE_RETENTION_AGGREGATE_TYPE,
  RETROACTIVE_RETENTION_EVENT_TYPES,
  RETROACTIVE_RETENTION_EVENT_VERSION,
  RETROACTIVE_RETENTION_PIPELINE_NAME,
  retroactiveApplyRequestedDataSchema,
  retroactiveCancelRequestedDataSchema,
  retroactiveProgressRecordedDataSchema,
} from "@langwatch/data-retention-contract";
import {
  defineAggregate,
  defineCommand,
  defineEventingModule,
  definePipeline,
  EventSchema,
  type EventingSetup,
  type RetentionPolicyResolver,
} from "@langwatch/eventing";
import { z } from "zod";

import type { DataRetentionModule } from "../app/data-retention.app.ts";
import type { DataRetentionRepositories } from "../repositories/data-retention.repositories.ts";
import type { RetroactiveFact } from "../rules/retroactive-status.rules.ts";
import type { RetroactiveRetentionService } from "../services/retroactive-retention.service.ts";
import {
  RETROACTIVE_APPLY_MAX_ATTEMPTS,
  RETROACTIVE_RETENTION_INITIAL_STATE,
  RETROACTIVE_RETENTION_PROCESS_NAME,
  retroactiveApplyRequested,
  retroactiveCancelRequested,
  retroactiveProgressRecorded,
  retroactiveProgressRefreshSchema,
  retroactiveProgressWake,
  retroactiveRetentionStateSchema,
} from "./retroactive-retention.process.ts";

/** A command carries the tenant and the moment; the event's data carries neither. */
function withCommandEnvelope<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  return schema.extend({
    tenantId: z.string().min(1),
    occurredAt: z.number().int().nonnegative(),
  });
}

export const RequestRetroactiveApplyCommand = defineCommand({
  commandType: REQUEST_RETROACTIVE_APPLY_COMMAND_TYPE,
  eventType: RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE,
  eventVersion: RETROACTIVE_RETENTION_EVENT_VERSION,
  aggregateType: RETROACTIVE_RETENTION_AGGREGATE_TYPE,
  schema: withCommandEnvelope(retroactiveApplyRequestedDataSchema),
  aggregateId: ({ projectId }) => projectId,
  idempotencyKey: ({ projectId, requestId }) => `${projectId}:retroactive_apply:${requestId}`,
  spanAttributes: ({ projectId, category }) => ({
    "data_retention.project.id": projectId,
    "data_retention.category": category,
  }),
});

export const RequestRetroactiveCancelCommand = defineCommand({
  commandType: REQUEST_RETROACTIVE_CANCEL_COMMAND_TYPE,
  eventType: RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE,
  eventVersion: RETROACTIVE_RETENTION_EVENT_VERSION,
  aggregateType: RETROACTIVE_RETENTION_AGGREGATE_TYPE,
  schema: withCommandEnvelope(retroactiveCancelRequestedDataSchema),
  aggregateId: ({ projectId }) => projectId,
  idempotencyKey: ({ projectId, requestId }) => `${projectId}:retroactive_cancel:${requestId}`,
  spanAttributes: ({ projectId }) => ({ "data_retention.project.id": projectId }),
});

export const RecordRetroactiveProgressCommand = defineCommand({
  commandType: RECORD_RETROACTIVE_PROGRESS_COMMAND_TYPE,
  eventType: RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE,
  eventVersion: RETROACTIVE_RETENTION_EVENT_VERSION,
  aggregateType: RETROACTIVE_RETENTION_AGGREGATE_TYPE,
  schema: withCommandEnvelope(retroactiveProgressRecordedDataSchema),
  aggregateId: ({ projectId }) => projectId,
  idempotencyKey: ({ projectId, occurredAt, settled }) =>
    `${projectId}:retroactive_progress:${occurredAt}:${settled?.requestId ?? ""}`,
  spanAttributes: ({ projectId }) => ({ "data_retention.project.id": projectId }),
});

const applyRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE),
  data: retroactiveApplyRequestedDataSchema,
});
const cancelRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE),
  data: retroactiveCancelRequestedDataSchema,
});
const progressRecordedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE),
  data: retroactiveProgressRecordedDataSchema,
});
type RetroactiveEvent =
  | z.infer<typeof applyRequestedEventSchema>
  | z.infer<typeof cancelRequestedEventSchema>
  | z.infer<typeof progressRecordedEventSchema>;

export type RetroactiveRetentionPipelineDeps = Readonly<{
  retroactive: Pick<
    RetroactiveRetentionService,
    "fold" | "runApply" | "runCancel" | "refreshProgress"
  >;
  tenantRetention: RetentionPolicyResolver;
}>;

const buildRetroactiveRetentionPipeline = (deps: RetroactiveRetentionPipelineDeps) =>
  definePipeline({
    name: RETROACTIVE_RETENTION_PIPELINE_NAME,
    aggregate: defineAggregate({ type: RETROACTIVE_RETENTION_AGGREGATE_TYPE }),
  })
    .withEvents([
      applyRequestedEventSchema,
      cancelRequestedEventSchema,
      progressRecordedEventSchema,
    ])
    .withCommand("requestRetroactiveApply", RequestRetroactiveApplyCommand)
    .withCommand("requestRetroactiveCancel", RequestRetroactiveCancelCommand)
    .withCommand("recordRetroactiveProgress", RecordRetroactiveProgressCommand)
    .withEventSubscriber("retroactiveStatusFold", {
      name: "retroactiveStatusFold",
      eventTypes: [...RETROACTIVE_RETENTION_EVENT_TYPES],
      handle: async (event: RetroactiveEvent) => {
        const fact = {
          id: event.id,
          occurredAt: event.occurredAt,
          type: event.type,
          data: event.data,
        } as RetroactiveFact;
        await deps.retroactive.fold({ projectId: event.data.projectId, fact });
      },
    })
    .withProcessManager(RETROACTIVE_RETENTION_PROCESS_NAME, (pm) =>
      pm
        .state(retroactiveRetentionStateSchema, RETROACTIVE_RETENTION_INITIAL_STATE)
        .intent("applyRetention", retroactiveApplyRequestedDataSchema, (apply, context) =>
          deps.retroactive.runApply(apply, { attempt: context.attempt }),
        )
        .intent("cancelMutation", retroactiveCancelRequestedDataSchema, (cancel) =>
          deps.retroactive.runCancel(cancel),
        )
        .intent("refreshProgress", retroactiveProgressRefreshSchema, ({ projectId }) =>
          deps.retroactive.refreshProgress({ projectId }),
        )
        .on(applyRequestedEventSchema, retroactiveApplyRequested)
        .on(cancelRequestedEventSchema, retroactiveCancelRequested)
        .on(progressRecordedEventSchema, retroactiveProgressRecorded)
        .onWake(retroactiveProgressWake)
        .outbox({ maxAttempts: RETROACTIVE_APPLY_MAX_ATTEMPTS }),
    )
    .withRetention(deps.tenantRetention)
    .build();

export type RetroactiveRetentionPipeline = ReturnType<typeof buildRetroactiveRetentionPipeline>;

export function retroactiveRetentionPipeline(
  deps: RetroactiveRetentionPipelineDeps,
): RetroactiveRetentionPipeline {
  return buildRetroactiveRetentionPipeline(deps);
}

export const retroactiveRetentionEventing = defineEventingModule({
  pipeline: RETROACTIVE_RETENTION_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DataRetentionRepositories, DataRetentionModule>) =>
    app.retroactivePipeline(),
  connect: ({ app, commands }) => app.connectRetroactive(commands),
});
