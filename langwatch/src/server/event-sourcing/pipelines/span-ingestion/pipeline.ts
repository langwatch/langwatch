import { eventSourcing } from "../../runtime";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { TraceAggregationTriggerHandler } from "./eventHandlers/traceAggregationTriggerHandler";
import type { SpanIngestionEvent } from "./schemas/events";

export const spanIngestionPipeline = eventSourcing
  .registerPipeline<SpanIngestionEvent>()
  .withName("span_ingestion")
  .withAggregateType("span_ingestion")
  .withCommand("recordSpan", RecordSpanCommand)
  .withEventHandler("traceAggregationTrigger", TraceAggregationTriggerHandler)
  .build();
