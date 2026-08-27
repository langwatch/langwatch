import type { SpanTreeNode, SpanTreePage } from "./trace";
import type {
  EvaluationTraceEvent,
  EvaluationTraceReadInput,
  EvaluationTraceSpan,
} from "./trace-evaluation.contract";
import type {
  TraceQueryClassification,
  TraceQueryClassificationInput,
  TraceQueryFieldCatalogueInput,
} from "./trace-query.contract";
import type {
  SpanTreeDeltaInput,
  SpanTreeInput,
  TraceIngestWaitInput,
  TraceByIdInput,
  TraceDerivedEventsInput,
  TraceSummaryLookupInput,
} from "./trace.queries";
import type { DerivedTraceEvent } from "./trace-derived-event";
import type { TraceSummaryData } from "./trace-projection";
import type { TraceRecord } from "./trace-record";

/** Canonical trace reads closed under payload-parity review. */
export abstract class TraceService {
  abstract getById(input: TraceByIdInput): Promise<TraceRecord>;

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
