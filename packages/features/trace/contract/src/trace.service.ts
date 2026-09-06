import type { SpanTreeNode, SpanTreePage } from "./trace.ts";
import type {
  EvaluationTraceEvent,
  EvaluationTraceReadInput,
  EvaluationTraceSpan,
} from "./trace-evaluation.contract.ts";
import type {
  TraceQueryClassification,
  TraceQueryClassificationInput,
  TraceQueryFieldCatalogueInput,
} from "./trace-query.contract.ts";
import type {
  SpanTreeDeltaInput,
  SpanTreeInput,
  TraceIngestWaitInput,
  TraceByIdInput,
  TraceDerivedEventsInput,
  TraceSummaryLookupInput,
} from "./trace.queries.ts";
import type { DerivedTraceEvent } from "./trace-derived-event.ts";
import type { TraceSummaryData } from "./trace-projection.ts";
import type { TraceRecord } from "./trace-record.ts";
import type {
  TraceFullReadInput,
  TraceFullRecord,
  TraceFullThreadReadInput,
} from "./trace-full-read.contract.ts";

/** Canonical trace reads closed under payload-parity review. */
export abstract class TraceService {
  abstract getById(input: TraceByIdInput): Promise<TraceRecord>;

  abstract getFullRecord(input: TraceFullReadInput): Promise<TraceFullRecord>;

  abstract getFullThread(input: TraceFullThreadReadInput): Promise<TraceFullRecord[]>;

  abstract deriveEvents(input: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]>;

  abstract getEvaluationSpans(input: EvaluationTraceReadInput): Promise<EvaluationTraceSpan[]>;

  abstract getEvaluationEvents(input: EvaluationTraceReadInput): Promise<EvaluationTraceEvent[]>;

  abstract getSpanTreePage(input: SpanTreeInput): Promise<SpanTreePage>;

  abstract getSpanTreeDelta(input: SpanTreeDeltaInput): Promise<SpanTreeNode[]>;

  abstract buildQueryFieldCatalogue(input: TraceQueryFieldCatalogueInput): Promise<string>;

  abstract classifyQuery(input: TraceQueryClassificationInput): TraceQueryClassification;

  abstract resolveIngestWaitTimeout(input: TraceIngestWaitInput): Promise<number>;

  abstract tryGetSummary(input: TraceSummaryLookupInput): Promise<TraceSummaryData | null>;
}
