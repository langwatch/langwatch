import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClient } from "../../../../../utils/clickhouse";
import { createLogger } from "../../../../../utils/logger";
import type { Command, CommandHandler } from "../../../library";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../library";
import { ValidationError } from "../../../library/services/errorHandling";
import type { SpanRepository } from "../../span-ingestion/repositories/spanRepository";
import { SpanRepositoryClickHouse } from "../../span-ingestion/repositories/spanRepositoryClickHouse";
import { SpanRepositoryMemory } from "../../span-ingestion/repositories/spanRepositoryMemory";
import type { TriggerTraceAggregationCommandData } from "../schemas/commands";
import { triggerTraceAggregationCommandDataSchema } from "../schemas/commands";
import type {
  TraceAggregationCompletedEvent,
  TraceAggregationCompletedEventData,
  TraceAggregationEvent,
} from "../schemas/events";
import type { TraceAggregationService } from "../services/traceAggregationService";
import { traceAggregationService as defaultTraceAggregationService } from "../services/traceAggregationService";

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
  private readonly aggregationService: TraceAggregationService;

  constructor(aggregationService?: TraceAggregationService) {
    // Initialize repository
    const clickHouseClient = getClickHouseClient();
    this.spanRepository = clickHouseClient
      ? new SpanRepositoryClickHouse(clickHouseClient)
      : new SpanRepositoryMemory();
    // Use provided service or default to singleton for backward compatibility
    this.aggregationService =
      aggregationService ?? defaultTraceAggregationService;
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
        const { traceId, spanId, tenantId: payloadTenantId } = command.data;
        const { tenantId } = command;

        // Validate that command.tenantId matches payload.tenantId
        // command.tenantId is the single source of truth for tenant isolation
        if (tenantId !== payloadTenantId) {
          throw new ValidationError(
            "Command tenantId must match payload tenantId",
            "tenantId",
            { commandTenantId: tenantId, payloadTenantId },
            {
              commandType: command.type,
              aggregateId: command.aggregateId,
              traceId,
            },
          );
        }

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

        let aggregatedData: TraceAggregationCompletedEventData;

        if (spans.length === 0) {
          this.logger.warn(
            {
              tenantId,
              traceId,
            },
            "No spans found for trace, emitting completed event with empty aggregation",
          );
          // Emit completed event with empty aggregation data
          // This ensures the trace aggregation state is properly initialized even when no spans exist
          aggregatedData = this.createEmptyAggregationData(traceId);
        } else {
          // Aggregate trace metadata
          aggregatedData = this.aggregationService.aggregateTrace(spans);
        }

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
        const completedEvent =
          EventUtils.createEvent<TraceAggregationCompletedEvent>(
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

  /**
   * Creates empty aggregation data for traces with no spans.
   * This ensures trace aggregation state is properly initialized even when no spans exist.
   */
  private createEmptyAggregationData(
    traceId: string,
  ): TraceAggregationCompletedEventData {
    const now = Date.now();
    return {
      traceId,
      spanIds: [],
      totalSpans: 0,
      startTimeUnixMs: now,
      endTimeUnixMs: now,
      durationMs: 0,
      serviceNames: [],
      rootSpanId: null,
      IOSchemaVersion: "2025-11-23",
      ComputedInput: null,
      ComputedOutput: null,
      ComputedMetadata: {},
      TimeToFirstTokenMs: null,
      TimeToLastTokenMs: null,
      TokensPerSecond: null,
      ContainsErrorStatus: false,
      ContainsOKStatus: false,
      Models: [],
      TopicId: null,
      SubTopicId: null,
      TotalPromptTokenCount: null,
      TotalCompletionTokenCount: null,
      HasAnnotation: null,
    };
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

  /**
   * Generates a unique job ID for idempotency.
   * Note: This static method only receives the payload, not the full command.
   * The handler validates that payload.tenantId matches command.tenantId to ensure consistency.
   */
  static makeJobId(payload: TriggerTraceAggregationCommandData): string {
    return `${payload.tenantId}:${payload.traceId}:${payload.spanId}`;
  }
}
