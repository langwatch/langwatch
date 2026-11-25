import type { Authorization } from "@langwatch/authorization";
import type { FoldReadAuthorizer } from "@langwatch/eventing";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { nowInstant } from "@langwatch/time";
import {
  spanTreeInputSchema,
  spanTreeNodeSchema,
  spanTreePageSchema,
  evaluationTraceReadInputSchema,
  traceIngestWaitInputSchema,
  traceByIdInputSchema,
  traceDerivedEventsInputSchema,
  traceFullReadInputSchema,
  traceFullThreadReadInputSchema,
  traceQueryClassificationInputSchema,
  traceQueryClassificationSchema,
  traceQueryFieldCatalogueInputSchema,
  traceQueryFieldCatalogueOutputSchema,
  traceSummaryLookupInputSchema,
  type SpanTreeNode,
  type SpanTreeDeltaInput,
  type SpanTreePage,
  type SpanTreeInput,
  type TraceQueryFieldCatalogueInput,
  type TraceQueryClassification,
  type TraceQueryClassificationInput,
  type TraceIngestWaitInput,
  type TraceSettleSettings,
  type TraceByIdInput,
  type TraceDerivedEventsInput,
  type TraceRecord,
  type DerivedTraceEvent,
  type TraceSummaryData,
  type TraceSummaryLookupInput,
  type EvaluationTraceEvent,
  type EvaluationTraceReadInput,
  type EvaluationTraceSpan,
  type TraceFullReadInput,
  type TraceFullRecord,
  type TraceFullThreadReadInput,
} from "@langwatch/trace-contract";

import type { TraceQueryFieldValuesRepository } from "../features/query/repositories/query-field-values.repository.ts";
import type { TraceQueryClassifier } from "../features/query/services/trace-query-classification.service.ts";
import { TraceQueryFieldCatalogueService } from "../features/query/services/trace-query-field-catalogue.service.ts";
import {
  DEFAULT_TRACE_SETTLE_SETTINGS,
  MIN_INGEST_SAMPLE_COUNT,
  settleSettingsFromSample,
} from "../features/read/rules/trace-settle-settings.rules.ts";
import type { TraceFullRecordRepository } from "../repositories/trace-full-record.repository.ts";
import {
  type TraceProjectedReadRepository,
  type TraceSpanSummaryRecord,
} from "../repositories/trace-projected-read.repository.ts";
import type { TraceRecordRepository } from "../repositories/trace-record.repository.ts";
import type { TraceSummaryReaderRepository } from "../repositories/trace-summary-reader.repository.ts";

export interface TraceEventDerivation {
  derive(input: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]>;
}

const spanTreeNodesSchema = spanTreeNodeSchema.array();

type TraceComposition = {
  repository: TraceProjectedReadRepository;
  modelProviders: ModelProviderApi;
  queryFieldValues: TraceQueryFieldValuesRepository;
  queryClassification: TraceQueryClassifier;
  summaryReader: TraceSummaryReaderRepository;
  records: TraceRecordRepository;
  eventDerivation: TraceEventDerivation;
  fullRecords: TraceFullRecordRepository;
  /** Mints the own-only proof for the reads whose `*Api` names a tenant, not a proof. */
  authorize: FoldReadAuthorizer;
};

const INGEST_WAIT_CACHE_TTL_MS = 60 * 60 * 1000;

function gateCosts(nodes: SpanTreeNode[], canSeeCosts: boolean): SpanTreeNode[] {
  if (canSeeCosts) {
    return nodes;
  }

  return nodes.map((node) => ({ ...node, cost: null }));
}

export class TraceService {
  private readonly queryFieldCatalogue: TraceQueryFieldCatalogueService;
  private readonly ingestWaitCache = new Map<
    string,
    { settings: TraceSettleSettings; expiresAt: number }
  >();

  private constructor(private readonly composition: TraceComposition) {
    this.queryFieldCatalogue = TraceQueryFieldCatalogueService.create(composition.queryFieldValues);
  }

  static create(composition: TraceComposition): TraceService {
    return new TraceService(composition);
  }

  async getById(input: TraceByIdInput): Promise<TraceRecord> {
    const parsed = traceByIdInputSchema.parse(input);

    return this.composition.records.getById(parsed);
  }

  async getFullRecord(input: TraceFullReadInput): Promise<TraceFullRecord> {
    const parsed = traceFullReadInputSchema.parse(input);

    return this.composition.fullRecords.get(parsed);
  }

  async getFullThread(input: TraceFullThreadReadInput): Promise<TraceFullRecord[]> {
    const parsed = traceFullThreadReadInputSchema.parse(input);

    return this.composition.fullRecords.findThread(parsed);
  }

  async deriveEvents(input: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]> {
    const parsed = traceDerivedEventsInputSchema.parse(input);

    return this.composition.eventDerivation.derive(parsed);
  }

