import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { EventHandler } from "../../../library";
import type { SpanIngestionRecordedEvent } from "../schemas/events";
import { createLogger } from "../../../../../utils/logger";
import { traceAggregationPipeline } from "../../trace-aggregation/pipeline";

export class TraceAggregationTriggerHandler
  implements EventHandler<SpanIngestionRecordedEvent>
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
        const { traceId, spanId } = event.data;
        const { tenantId } = event;

        this.logger.debug(
          {
            tenantId,
            traceId,
            spanId,
          },
          "Triggering trace aggregation",
        );

        // The trace aggregation pipeline will aggregate all spans for the trace
        // and compute trace metrics
        await traceAggregationPipeline.commands.triggerTraceAggregation.send({
          traceId,
          tenantId,
          spanId,
        });

        this.logger.debug(
          {
            tenantId,
            traceId,
            spanId,
          },
          "Trace aggregation triggered",
        );
      },
    );
  }

  static getEventTypes() {
    return ["lw.obs.span_ingestion.recorded"] as const;
  }
}
