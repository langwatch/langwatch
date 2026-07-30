import { z } from "zod";

/**
 * `traceSummary`'s fold state. The zod schema exists only so the shape can be
 * hashed for `deriveStateVersion` — several fields are `Map`/`Set`
 * accumulators and nothing parses this on the fold path.
 */

const nameCandidateSchema = z.object({
  spanId: z.string(),
  startTimeMs: z.number(),
  name: z.string(),
  spanType: z.string().nullable(),
});

const errorMessageCandidateSchema = z.object({
  message: z.string(),
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  spanId: z.string(),
});

const ioCandidateSchema = z.object({
  text: z.string(),
  tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  endTimeMs: z.number(),
  spanId: z.string(),
});

const promptCandidateSchema = z.object({
  promptId: z.string(),
  versionId: z.string().nullable(),
  versionNumber: z.number().nullable(),
  spanId: z.string(),
  startTimeMs: z.number(),
});

const annotationRecordSchema = z.object({ present: z.boolean(), actedAt: z.number() });

const attributeOwnerSchema = z.object({ value: z.string(), spanId: z.string() });

const piiSpanIdSetSchema = z.object({
  ids: z.set(z.string()),
  overflowed: z.boolean(),
});

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

export const traceSummaryStateSchema = z.object({
  traceId: z.string(),

  spanCount: z.number(),
  derivedSpanCount: z.number(),

  /**
   * This table's own ADR-099 storage anchor — frozen on first write, never
   * re-derived. See `traceAnalytics.ts`'s `anchorStorageTime` docblock for
   * why a first-observed field is the one deliberately accepted exception to
   * this pipeline's order-invariance discipline. Kept structurally symmetric
   * with `TraceAnalyticsState.storageAnchorMs` on purpose, even though
   * `traceSummary`'s own table TTLs/partitions on it independently.
   */
  acceptedAtMs: z.number(),
  occurredAt: z.number(),
  totalDurationMs: z.number(),

  computedInput: ioCandidateSchema.nullable(),
  computedOutput: ioCandidateSchema.nullable(),

  timeToFirstTokenMs: z.number().nullable(),
  timeToLastTokenMs: z.number().nullable(),

  containsErrorStatus: z.boolean(),
  containsOKStatus: z.boolean(),
  errorMessage: errorMessageCandidateSchema.nullable(),

  modelUsage: z.map(z.string(), z.number()),

  totalCostRaw: z.number(),
  nonBilledCostRaw: z.number(),
  hasTokenUsage: z.boolean(),
  tokensEstimated: z.boolean(),
  totalPromptTokenCount: z.number(),
  totalCompletionTokenCount: z.number(),

  blockedByGuardrail: z.boolean(),
  containsAi: z.boolean(),
  containsPrompt: z.boolean(),
  selectedPrompt: promptCandidateSchema.nullable(),
  lastUsedPrompt: promptCandidateSchema.nullable(),

  rootCandidate: nameCandidateSchema.nullable(),
  fallbackCandidate: nameCandidateSchema.nullable(),
  traceNameOverride: z.string().nullable(),

  topicId: z.string().nullable(),
  subTopicId: z.string().nullable(),
  topicAssignedAt: z.number(),

  annotations: z.map(z.string(), annotationRecordSchema),

  attributes: z.map(z.string(), attributeOwnerSchema),
  labels: z.set(z.string()),
  promptIds: z.set(z.string()),

  origin: originStateSchema,

  piiPartialSpanIds: piiSpanIdSetSchema,
  piiSkippedSpanIds: piiSpanIdSetSchema,
});

/**
 * The TypeScript state type. Structurally identical to
 * `z.infer<typeof traceSummaryStateSchema>` (kept as a hand-written interface
 * rather than inferred — see module docblock) so every field in
 * `traceSummary.ts`'s `apply` gets full IDE/compiler support without paying
 * zod's inference cost on this shape.
 */
export interface TraceSummaryState {
  readonly traceId: string;

  readonly spanCount: number;
  readonly derivedSpanCount: number;

  readonly acceptedAtMs: number;
  readonly occurredAt: number;
  readonly totalDurationMs: number;

  readonly computedInput: import("./spanDerivation").IOCandidate | null;
  readonly computedOutput: import("./spanDerivation").IOCandidate | null;

  readonly timeToFirstTokenMs: number | null;
  readonly timeToLastTokenMs: number | null;

  readonly containsErrorStatus: boolean;
  readonly containsOKStatus: boolean;
  readonly errorMessage: import("./spanDerivation").ErrorMessageCandidate | null;

  readonly modelUsage: import("./spanDerivation").ModelUsage;

  readonly totalCostRaw: number;
  readonly nonBilledCostRaw: number;
  readonly hasTokenUsage: boolean;
  readonly tokensEstimated: boolean;
  readonly totalPromptTokenCount: number;
  readonly totalCompletionTokenCount: number;

  readonly blockedByGuardrail: boolean;
  readonly containsAi: boolean;
  readonly containsPrompt: boolean;
  readonly selectedPrompt: PromptCandidateWithVersion | null;
  readonly lastUsedPrompt: PromptCandidateWithVersion | null;

  readonly rootCandidate: import("./spanDerivation").NameCandidate | null;
  readonly fallbackCandidate: import("./spanDerivation").NameCandidate | null;
  readonly traceNameOverride: string | null;

  readonly topicId: string | null;
  readonly subTopicId: string | null;
  readonly topicAssignedAt: number;

  readonly annotations: import("./spanDerivation").AnnotationState;

  readonly attributes: import("./spanDerivation").OwnedAttributeMap;
  readonly labels: ReadonlySet<string>;
  readonly promptIds: ReadonlySet<string>;

  readonly origin: import("./originClassification").OriginState;

  readonly piiPartialSpanIds: import("./spanDerivation").PIISpanIdSet;
  readonly piiSkippedSpanIds: import("./spanDerivation").PIISpanIdSet;
}

export interface PromptCandidateWithVersion {
  readonly promptId: string;
  readonly versionId: string | null;
  readonly versionNumber: number | null;
  readonly spanId: string;
  readonly startTimeMs: number;
}

export function initTraceSummaryState(traceId: string): TraceSummaryState {
  return {
    traceId,
    spanCount: 0,
    derivedSpanCount: 0,
    acceptedAtMs: 0,
    occurredAt: 0,
    totalDurationMs: 0,
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    containsErrorStatus: false,
    containsOKStatus: false,
    errorMessage: null,
    modelUsage: new Map(),
    totalCostRaw: 0,
    nonBilledCostRaw: 0,
    hasTokenUsage: false,
    tokensEstimated: false,
    totalPromptTokenCount: 0,
    totalCompletionTokenCount: 0,
    blockedByGuardrail: false,
    containsAi: false,
    containsPrompt: false,
    selectedPrompt: null,
    lastUsedPrompt: null,
    rootCandidate: null,
    fallbackCandidate: null,
    traceNameOverride: null,
    topicId: null,
    subTopicId: null,
    topicAssignedAt: 0,
    annotations: new Map(),
    attributes: new Map(),
    labels: new Set(),
    promptIds: new Set(),
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
    piiPartialSpanIds: { ids: new Set(), overflowed: false },
    piiSkippedSpanIds: { ids: new Set(), overflowed: false },
  };
}
