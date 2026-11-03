import { CODING_AGENT_SESSION_STORED_EVENT_TYPE } from "@langwatch/coding-agent-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  CODING_AGENT_PROJECT_MILESTONE_AGGREGATE_TYPE,
  CODING_AGENT_PROJECT_MILESTONES_EVENT_VERSION,
  type CodingAgentSessionStoredEvent,
  RECORD_CODING_AGENT_SESSION_STORED_COMMAND_TYPE,
  type RecordCodingAgentSessionStoredCommandData,
  recordCodingAgentSessionStoredCommandDataSchema,
} from "./coding-agent-project-milestones.events.ts";

/**
 * Records a stored session; one event per project, session and instant, so a busy
 * project's facts never queue behind one another in a single group.
 */
export class RecordCodingAgentSessionStoredCommand implements CommandHandler<
  Command<RecordCodingAgentSessionStoredCommandData>,
  CodingAgentSessionStoredEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_CODING_AGENT_SESSION_STORED_COMMAND_TYPE,
    recordCodingAgentSessionStoredCommandDataSchema,
    "Record that a coding-agent session was stored",
  );

  handle(
    command: Command<RecordCodingAgentSessionStoredCommandData>,
  ): CodingAgentSessionStoredEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<CodingAgentSessionStoredEvent>({
        aggregateType: CODING_AGENT_PROJECT_MILESTONE_AGGREGATE_TYPE,
        aggregateId: RecordCodingAgentSessionStoredCommand.getAggregateId(data),
        tenantId: createTenantId(command.tenantId),
        type: CODING_AGENT_SESSION_STORED_EVENT_TYPE,
        version: CODING_AGENT_PROJECT_MILESTONES_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.projectId}:${data.sessionId}:session_stored:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordCodingAgentSessionStoredCommandData): string {
    return `${payload.projectId}:${payload.occurredAt}`;
  }
}
