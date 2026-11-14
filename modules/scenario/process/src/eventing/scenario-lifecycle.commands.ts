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
  RECORD_SIMULATION_SET_CREATED_COMMAND_TYPE,
  SCENARIO_AGGREGATE_TYPE,
  SCENARIO_CREATED_EVENT_TYPE,
  SCENARIO_CREATED_EVENT_VERSION,
  type ScenarioCreatedEvent,
  scenarioCreatedEventDataSchema,
  SIMULATION_SET_CREATED_EVENT_TYPE,
  SIMULATION_SET_CREATED_EVENT_VERSION,
  type SimulationSetCreatedEvent,
  simulationSetCreatedEventDataSchema,
} from "@langwatch/scenario-contract";
import type { z } from "zod";

const recordScenarioCreatedCommandDataSchema = withCommandEnvelope(scenarioCreatedEventDataSchema);
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
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.scenarioId}:created`,
      }),
    ];
  }

  static getAggregateId(payload: RecordScenarioCreatedCommandData): string {
    return payload.scenarioId;
  }
}

const recordSimulationSetCreatedCommandDataSchema = withCommandEnvelope(
  simulationSetCreatedEventDataSchema,
);
export type RecordSimulationSetCreatedCommandData = z.infer<
  typeof recordSimulationSetCreatedCommandDataSchema
>;

/**
 * Records that a project ran a simulation set; one event per project and set, however many runs
 * send it, since the idempotency key names only the two.
 */
export class RecordSimulationSetCreatedCommand implements CommandHandler<
  Command<RecordSimulationSetCreatedCommandData>,
  SimulationSetCreatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SIMULATION_SET_CREATED_COMMAND_TYPE,
    recordSimulationSetCreatedCommandDataSchema,
    "Record that a project ran a simulation set for the first time",
  );

  handle(command: Command<RecordSimulationSetCreatedCommandData>): SimulationSetCreatedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<SimulationSetCreatedEvent>({
        aggregateType: SCENARIO_AGGREGATE_TYPE,
        aggregateId: RecordSimulationSetCreatedCommand.getAggregateId(command.data),
        tenantId: createTenantId(command.tenantId),
        type: SIMULATION_SET_CREATED_EVENT_TYPE,
        version: SIMULATION_SET_CREATED_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.scenarioSetId}:simulation_set_created`,
      }),
    ];
  }

  /** Prefixed, so a set id never shares an aggregate with a scenario id. */
  static getAggregateId(payload: RecordSimulationSetCreatedCommandData): string {
    return `simulation_set:${payload.scenarioSetId}`;
  }
}
