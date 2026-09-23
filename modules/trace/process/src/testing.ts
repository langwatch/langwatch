import {
  TraceNotFoundError,
  type TraceByIdInput,
  type TraceDerivedEventsInput,
  type TraceQueryClassification,
} from "@langwatch/trace-contract";

import { type TraceEventDerivation, type TraceQueryClassifier } from "./app/trace.members.ts";
import { TracePayloadReaderRepository } from "./repositories/trace-payload-reader.repository.ts";
import { TraceRecordRepository } from "./repositories/trace-record.repository.ts";
import { TraceSummaryReaderRepository } from "./repositories/trace-summary-reader.repository.ts";

export { TraceCanonicalisationService } from "./services/trace-canonicalisation.service.ts";
export { SpanNormalizationPipelineService } from "./services/span-normalization.service.ts";
export { storedSpanReadBack } from "./repositories/clickhouse/__tests__/stored-span-row.test-fakes.ts";
export { TraceSpanCostMatchingService } from "./services/trace-span-cost-matching.service.ts";
export { ClickHouseTraceQuerySubqueryRepository } from "./repositories/clickhouse/clickhouse.trace-query-subquery.repository.ts";

export class MissingTraceRecordRepository extends TraceRecordRepository {
  async getById(input: TraceByIdInput): Promise<never> {
    throw new TraceNotFoundError(input.traceId);
  }
}

export class EmptyTraceEventDerivation implements TraceEventDerivation {
  async derive(_input: TraceDerivedEventsInput): Promise<[]> {
    return [];
  }
}

export class EmptyTraceSummaryReaderRepository extends TraceSummaryReaderRepository {
  async findSummary(): Promise<null> {
    return null;
  }
}

export class EmptyTraceQueryClassification implements TraceQueryClassifier {
  classify(): TraceQueryClassification {
    return { evaluations: false, events: false, spans: false };
  }
}

export class EmptyTracePayloadReaderRepository extends TracePayloadReaderRepository {
  async read(): Promise<string> {
    throw new Error("this test double holds no offloaded payloads");
  }
}
