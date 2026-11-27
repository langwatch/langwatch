import {
  DATA_RETENTION_PROJECT_AGGREGATE_TYPE,
  RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_TYPE,
  RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_VERSION,
  retentionAppliedToExistingDataEventDataSchema,
} from "@langwatch/data-retention-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import { z } from "zod";

const RECORD_RETENTION_APPLIED_TO_EXISTING_DATA_COMMAND_TYPE =
  "lw.data_retention.record_retention_applied_to_existing_data" as const;
const recordRetentionAppliedToExistingDataCommandDataSchema =
  retentionAppliedToExistingDataEventDataSchema;
export type RecordRetentionAppliedToExistingDataCommandData = z.infer<
  typeof recordRetentionAppliedToExistingDataCommandDataSchema
>;

export const retentionAppliedToExistingDataEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_TYPE),
  version: z.literal(RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_VERSION),
  data: retentionAppliedToExistingDataEventDataSchema,
});
type RetentionAppliedToExistingDataEvent = z.infer<
  typeof retentionAppliedToExistingDataEventSchema
>;

/**
 * Records that a project's existing data was rewritten to a category's retention. Keyed by its
 * instant, days and mode, so a redelivered command records nothing new while two changes in
 * the same millisecond both land.
 */
export class RecordRetentionAppliedToExistingDataCommand implements CommandHandler<
  Command<RecordRetentionAppliedToExistingDataCommandData>,
  RetentionAppliedToExistingDataEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_RETENTION_APPLIED_TO_EXISTING_DATA_COMMAND_TYPE,
    recordRetentionAppliedToExistingDataCommandDataSchema,
    "Record that a retention was applied to a project's existing data",
  );

  handle(
    command: Command<RecordRetentionAppliedToExistingDataCommandData>,
  ): RetentionAppliedToExistingDataEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<RetentionAppliedToExistingDataEvent>({
        aggregateType: DATA_RETENTION_PROJECT_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_TYPE,
        version: RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.projectId}:${data.category}:retention_applied:${data.retentionDays}:${data.mode ?? "apply"}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordRetentionAppliedToExistingDataCommandData): string {
    return payload.projectId;
  }

  static getSpanAttributes(
    payload: RecordRetentionAppliedToExistingDataCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.project.id": payload.projectId,
      "payload.retention.category": payload.category,
      "payload.retention.days": payload.retentionDays,
    };
  }
}
