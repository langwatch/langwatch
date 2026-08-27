import {
  spanTreeDeltaInputSchema,
  spanTreeInputSchema,
  spanTreeNodeSchema,
  spanTreePageSchema,
  evaluationTraceEventSchema,
  evaluationTraceReadInputSchema,
  evaluationTraceSpanSchema,
  traceIngestWaitInputSchema,
  traceByIdInputSchema,
  traceDerivedEventsInputSchema,
  traceRecordSchema,
  traceQueryClassificationInputSchema,
  traceQueryClassificationSchema,
  traceQueryFieldCatalogueInputSchema,
  traceQueryFieldCatalogueOutputSchema,
  traceSummaryLookupInputSchema,
  TraceService as TraceServiceContract,
  type SpanTreeNode,
  type SpanTreeDeltaInput,
  type SpanTreePage,
  type SpanTreeInput,
  type TraceQueryFieldCatalogueInput,
  type TraceQueryClassification,
  type TraceQueryClassificationInput,
  type TraceIngestWaitInput,
  type TraceByIdInput,
  type TraceDerivedEventsInput,
  type TraceRecord,
  type DerivedTraceEvent,
  type TraceSummaryData,
  type TraceSummaryLookupInput,
  type EvaluationTraceEvent,
  type EvaluationTraceReadInput,
  type EvaluationTraceSpan,
} from "@langwatch/trace-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";

import type { TraceQueryFieldValuesPort } from "../ports/query-field-values.port";
import type { TraceQueryClassificationPort } from "../ports/trace-query-classification.port";
import type { TraceSummaryReaderPort } from "../ports/trace-summary-reader.port";
import type { TraceRecordPort } from "../ports/trace-record.port";
import type { TraceEventDerivationPort } from "../ports/trace-event-derivation.port";
import { TraceRepository, type TraceSpanSummaryRecord } from "../ports/trace.port";
import { TraceQueryFieldCatalogueService } from "./trace-query-field-catalogue.service";

type TraceComposition = {
  repository: TraceRepository;
  modelProviders: ModelProviderService;
  queryFieldValues: TraceQueryFieldValuesPort;
  queryClassification: TraceQueryClassificationPort;
  summaryReader: TraceSummaryReaderPort;
  records: TraceRecordPort;
  eventDerivation: TraceEventDerivationPort;
};

const DEFAULT_INGEST_WAIT_MS = 30_000;
const MIN_INGEST_WAIT_MS = 10_000;
const MAX_INGEST_WAIT_MS = 30_000;
const MIN_INGEST_SAMPLE_COUNT = 20;
const INGEST_WAIT_CACHE_TTL_MS = 60 * 60 * 1000;

function gateCosts(nodes: SpanTreeNode[], canSeeCosts: boolean): SpanTreeNode[] {
  if (canSeeCosts) {
    return nodes;
  }

  return nodes.map((node) => ({ ...node, cost: null }));
}

export class TraceService extends TraceServiceContract {
  private readonly queryFieldCatalogue: TraceQueryFieldCatalogueService;
  private readonly ingestWaitCache = new Map<string, { timeoutMs: number; expiresAt: number }>();

  private constructor(private readonly composition: TraceComposition) {
    super();
    this.queryFieldCatalogue = TraceQueryFieldCatalogueService.create(composition.queryFieldValues);
  }

  static create(composition: TraceComposition): TraceService {
    return new TraceService(composition);
  }

  async getById(input: TraceByIdInput): Promise<TraceRecord> {
    const parsed = traceByIdInputSchema.parse(input);
    const trace = await this.composition.records.getById(parsed);

    return traceRecordSchema.parse(trace);
  }

  async deriveEvents(input: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]> {
    const parsed = traceDerivedEventsInputSchema.parse(input);

    return this.composition.eventDerivation.derive(parsed);
  }

  async getEvaluationSpans(input: EvaluationTraceReadInput): Promise<EvaluationTraceSpan[]> {
    const parsed = evaluationTraceReadInputSchema.parse(input);
    const spans = await this.composition.repository.findEvaluationSpans(parsed);

    return evaluationTraceSpanSchema.array().parse(spans);
  }

