import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { eventSourcing } from "../../runtime";
import { TraceAggregationTriggerHandler } from "./eventHandlers/traceAggregationTriggerHandler";
import type { SpanIngestionEvent } from "./schemas/events";

export const spanIngestionPipeline = eventSourcing
  .registerPipeline<SpanIngestionEvent>()
  .withName("span-ingestion")
  .withAggregateType("span_ingestion")
  .withCommandHandler(RecordSpanCommand)
  .withEventHandler(
    "trace-aggregation-trigger",
    new TraceAggregationTriggerHandler(),
    {
      eventTypes: ["lw.obs.span_ingestion.recorded"],
    },
  )
  .build();