  async getEvaluationSpans(input: EvaluationTraceReadInput): Promise<EvaluationTraceSpan[]> {
    const { tenantId, ...read } = evaluationTraceReadInputSchema.parse(input);

    return this.composition.repository.findEvaluationSpans({
      ...read,
      authorization: await this.ownProof({
        projectId: tenantId,
        entry: "TraceService.getEvaluationSpans",
      }),
    });
  }

  async getEvaluationEvents(input: EvaluationTraceReadInput): Promise<EvaluationTraceEvent[]> {
    const { tenantId, ...read } = evaluationTraceReadInputSchema.parse(input);

    return this.composition.repository.findEvaluationEvents({
      ...read,
      authorization: await this.ownProof({
        projectId: tenantId,
        entry: "TraceService.getEvaluationEvents",
      }),
    });
  }

  async getSpanTreePage({
    authorization,
    ...input
  }: SpanTreeInput & { authorization: Authorization }): Promise<SpanTreePage> {
    const parsed = spanTreeInputSchema.parse(input);
    const page = await this.composition.repository.listSummaryPage({
      authorization,
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
        page.hasMore && last
          ? {
              startTimeMs: last.startTimeMs,
              spanId: last.spanId,
              ownerProjectId: last.ownerProjectId ?? null,
            }
          : null,
    });
  }

  async getSpanTreeDelta(
    input: SpanTreeDeltaInput & { authorization: Authorization },
  ): Promise<SpanTreeNode[]> {
    const rows = await this.composition.repository.findSummarySince({
      authorization: input.authorization,
      traceId: input.traceId,
      sinceUpdatedAtMs: input.sinceUpdatedAtMs,
      ...(input.occurredAtMs === undefined ? {} : { occurredAtMs: input.occurredAtMs }),
    });

    return spanTreeNodesSchema.parse(
      gateCosts(
        rows.map((row) => this.price(row)),
        input.canSeeCosts,
      ),
    );
  }

  async buildQueryFieldCatalogue({
    input,
    authorization,
  }: {
    input: TraceQueryFieldCatalogueInput;
    authorization: Authorization;
  }): Promise<string> {
    const parsed = traceQueryFieldCatalogueInputSchema.parse(input);
    const catalogue = await this.queryFieldCatalogue.build({ input: parsed, authorization });

    return traceQueryFieldCatalogueOutputSchema.parse(catalogue);
  }

  classifyQuery(input: TraceQueryClassificationInput): TraceQueryClassification {
    const parsed = traceQueryClassificationInputSchema.parse(input);

    return traceQueryClassificationSchema.parse(
      this.composition.queryClassification.classify(parsed.query),
    );
  }

  async resolveIngestWaitTimeout(input: TraceIngestWaitInput): Promise<number> {
    return (await this.resolveTraceSettleSettings(input)).waitTimeoutMs;
  }

  /** Measured settings are cached per project for an hour; defaults are never cached. */
  async resolveTraceSettleSettings(input: TraceIngestWaitInput): Promise<TraceSettleSettings> {
    const parsed = traceIngestWaitInputSchema.parse(input);
    const now = nowInstant().epochMilliseconds;
    const cached = this.ingestWaitCache.get(parsed.projectId);
    if (cached && cached.expiresAt > now) {
      return cached.settings;
    }

    if (cached) {
      this.ingestWaitCache.delete(parsed.projectId);
    }

    try {
      const sample = await this.composition.repository.findIngestLag({
        authorization: await this.ownProof({
          projectId: parsed.projectId,
          entry: "TraceService.resolveTraceSettleSettings",
        }),
      });
      if (!sample || sample.sampleCount < MIN_INGEST_SAMPLE_COUNT) {
        return DEFAULT_TRACE_SETTLE_SETTINGS;
      }

      const settings = settleSettingsFromSample(sample);
      this.ingestWaitCache.set(parsed.projectId, {
        settings,
        expiresAt: now + INGEST_WAIT_CACHE_TTL_MS,
      });

      return settings;
    } catch {
      return DEFAULT_TRACE_SETTLE_SETTINGS;
    }
  }

  async findSummary(input: TraceSummaryLookupInput): Promise<TraceSummaryData | null> {
    const parsed = traceSummaryLookupInputSchema.parse(input);

    return this.composition.summaryReader.findSummary({
      tenantId: parsed.projectId,
      traceId: parsed.traceId,
      occurredAtMs: parsed.occurredAtMs,
      widen: parsed.widen,
    });
  }

  private ownProof({
    projectId,
    entry,
  }: {
    projectId: string;
    entry: string;
  }): Promise<Authorization> {
    return this.composition.authorize({ projectId, purpose: { kind: "operator", entry } });
  }

  private price({ costInput, cost, ...node }: TraceSpanSummaryRecord): SpanTreeNode {
    if (cost !== null) {
      return { ...node, cost };
    }

    const computed = this.composition.modelProviders.estimateCost(costInput);

    return { ...node, cost: computed > 0 ? computed : null };
  }
}
