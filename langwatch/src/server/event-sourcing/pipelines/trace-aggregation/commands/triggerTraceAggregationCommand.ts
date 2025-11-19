import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { Command, CommandHandler } from "../../../library";
import { EventUtils, createTenantId } from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { TriggerTraceAggregationCommandData } from "../../../schemas/commands/traceAggregation.schema";
import { triggerTraceAggregationCommandDataSchema } from "../../../schemas/commands/traceAggregation.schema";
import type {
  TraceAggregationEvent,
  TraceAggregationStartedEvent,
  TraceAggregationCompletedEvent,
  TraceAggregationCancelledEvent,
} from "../../../schemas/events/traceAggregation.schema";
import { createLogger } from "../../../../../utils/logger";
import { getClickHouseClient } from "../../../../../utils/clickhouse";
import { SpanRepositoryClickHouse } from "../../span-ingestion/repositories/spanRepositoryClickHouse";
import { SpanRepositoryMemory } from "../../span-ingestion/repositories/spanRepositoryMemory";
import type { SpanRepository } from "../../span-ingestion/repositories/spanRepository";
import { traceAggregationService } from "../services/traceAggregationService";
import type { TraceAggregationStateProjection } from "../projections/traceAggregationStateProjection";
import { traceAggregationPipeline } from "../pipeline";

/**
 * Self-contained command handler for triggering trace aggregation.
 * Checks if aggregation is already in progress using projection state,
 * and if not, fetches all spans for the trace and aggregates them.
 */
export class TriggerTraceAggregationCommand
  implements
    CommandHandler<
      Command<TriggerTraceAggregationCommandData>,
      TraceAggregationEvent
    >
{
  static readonly dispatcherName = "triggerTraceAggregation" as const;
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
    // Initialize repository (same pattern as RecordSpanCommand)
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
        const { traceId } = command.data;
        const { tenantId } = command;

        this.logger.debug(
          {
            tenantId,
            traceId,
          },
          "Handling trace aggregation trigger command",
        );

        // Check current projection state to see if aggregation is already in progress
        const currentProjection = await this.getCurrentProjectionState(
          traceId,
          tenantId,
        );

        const events: TraceAggregationEvent[] = [];

        // If aggregation is already in progress, emit cancellation event first
        if (currentProjection?.data.aggregationStatus === "in_progress") {
          this.logger.debug(
            {
              tenantId,
              traceId,
            },
            "Trace aggregation already in progress, cancelling previous aggregation",
          );

          // Emit cancellation event
          const cancelledEvent =
            EventUtils.createEventWithProcessingTraceContext<
              TraceAggregationCancelledEvent["data"],
              TraceAggregationCancelledEvent["metadata"]
            >(
              traceId,
              createTenantId(tenantId),
              "lw.obs.trace_aggregation.cancelled",
              {
                traceId,
                reason: "New aggregation triggered",
              },
              {
                traceId,
              },
            ) as TraceAggregationCancelledEvent;

          events.push(cancelledEvent);
        }

        // Emit started event
        const startedEvent = EventUtils.createEventWithProcessingTraceContext<
          TraceAggregationStartedEvent["data"],
          TraceAggregationStartedEvent["metadata"]
        >(
          traceId,
          createTenantId(tenantId),
          "lw.obs.trace_aggregation.started",
          {
            traceId,
          },
          {
            traceId,
          },
        ) as TraceAggregationStartedEvent;

        // Fetch all spans for the trace
        const spans = await this.spanRepository.getSpansByTraceId(
          tenantId,
          traceId,
        );

        events.push(startedEvent);

        if (spans.length === 0) {
          this.logger.warn(
            {
              tenantId,
              traceId,
            },
            "No spans found for trace, cannot aggregate",
          );
          // Still emit started event, but no completed event
          return events;
        }

        // Aggregate trace metadata
        const aggregatedData = traceAggregationService.aggregateTrace(spans);

        this.logger.debug(
          {
            tenantId,
            traceId,
            totalSpans: aggregatedData.totalSpans,
          },
          "Trace aggregated successfully",
        );

        // Emit completed event
        const completedEvent = EventUtils.createEventWithProcessingTraceContext<
          TraceAggregationCompletedEvent["data"],
          TraceAggregationCompletedEvent["metadata"]
        >(
          traceId,
          createTenantId(tenantId),
          "lw.obs.trace_aggregation.completed",
          aggregatedData,
          {
            traceId,
          },
        ) as TraceAggregationCompletedEvent;

        events.push(completedEvent);
        return events;
      },
    );
  }

  /**
   * Gets the current projection state from the pipeline service.
   * The library handles keeping projections up-to-date automatically.
   */
  private async getCurrentProjectionState(
    traceId: string,
    tenantId: string,
  ): Promise<TraceAggregationStateProjection | null> {
    try {
      const projection =
        await traceAggregationPipeline.service.getProjectionByName(
          "state",
          traceId,
          {
            tenantId: createTenantId(tenantId),
          },
        );
      return projection as TraceAggregationStateProjection | null;
    } catch (error) {
      // If projection doesn't exist or can't be retrieved, that's okay - it means no aggregation has started
      this.logger.debug(
        {
          tenantId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Could not get current projection state, assuming idle",
      );
      return null;
    }
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
    return `${payload.tenantId}:${payload.traceId}`;
  }
}
