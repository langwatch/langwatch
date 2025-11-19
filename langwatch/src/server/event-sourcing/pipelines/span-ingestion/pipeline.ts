import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { eventSourcing } from "../../runtime";
import type { SpanIngestionEvent } from "../../types/events/spanIngestion";
import { TraceAggregationTriggerHandler } from "./eventHandlers/traceAggregationTriggerHandler";

export const spanIngestionPipeline = eventSourcing
  .registerPipeline<SpanIngestionEvent>()
  .withName("span-ingestion")
  .withAggregateType("span")
  .withCommandHandler(RecordSpanCommand)
  .withEventHandler(
    "trace-aggregation-trigger",
    new TraceAggregationTriggerHandler(),
    {
      eventTypes: ["lw.obs.span.ingestion.recorded"],
    },
  )
  .build();
