import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import {
  EXPERIMENT_LIFECYCLE_AGGREGATE_TYPE,
  EXPERIMENT_RAN_EVENT_TYPE,
  EXPERIMENT_RAN_EVENT_VERSION,
  experimentRanEventDataSchema,
} from "@langwatch/experiment-contract";
import { z } from "zod";

export const RECORD_EXPERIMENT_RAN_COMMAND_TYPE = "lw.experiment.record_ran" as const;

export const recordExperimentRanCommandDataSchema = experimentRanEventDataSchema;
export type RecordExperimentRanCommandData = z.infer<typeof recordExperimentRanCommandDataSchema>;

export const experimentRanEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(EXPERIMENT_RAN_EVENT_TYPE),
  version: z.literal(EXPERIMENT_RAN_EVENT_VERSION),
  data: experimentRanEventDataSchema,
});
export type ExperimentRanEvent = z.infer<typeof experimentRanEventSchema>;
export type ExperimentLifecycleEvent = ExperimentRanEvent;

/** Records that a workbench run ended; the same send twice is one event. */
export class RecordExperimentRanCommand implements CommandHandler<
  Command<RecordExperimentRanCommandData>,
  ExperimentRanEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_EXPERIMENT_RAN_COMMAND_TYPE,
    recordExperimentRanCommandDataSchema,
    "Record that a workbench run ended",
  );

  handle(command: Command<RecordExperimentRanCommandData>): ExperimentRanEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<ExperimentRanEvent>({
        aggregateType: EXPERIMENT_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: EXPERIMENT_RAN_EVENT_TYPE,
        version: EXPERIMENT_RAN_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.tenantId}:${data.userId}:ran:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordExperimentRanCommandData): string {
    return payload.projectId;
  }
}
