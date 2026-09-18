import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  type ContributeLogFactsCommandData,
  contributeLogFactsCommandDataSchema,
} from "../schemas/commands";
import {
  CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { LogFactsContributedEvent } from "../schemas/events";

export class ContributeLogFactsCommand
  implements
    CommandHandler<
      Command<ContributeLogFactsCommandData>,
      LogFactsContributedEvent
    >
{
  static readonly schema = defineCommandSchema(
    CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
    contributeLogFactsCommandDataSchema,
    "Contribute one log record's coding-agent facts to its session",
  );

  async handle(
    command: Command<ContributeLogFactsCommandData>,
  ): Promise<LogFactsContributedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<LogFactsContributedEvent>({
        aggregateType: "coding_agent_session",
        aggregateId: data.sessionId,
        tenantId: createTenantId(command.tenantId),
        type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
        version: LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        // Tenant-scoped like every other command's. A RecordId is a content
        // hash that already includes its tenant, so a collision is not
        // reachable today — but nothing states that invariant at this layer,
        // and a dedup key that silently depends on it would suppress another
        // tenant's work the day it changes.
        idempotencyKey: `${command.tenantId}:${data.recordId}`,
      }),
    ];
  }

  static getAggregateId(payload: ContributeLogFactsCommandData): string {
    return payload.sessionId;
  }

  static getSpanAttributes(
    payload: ContributeLogFactsCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.coding_agent.session_id": payload.sessionId,
      "payload.coding_agent.agent": payload.agent,
      "payload.coding_agent.record_id": payload.recordId,
    };
  }
}
