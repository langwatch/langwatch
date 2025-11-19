import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { EventReactionHandler } from "../../../library";
import type { SpanIngestionRecordedEvent } from "../../../schemas/events/spanIngestion.schema";
import { createLogger } from "../../../../../utils/logger";
import { traceAggregationPipeline } from "../../trace-aggregation/pipeline";

export class TraceAggregationTriggerHandler
  implements EventReactionHandler<SpanIngestionRecordedEvent>
{
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-aggregation-trigger.handler",
  );
  private readonly logger = createLogger(
    "langwatch:trace-aggregation-trigger:handler",
  );

  async handle(event: SpanIngestionRecordedEvent): Promise<void> {
    return await this.tracer.withActiveSpan(
      "TraceAggregationTriggerHandler.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "event.type": event.type,
          "event.aggregate_id": event.aggregateId,
          "event.span_id": event.data.spanId,
          "tenant.id": event.tenantId,
        },
      },
      async () => {
        const { traceId } = event.data;
        const { tenantId } = event;

        this.logger.debug(
          {
            tenantId,
            traceId,
            spanId: event.data.spanId,
          },
          "Triggering trace aggregation",
        );

        // The trace aggregation pipeline will handle checking if aggregation is in progress
        // and aggregating the trace data
        await traceAggregationPipeline.commands.triggerTraceAggregation.send({
          traceId,
          tenantId,
        });

        this.logger.debug(
          {
            tenantId,
            traceId,
          },
          "Trace aggregation triggered",
        );
      },
    );
  }

  getEventTypes() {
    return ["lw.obs.span_ingestion.recorded"] as const;
  }
}
