import { z } from "zod";

import { evaluationSchema } from "./trace-format.schemas.ts";

/**
 * How many spans' full detail one share payload may carry; beyond this the
 * page still renders the waterfall but stops shipping per-span detail.
 * Lifting it properly needs a token-validated `sharedTrace.spanDetail` (ADR-057).
 */
export const SHARE_MAX_FULL_SPANS = 500;

import {
  spanDetailSchema,
  spanLangwatchSignalsSchema,
  traceHeaderSchema,
  traceResourceInfoSchema,
} from "./trace-view.contract.ts";
import { spanTreeNodeSchema } from "./trace.ts";

/**
 * Share-safe contract via explicit `.pick()` from internal schemas. Columns
 * added to internal schemas are dropped by default; only reviewed additions
 * reach viewers. Defense in depth: router gates also redact per-viewer. See ADR-057.
 */

/**
 * `langwatch.user_id` is pinned to `null` rather than omitted: a future path
 * that forgets to null it fails the output parse instead of shipping PII to
 * an anonymous viewer.
 */
const sharedTraceHeaderPickedSchema = traceHeaderSchema.pick({
  traceId: true,
  timestamp: true,
  name: true,
  serviceName: true,
  origin: true,
  conversationId: true,
  durationMs: true,
  spanCount: true,
  status: true,
  error: true,
  input: true,
  output: true,
  inputRedacted: true,
  outputRedacted: true,
  inputVisibleTo: true,
  outputVisibleTo: true,
  redactedByVisibilityWindow: true,
  models: true,
  // Spend: `gateHeaderCost` nulls these unless the viewer holds `cost:view`
  // in their OWN session, so an org/project-scoped link opened by a member
  // who can already see spend in-app still shows it. Sharing never widens.
  totalCost: true,
  nonBilledCost: true,
  totalTokens: true,
  inputTokens: true,
  outputTokens: true,
  tokensEstimated: true,
  ttft: true,
  traceName: true,
  rootSpanType: true,
  scenarioRunId: true,
  containsPrompt: true,
  selectedPromptId: true,
  selectedPromptSpanId: true,
  lastUsedPromptId: true,
  lastUsedPromptVersionNumber: true,
  lastUsedPromptVersionId: true,
  lastUsedPromptSpanId: true,
  attributes: true,
  privacy: true,
});

const sharedTraceHeaderSchema = z.object({
  ...sharedTraceHeaderPickedSchema.shape,
  userId: z.null(),
});

const sharedSpanTreeNodeSchema = spanTreeNodeSchema.pick({
  spanId: true,
  parentSpanId: true,
  name: true,
  type: true,
  startTimeMs: true,
  endTimeMs: true,
  durationMs: true,
  status: true,
  model: true,
  // The tool's NAME (WebSearch, Bash...) labels the waterfall row exactly as
  // in-app; arguments/results are span CONTENT and stay behind the detail
  // read's redaction pass.
  toolName: true,
  // `gateTreeCost` nulls per-span spend on the same `cost:view` rule as the
  // header.
  cost: true,
  inputTokens: true,
  outputTokens: true,
  cacheReadTokens: true,
  cacheCreationTokens: true,
});

const sharedSpanDetailSchema = spanDetailSchema.pick({
  spanId: true,
  parentSpanId: true,
  name: true,
  type: true,
  startTimeMs: true,
  endTimeMs: true,
  durationMs: true,
  status: true,
  model: true,
  vendor: true,
  input: true,
  output: true,
  inputRedacted: true,
  outputRedacted: true,
  inputVisibleTo: true,
  outputVisibleTo: true,
  contentPrivacy: true,
  piiAnalysisIncomplete: true,
  restrictedAttributes: true,
  error: true,
  metrics: true,
  params: true,
  events: true,
  costSuggestion: true,
});

const sharedSpanSignalsSchema = spanLangwatchSignalsSchema.pick({
  spanId: true,
  signals: true,
});

const sharedResourcesSchema = traceResourceInfoSchema.pick({
  rootSpanId: true,
  resourceAttributes: true,
  scope: true,
  spans: true,
});

/**
 * Trace-level derived events. `DerivedTraceEvent` is a plain interface with no
 * schema of its own, so the share contract is spelled out here — which is where
 * it belongs anyway.
 */
const sharedTraceEventSchema = z.object({
  spanId: z.string(),
  timestamp: z.number(),
  name: z.string(),
  attributes: z.record(z.string(), z.string()),
});

/**
 * Evaluator verdicts. `inputs` is never shared, at any visibility. `details`
 * and the error message follow content visibility (`gateEvaluations`); the
 * stacktrace is pinned empty so internal frames never reach a viewer.
 */
const sharedEvaluationPickedSchema = evaluationSchema.pick({
  evaluation_id: true,
  evaluator_id: true,
  span_id: true,
  name: true,
  type: true,
  is_guardrail: true,
  evaluation_thread_id: true,
  status: true,
  passed: true,
  score: true,
  label: true,
  details: true,
  retries: true,
  timestamps: true,
});

const sharedEvaluationSchema = z.object({
  ...sharedEvaluationPickedSchema.shape,
  error: z
    .object({
      has_error: z.literal(true),
      message: z.string(),
      stacktrace: z.array(z.string()).max(0),
    })
    .optional()
    .nullable(),
});

export const sharedTraceDtoSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    language: z.string(),
    framework: z.string(),
  }),
  header: sharedTraceHeaderSchema,
  spanTree: z.array(sharedSpanTreeNodeSchema),
  spansFull: z.array(sharedSpanDetailSchema),
  spanSignals: z.array(sharedSpanSignalsSchema),
  resources: sharedResourcesSchema,
  events: z.array(sharedTraceEventSchema),
  evaluations: z.array(sharedEvaluationSchema),
  /**
   * True when `spansFull` only carries the first `SHARE_MAX_FULL_SPANS`
   * spans — this endpoint is unauthenticated, so a wide trace would
   * otherwise assemble an unbounded response in memory. See ADR-057.
   */
  isSpanDetailTruncated: z.boolean(),
});

export type SharedTraceDto = z.infer<typeof sharedTraceDtoSchema>;