  async getEvaluationEvents(input: EvaluationTraceReadInput): Promise<EvaluationTraceEvent[]> {
    const parsed = evaluationTraceReadInputSchema.parse(input);
    const events = await this.composition.repository.findEvaluationEvents(parsed);

    return evaluationTraceEventSchema.array().parse(events);
  }

  async getSpanTreePage(input: SpanTreeInput): Promise<SpanTreePage> {
    const parsed = spanTreeInputSchema.parse(input);
    const page = await this.composition.repository.findSummaryPage({
      tenantId: parsed.projectId,
      traceId: parsed.traceId,
      limit: parsed.limit,
      cursor: parsed.cursor,
      occurredAtMs: parsed.occurredAtMs,
    });
    const nodes = gateCosts(
      page.rows.map((row) => this.price(row)),
      parsed.canSeeCosts,
    );
    const last = page.rows.at(-1);

    if (page.hasMore && !last) {
      throw new Error("span-summary page reported hasMore without any rows to key the cursor from");
    }

    return spanTreePageSchema.parse({
      nodes,
      nextCursor:
        page.hasMore && last ? { startTimeMs: last.startTimeMs, spanId: last.spanId } : null,
    });
  }

  async getSpanTreeDelta(input: SpanTreeDeltaInput): Promise<SpanTreeNode[]> {
    const parsed = spanTreeDeltaInputSchema.parse(input);
    const rows = await this.composition.repository.findSummarySince({
      tenantId: parsed.projectId,
      traceId: parsed.traceId,
      sinceUpdatedAtMs: parsed.sinceUpdatedAtMs,
    });

    return spanTreeNodeSchema.array().parse(
      gateCosts(
        rows.map((row) => this.price(row)),
        parsed.canSeeCosts,
      ),
    );
  }

  async buildQueryFieldCatalogue(input: TraceQueryFieldCatalogueInput): Promise<string> {
    const parsed = traceQueryFieldCatalogueInputSchema.parse(input);
    const catalogue = await this.queryFieldCatalogue.build(parsed);

    return traceQueryFieldCatalogueOutputSchema.parse(catalogue);
  }

  classifyQuery(input: TraceQueryClassificationInput): TraceQueryClassification {
    const parsed = traceQueryClassificationInputSchema.parse(input);

    return traceQueryClassificationSchema.parse(
      this.composition.queryClassification.classify(parsed.query),
    );
  }

  async resolveIngestWaitTimeout(input: TraceIngestWaitInput): Promise<number> {
    const parsed = traceIngestWaitInputSchema.parse(input);
    const now = Date.now();
    const cached = this.ingestWaitCache.get(parsed.projectId);
    if (cached && cached.expiresAt > now) {
      return cached.timeoutMs;
    }

    if (cached) {
      this.ingestWaitCache.delete(parsed.projectId);
    }

    try {
      const sample = await this.composition.repository.tryFindIngestLag({
        tenantId: parsed.projectId,
      });
      if (!sample || sample.sampleCount < MIN_INGEST_SAMPLE_COUNT) {
        return DEFAULT_INGEST_WAIT_MS;
      }

      const measured = Math.ceil(1.25 * sample.p95LagMs + 5_000);
      const timeoutMs = Math.min(Math.max(measured, MIN_INGEST_WAIT_MS), MAX_INGEST_WAIT_MS);
      this.ingestWaitCache.set(parsed.projectId, {
        timeoutMs,
        expiresAt: now + INGEST_WAIT_CACHE_TTL_MS,
      });

      return timeoutMs;
    } catch {
      return DEFAULT_INGEST_WAIT_MS;
    }
  }

  async tryGetSummary(input: TraceSummaryLookupInput): Promise<TraceSummaryData | null> {
    const parsed = traceSummaryLookupInputSchema.parse(input);

    return await this.composition.summaryReader.tryGetSummary({
      tenantId: parsed.projectId,
      traceId: parsed.traceId,
    });
  }

  private price({ costInput, cost, ...node }: TraceSpanSummaryRecord): SpanTreeNode {
    if (cost !== null) {
      return { ...node, cost };
    }

    const computed = this.composition.modelProviders.estimateCost(costInput);

    return { ...node, cost: computed > 0 ? computed : null };
  }
}
