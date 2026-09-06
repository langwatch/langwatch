import {
  TraceNotFoundError,
  type TraceByIdInput,
  type TraceDerivedEventsInput,
} from "@langwatch/trace-contract";
import { TraceEventDerivationPort } from "./ports/trace-event-derivation.port.ts";
import { TraceQueryClassificationPort } from "./ports/trace-query-classification.port.ts";
import { TraceRecordPort } from "./ports/trace-record.port.ts";
import { TraceSummaryReaderPort } from "./ports/trace-summary-reader.port.ts";
import { TracePayloadReaderPort } from "./ports/trace-payload-reader.port.ts";

export { TraceCanonicalisationService } from "./services/trace-canonicalisation.service.ts";
export { SpanNormalizationPipelineService } from "./services/span-normalization.service.ts";
export { storedSpanReadBack } from "./repositories/clickhouse/__tests__/stored-span-row.test-fakes.ts";
export { TraceSpanCostMatchingService } from "./services/trace-span-cost-matching.service.ts";
export { ClickHouseTraceQuerySubqueryAdapter } from "./adapters/trace-query-subquery.clickhouse.adapter.ts";

export class MissingTraceRecordPort extends TraceRecordPort {
  async getById(input: TraceByIdInput): Promise<never> {
    throw new TraceNotFoundError(input.traceId);
  }
}

export class EmptyTraceEventDerivationPort extends TraceEventDerivationPort {
  async derive(_input: TraceDerivedEventsInput): Promise<[]> {
    return [];
  }
}

export class EmptyTraceSummaryReaderPort extends TraceSummaryReaderPort {
  async tryGetSummary(): Promise<null> {
    return null;
  }
}

export class EmptyTraceQueryClassificationPort extends TraceQueryClassificationPort {
  classify() {
    return { evaluations: false, events: false, spans: false };
  }
}

export class EmptyTracePayloadReaderPort extends TracePayloadReaderPort {
  async tryRead(): Promise<null> {
    return null;
  }
}
