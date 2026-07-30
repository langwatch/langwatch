import { z } from "zod";
import type {
  AnnotationState,
  ModelUsage,
  NameCandidate,
  OwnedAttributeMap,
} from "./spanDerivation";
import type { OriginState } from "./originClassification";

/**
 * `traceAnalytics`'s fold state — ADR-099's slimmer sibling of
 * `traceSummary`: no IO text, no per-span PII ids, and one extra field,
 * `storageAnchorMs`. The zod schema exists only to hash the shape for
 * `deriveStateVersion`; it is never parsed on the fold path.
 */

const nameCandidateSchema = z.object({
  spanId: z.string(),
  startTimeMs: z.number(),
  name: z.string(),
  spanType: z.string().nullable(),
});

const annotationRecordSchema = z.object({ present: z.boolean(), actedAt: z.number() });
const attributeOwnerSchema = z.object({ value: z.string(), spanId: z.string() });

const originStateSchema = z.object({
  rootOriginSpanId: z.string().nullable(),
  rootOrigin: z.string().nullable(),
  nonRootOriginSpanId: z.string().nullable(),
  nonRootOrigin: z.string().nullable(),
  hasEvaluationScope: z.boolean(),
  hasScenarioScope: z.boolean(),
  hasOptimizationStudioPlatform: z.boolean(),
  hasScenarioRunnerLabel: z.boolean(),
  hasScenarioLabelsResource: z.boolean(),
  hasEvaluationRunId: z.boolean(),
  lastMetadataPlatform: z.string().nullable(),
});

export const traceAnalyticsStateSchema = z.object({
  traceId: z.string(),

  /**
   * The ADR-099 storage anchor: frozen on the first contribution that
   * carries a usable business time, `0` while unset. First-observed BY
   * DESIGN, never `min`/`max` — see `anchorStorageTime`'s docblock in
   * `traceAnalytics.ts` for why this is the one deliberately accepted
   * exception to this pipeline's order-invariance discipline, sanctioned by
   * ADR-099's own definition of the `acceptedAt` role.
   */
  storageAnchorMs: z.number(),
  /** The genuinely order-invariant timing baseline — running min of span starts. */
  earliestSpanStartMs: z.number(),

  spanCount: z.number(),
  derivedSpanCount: z.number(),
  totalDurationMs: z.number(),

  rootCandidate: nameCandidateSchema.nullable(),
  fallbackCandidate: nameCandidateSchema.nullable(),
  traceNameOverride: z.string().nullable(),

  topicId: z.string().nullable(),
  subTopicId: z.string().nullable(),
  topicAssignedAt: z.number(),

  hasError: z.boolean(),

  modelUsage: z.map(z.string(), z.number()),

  totalCostRaw: z.number(),
  nonBilledCostRaw: z.number(),
  timeToFirstTokenMs: z.number().nullable(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  reasoningTokens: z.number(),

  annotations: z.map(z.string(), annotationRecordSchema),
  attributes: z.map(z.string(), attributeOwnerSchema),
  labels: z.set(z.string()),

  origin: originStateSchema,
});

export interface TraceAnalyticsState {
  readonly traceId: string;
  readonly storageAnchorMs: number;
  readonly earliestSpanStartMs: number;
  readonly spanCount: number;
  readonly derivedSpanCount: number;
  readonly totalDurationMs: number;
  readonly rootCandidate: NameCandidate | null;
  readonly fallbackCandidate: NameCandidate | null;
  readonly traceNameOverride: string | null;
  readonly topicId: string | null;
  readonly subTopicId: string | null;
  readonly topicAssignedAt: number;
  readonly hasError: boolean;
  readonly modelUsage: ModelUsage;
  readonly totalCostRaw: number;
  readonly nonBilledCostRaw: number;
  readonly timeToFirstTokenMs: number | null;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
  readonly annotations: AnnotationState;
  readonly attributes: OwnedAttributeMap;
  readonly labels: ReadonlySet<string>;
  readonly origin: OriginState;
}

export function initTraceAnalyticsState(traceId: string): TraceAnalyticsState {
  return {
    traceId,
    storageAnchorMs: 0,
    earliestSpanStartMs: 0,
    spanCount: 0,
    derivedSpanCount: 0,
    totalDurationMs: 0,
    rootCandidate: null,
    fallbackCandidate: null,
    traceNameOverride: null,
    topicId: null,
    subTopicId: null,
    topicAssignedAt: 0,
    hasError: false,
    modelUsage: new Map(),
    totalCostRaw: 0,
    nonBilledCostRaw: 0,
    timeToFirstTokenMs: null,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    annotations: new Map(),
    attributes: new Map(),
    labels: new Set(),
    origin: {
      rootOriginSpanId: null,
      rootOrigin: null,
      nonRootOriginSpanId: null,
      nonRootOrigin: null,
      hasEvaluationScope: false,
      hasScenarioScope: false,
      hasOptimizationStudioPlatform: false,
      hasScenarioRunnerLabel: false,
      hasScenarioLabelsResource: false,
      hasEvaluationRunId: false,
      lastMetadataPlatform: null,
    },
  };
}
