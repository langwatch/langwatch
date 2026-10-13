import { AGENT_ARCHIVED_EVENT_TYPE, agentArchivedEventDataSchema } from "@langwatch/agent-contract";
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

export const agentArchivedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(AGENT_ARCHIVED_EVENT_TYPE),
  version: z.literal(AGENT_ARCHIVED_EVENT_VERSION),
  data: agentArchivedEventDataSchema,
});
type AgentArchivedEvent = z.infer<typeof agentArchivedEventSchema>;
export type AgentLifecycleEvent = AgentArchivedEvent;

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
