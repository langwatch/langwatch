import {
  TraceNotFoundError,
  type TraceByIdInput,
  type TraceDerivedEventsInput,
} from "@langwatch/trace-contract";
import { TraceEventDerivation } from "./app/trace.infrastructure.ts";
import { TraceQueryClassifier } from "./app/trace.infrastructure.ts";
import { TraceRecordRepository } from "./repositories/read/trace-record.repository.ts";
import { TraceSummaryReaderRepository } from "./repositories/read/trace-summary-reader.repository.ts";
import { TracePayloadReaderRepository } from "./repositories/read/trace-payload-reader.repository.ts";

export { TraceCanonicalisationService } from "./services/canonicalisers/trace-canonicalisation.service.ts";
export { SpanNormalizationPipelineService } from "./services/span/span-normalization.service.ts";
export { storedSpanReadBack } from "./repositories/clickhouse/__tests__/stored-span-row.test-fakes.ts";
export { TraceSpanCostMatchingService } from "./services/span/trace-span-cost-matching.service.ts";
export { ClickHouseTraceQuerySubqueryAdapter } from "./repositories/clickhouse/trace-query-subquery.clickhouse.adapter.ts";

export class MissingTraceRecordRepository extends TraceRecordRepository {
  async getById(input: TraceByIdInput): Promise<never> {
    throw new TraceNotFoundError(input.traceId);
  }
}

export class EmptyTraceEventDerivationPort implements TraceEventDerivation {
  async derive(_input: TraceDerivedEventsInput): Promise<[]> {
    return [];
  }
}

export class EmptyTraceSummaryReaderRepository extends TraceSummaryReaderRepository {
  async tryGetSummary(): Promise<null> {
    return null;
  }
}

export class EmptyTraceQueryClassificationPort implements TraceQueryClassifier {
  classify() {
    return { evaluations: false, events: false, spans: false };
  }
}

export class EmptyTracePayloadReaderRepository extends TracePayloadReaderRepository {
  async tryRead(): Promise<null> {
    return null;
  }
}
