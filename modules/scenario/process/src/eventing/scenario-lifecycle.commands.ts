import type { Command, CommandHandler } from "@langwatch/eventing";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
  stripEnvelope,
  withCommandEnvelope,
} from "@langwatch/eventing";
import {
  RECORD_SCENARIO_CREATED_COMMAND_TYPE,
  SCENARIO_AGGREGATE_TYPE,
  SCENARIO_CREATED_EVENT_TYPE,
  SCENARIO_CREATED_EVENT_VERSION,
  type ScenarioCreatedEvent,
  scenarioCreatedEventDataSchema,
} from "@langwatch/scenario-contract";
import type { z } from "zod";

export const recordScenarioCreatedCommandDataSchema = withCommandEnvelope(
  scenarioCreatedEventDataSchema,
);
export type RecordScenarioCreatedCommandData = z.infer<
  typeof recordScenarioCreatedCommandDataSchema
>;

/** Records that a scenario was written; one event per scenario, however often it is sent. */
export class RecordScenarioCreatedCommand implements CommandHandler<
  Command<RecordScenarioCreatedCommandData>,
  ScenarioCreatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SCENARIO_CREATED_COMMAND_TYPE,
    recordScenarioCreatedCommandDataSchema,
    "Record that a scenario was created",
  );

  handle(command: Command<RecordScenarioCreatedCommandData>): ScenarioCreatedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<ScenarioCreatedEvent>({
        aggregateType: SCENARIO_AGGREGATE_TYPE,
        aggregateId: data.scenarioId,
        tenantId: createTenantId(command.tenantId),
        type: SCENARIO_CREATED_EVENT_TYPE,
        version: SCENARIO_CREATED_EVENT_VERSION,
        data,
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.scenarioId}:created`,
      }),
    ];
  }

  static getAggregateId(payload: RecordScenarioCreatedCommandData): string {
    return payload.scenarioId;
  }
}
