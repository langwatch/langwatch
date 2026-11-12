import {
  AGENT_ARCHIVED_EVENT_TYPE,
  AGENT_CHANGED_EVENT_TYPE,
  agentArchivedEventDataSchema,
  agentChangedEventDataSchema,
} from "@langwatch/agent-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import {
  createTenantId,
  defineCommandSchema,
  EventSchema,
  EventUtils,
  stripEnvelope,
  withCommandEnvelope,
} from "@langwatch/eventing";
import { z } from "zod";

/** The agent's own lifecycle facts, which peers react to from their own side (§9). */
export const AGENT_LIFECYCLE_PIPELINE_NAME = "agent_lifecycle" as const;
export const AGENT_AGGREGATE_TYPE = "agent" as const;

const AGENT_ARCHIVED_EVENT_VERSION = "2026-10-08" as const;
const RECORD_AGENT_ARCHIVED_COMMAND_TYPE = "lw.agent.record_archived" as const;
const AGENT_CHANGED_EVENT_VERSION = "2026-11-03" as const;
const RECORD_AGENT_CHANGED_COMMAND_TYPE = "lw.agent.record_changed" as const;

export const agentArchivedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(AGENT_ARCHIVED_EVENT_TYPE),
  version: z.literal(AGENT_ARCHIVED_EVENT_VERSION),
  data: agentArchivedEventDataSchema,
});
type AgentArchivedEvent = z.infer<typeof agentArchivedEventSchema>;

export const agentChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(AGENT_CHANGED_EVENT_TYPE),
  version: z.literal(AGENT_CHANGED_EVENT_VERSION),
  data: agentChangedEventDataSchema,
});
type AgentChangedEvent = z.infer<typeof agentChangedEventSchema>;
export type AgentLifecycleEvent = AgentArchivedEvent | AgentChangedEvent;

const recordAgentArchivedCommandDataSchema = withCommandEnvelope(agentArchivedEventDataSchema);
export type RecordAgentArchivedCommandData = z.infer<typeof recordAgentArchivedCommandDataSchema>;

/** Records that an agent was archived; one event per agent, however often it is sent. */
export class RecordAgentArchivedCommand implements CommandHandler<
  Command<RecordAgentArchivedCommandData>,
  AgentArchivedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_AGENT_ARCHIVED_COMMAND_TYPE,
    recordAgentArchivedCommandDataSchema,
    "Record that an agent was archived",
  );

  handle(command: Command<RecordAgentArchivedCommandData>): AgentArchivedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<AgentArchivedEvent>({
        aggregateType: AGENT_AGGREGATE_TYPE,
        aggregateId: data.agentId,
        tenantId: createTenantId(command.tenantId),
        type: AGENT_ARCHIVED_EVENT_TYPE,
        version: AGENT_ARCHIVED_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.agentId}:archived`,
      }),
    ];
  }

  static getAggregateId(payload: RecordAgentArchivedCommandData): string {
    return payload.agentId;
  }
}

const recordAgentChangedCommandDataSchema = withCommandEnvelope(agentChangedEventDataSchema);
export type RecordAgentChangedCommandData = z.infer<typeof recordAgentChangedCommandDataSchema>;

/** Records that an agent was written; each write is its own fact, keyed by its change id. */
export class RecordAgentChangedCommand implements CommandHandler<
  Command<RecordAgentChangedCommandData>,
  AgentChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_AGENT_CHANGED_COMMAND_TYPE,
    recordAgentChangedCommandDataSchema,
    "Record that an agent was written",
  );

  handle(command: Command<RecordAgentChangedCommandData>): AgentChangedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<AgentChangedEvent>({
        aggregateType: AGENT_AGGREGATE_TYPE,
        aggregateId: data.agentId,
        tenantId: createTenantId(command.tenantId),
        type: AGENT_CHANGED_EVENT_TYPE,
        version: AGENT_CHANGED_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.agentId}:changed:${data.changeId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordAgentChangedCommandData): string {
    return payload.agentId;
  }
}
