/**
 * Domain state for the analytics trace fact projection.
 * Denormalized, pre-aggregated row representing one trace for analytics queries.
 * Populated by fold projections from trace-processing pipeline events.
 */
export interface AnalyticsTraceFactData {
  traceId: string;
  occurredAt: number;

  // Known metadata
  userId: string;
  threadId: string;
  customerId: string;
  labels: string[];
  topicId: string | null;
  subTopicId: string | null;

  // Dynamic metadata (semconv keyed, values >256 chars omitted)
  metadata: Record<string, string>;

  // Performance
  totalCost: number | null;
  totalDurationMs: number;
  totalPromptTokens: number | null;
  totalCompletionTokens: number | null;
  tokensPerSecond: number | null;
  timeToFirstTokenMs: number | null;
  containsError: boolean;
  hasAnnotation: boolean | null;
  spanCount: number;

  // Per-model (parallel arrays)
  modelNames: string[];
  modelPromptTokens: number[];
  modelCompletionTokens: number[];
  modelCosts: number[];

  // Events (parallel arrays)
  eventTypes: string[];
  eventScoreKeys: string[];
  eventScoreValues: number[];
  eventDetailKeys: string[];
  eventDetailValues: string[];
  thumbsUpDownVote: number | null;

  // RAG
  ragDocumentIds: string[];
  ragDocumentContents: string[];

  // Timestamps (auto-managed by fold)
  createdAt: number;
  updatedAt: number;
}

/**
 * Domain state for the analytics evaluation fact projection.
 * Denormalized row representing one evaluation run for analytics queries.
 * Populated by fold projections from evaluation-processing pipeline events.
 */
export interface AnalyticsEvaluationFactData {
  evaluationId: string;
  traceId: string | null;
  occurredAt: number;

  // Evaluator
  evaluatorId: string;
  evaluatorName: string | null;
  evaluatorType: string;
  isGuardrail: boolean;

  // Results
  score: number | null;
  passed: boolean | null;
  label: string | null;
  status: string;

  // Best-effort trace context (nullable)
  userId: string | null;
  threadId: string | null;
  topicId: string | null;
  customerId: string | null;

  // Timestamps
  createdAt: number;
  updatedAt: number;
}
