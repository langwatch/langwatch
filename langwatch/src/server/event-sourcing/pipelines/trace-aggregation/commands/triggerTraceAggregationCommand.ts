import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { Command, CommandHandler } from "../../../library";
import { EventUtils, createTenantId } from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { TriggerTraceAggregationCommandData } from "../schemas/commands";
import { triggerTraceAggregationCommandDataSchema } from "../schemas/commands";
import type {
  TraceAggregationEvent,
  TraceAggregationCompletedEvent,
} from "../schemas/events";
import { createLogger } from "../../../../../utils/logger";
import { getClickHouseClient } from "../../../../../utils/clickhouse";
import { SpanRepositoryClickHouse } from "../../span-ingestion/repositories/spanRepositoryClickHouse";
import { SpanRepositoryMemory } from "../../span-ingestion/repositories/spanRepositoryMemory";
import type { SpanRepository } from "../../span-ingestion/repositories/spanRepository";
import { traceAggregationService } from "../services/traceAggregationService";

/**
 * Command handler for triggering trace aggregation.
 * Fetches all spans for the trace, aggregates them, and emits a completed event.
 */
export class TriggerTraceAggregationCommand
  implements
    CommandHandler<
      Command<TriggerTraceAggregationCommandData>,
      TraceAggregationEvent
    >
{
  static readonly schema = defineCommandSchema(
    "lw.obs.trace_aggregation.trigger",
    triggerTraceAggregationCommandDataSchema,
    "Command to trigger trace aggregation",
  );

  tracer = getLangWatchTracer(
    "langwatch.trace-aggregation-trigger.command-handler",
  );
  logger = createLogger("langwatch:trace-aggregation-trigger:command-handler");
  private readonly spanRepository: SpanRepository;

  constructor() {
    // Initialize repository
    const clickHouseClient = getClickHouseClient();
    this.spanRepository = clickHouseClient
      ? new SpanRepositoryClickHouse(clickHouseClient)
      : new SpanRepositoryMemory();
  }

  async handle(
    command: Command<TriggerTraceAggregationCommandData>,
  ): Promise<TraceAggregationEvent[]> {
    return await this.tracer.withActiveSpan(
      "TriggerTraceAggregationCommand.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "command.type": command.type,
          "command.aggregate_id": command.aggregateId,
          "tenant.id": command.tenantId,
        },
      },
      async () => {
        const { traceId, spanId } = command.data;
        const { tenantId } = command;

        this.logger.debug(
          {
            tenantId,
            traceId,
            spanId,
          },
          "Handling trace aggregation trigger command",
        );

        const tenantIdObj = createTenantId(tenantId);

        // Fetch all spans for the trace
        const spans = await this.spanRepository.getSpansByTraceId(
          tenantId,
          traceId,
        );

        if (spans.length === 0) {
          this.logger.warn(
            {
              tenantId,
              traceId,
            },
            "No spans found for trace, cannot aggregate",
          );
          // Return empty array - no event to emit
          return [];
        }

        // Aggregate trace metadata
        const aggregatedData = traceAggregationService.aggregateTrace(spans);

        this.logger.debug(
          {
            tenantId,
            traceId,
            spanId,
            totalSpans: aggregatedData.totalSpans,
          },
          "Trace aggregated successfully",
        );

        // Emit completed event with all computed metrics
        const completedEvent = EventUtils.createEvent<TraceAggregationCompletedEvent>(
          "trace_aggregation",
          traceId,
          tenantIdObj,
          "lw.obs.trace_aggregation.completed",
          aggregatedData,
          {
            traceId,
          },
        );

        return [completedEvent];
      },
    );
  }

  static getAggregateId(payload: TriggerTraceAggregationCommandData): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: TriggerTraceAggregationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
    };
  }

  static makeJobId(payload: TriggerTraceAggregationCommandData): string {
    return `${payload.tenantId}:${payload.traceId}:${payload.spanId}`;
  }
}
