import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  EXPERIMENT_LIFECYCLE_AGGREGATE_TYPE,
  EXPERIMENT_RAN_EVENT_TYPE,
  EXPERIMENT_RAN_EVENT_VERSION,
} from "@langwatch/experiment-contract";

import {
  RECORD_EXPERIMENT_RAN_COMMAND_TYPE,
  type ExperimentRanEvent,
  type RecordExperimentRanCommandData,
  recordExperimentRanCommandDataSchema,
} from "./experiment-lifecycle.events.ts";

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
