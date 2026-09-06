import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  type ContributeSpanFactsCommandData,
  contributeSpanFactsCommandDataSchema,
} from "../schemas/commands";
import {
  CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { SpanFactsContributedEvent } from "../schemas/events";

export class ContributeSpanFactsCommand
  implements
    CommandHandler<
      Command<ContributeSpanFactsCommandData>,
      SpanFactsContributedEvent
    >
{
  static readonly schema = defineCommandSchema(
    CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
    contributeSpanFactsCommandDataSchema,
    "Contribute one span's coding-agent facts to its session",
  );

  async handle(
    command: Command<ContributeSpanFactsCommandData>,
  ): Promise<SpanFactsContributedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<SpanFactsContributedEvent>({
        aggregateType: "coding_agent_session",
        aggregateId: data.sessionId,
        tenantId: createTenantId(command.tenantId),
        type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
        version: SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        // A span contributes to its session exactly once — re-delivered
        // telemetry must not inflate the fold (session-aggregate.feature).
        // Span ids are unique within a trace, not globally, so the trace id
        // stays in the key.
        idempotencyKey: `${command.tenantId}:${data.traceId}:${data.spanId}`,
      }),
    ];
  }

  static getAggregateId(payload: ContributeSpanFactsCommandData): string {
    return payload.sessionId;
  }

  static getSpanAttributes(
    payload: ContributeSpanFactsCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.coding_agent.session_id": payload.sessionId,
      "payload.coding_agent.agent": payload.agent,
      "payload.coding_agent.span_name": payload.name,
    };
  }
}
