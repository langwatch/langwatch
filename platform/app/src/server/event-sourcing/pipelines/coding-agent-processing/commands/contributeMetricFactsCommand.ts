import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  type ContributeMetricFactsCommandData,
  contributeMetricFactsCommandDataSchema,
} from "../schemas/commands";
import {
  CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { MetricFactsContributedEvent } from "../schemas/events";

export class ContributeMetricFactsCommand
  implements
    CommandHandler<
      Command<ContributeMetricFactsCommandData>,
      MetricFactsContributedEvent
    >
{
  static readonly schema = defineCommandSchema(
    CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE,
    contributeMetricFactsCommandDataSchema,
    "Contribute a metric series' converged totals to its session",
  );

  async handle(
    command: Command<ContributeMetricFactsCommandData>,
  ): Promise<MetricFactsContributedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<MetricFactsContributedEvent>({
        aggregateType: "coding_agent_session",
        aggregateId: data.sessionId,
        tenantId: createTenantId(command.tenantId),
        type: METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
        version: METRIC_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        // The value is a converged total, so a re-delivered observation is
        // the SAME fact (dedup it); a newer observation carries a newer
        // `asOfUnixMs` and is a new fact that replaces downstream (ADR-056
        // §5 — replace, never increment).
        idempotencyKey: `${command.tenantId}:${data.seriesId}:${data.asOfUnixMs}`,
      }),
    ];
  }

  static getAggregateId(payload: ContributeMetricFactsCommandData): string {
    return payload.sessionId;
  }

  static getSpanAttributes(
    payload: ContributeMetricFactsCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.coding_agent.session_id": payload.sessionId,
      "payload.coding_agent.agent": payload.agent,
      "payload.coding_agent.metric_name": payload.metricName,
    };
  }
}
