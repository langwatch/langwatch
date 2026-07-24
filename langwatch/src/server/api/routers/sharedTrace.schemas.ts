import { z } from "zod";

import { evaluationSchema } from "~/server/tracer/types";

/**
 * How many spans' full detail one share payload may carry. The share page
 * renders the whole waterfall regardless; beyond this many spans it stops
 * shipping per-span detail and says so. Lifting the cap properly means a
 * token-validated `sharedTrace.spanDetail` — see ADR-057's follow-ups.
 */
export const SHARE_MAX_FULL_SPANS = 500;

import {
  spanDetailSchema,
  spanLangwatchSignalsSchema,
  spanTreeNodeSchema,
  traceHeaderSchema,
  traceResourceInfoSchema,
} from "./tracesV2.schemas";

/**
 * The share-safe output contract for `sharedTrace.get` — the ONLY payload an
 * anonymous viewer can obtain. See ADR-057.
 *
 * Every section is an explicit `.pick()` from the internal read schema rather
 * than the internal schema itself. That is the whole point: tRPC runs this as
 * the procedure's `.output()` parser server-side, and Zod strips keys the
 * schema does not name. So a column added to `traceHeaderSchema` /
 * `spanDetailSchema` / `evaluationSchema` tomorrow is dropped at the share
 * boundary by default, and only reaches a share viewer once someone adds it to
 * a pick list here — a small, reviewable diff on a file that exists solely to
 * be reviewed.
 *
 * Fields the share surface must NEVER carry are omitted from the pick (they are
 * then stripped silently, which fails closed) or pinned to their redacted value
 * where an omission would be indistinguishable from "absent because old client"
 * — `userId` and evaluator stacktraces below. A pinned field turns a redaction
 * regression into a loud parse failure instead of a quiet leak; both are covered
 * by `sharedTrace.shareSafe.unit.test.ts`.
 *
 * Note this is defence in depth, not the only gate: the router still applies
 * `gateHeaderCost` / `gateTreeCost` / `gateResources` / `gateEvaluations` /
 * `applyDerivedTraceEventProtections`, which redact per-viewer (cost, captured
 * content, restricted attributes). The schema bounds the *shape*; the gates
 * decide the *values*.
 */

/**
 * `langwatch.user_id` identifies the end user behind the trace. It is pinned to
 * `null` rather than omitted: the share page's header type still carries the
 * field, and pinning means a future path that forgets to null it fails the
 * output parse instead of shipping PII to an anonymous viewer.
 */
const sharedTraceHeaderSchema = traceHeaderSchema
  .pick({
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
  })
  .extend({ userId: z.null() });

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
  attributes: z.record(z.string()),
});

/**
 * Evaluator verdicts. `inputs` is absent from the pick — it is captured trace
 * content and is never shared, at any visibility. `details` and the error
 * message follow content visibility (applied by `gateEvaluations`), and the
 * stacktrace is pinned empty so an evaluator's internal frames can never reach
 * an anonymous viewer.
 */
const sharedEvaluationSchema = evaluationSchema
  .pick({
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
  })
  .extend({
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
   * True when `spansFull` carries detail for only the first
   * `SHARE_MAX_FULL_SPANS` spans. The waterfall (`spanTree`) is always
   * complete — it is small per span — but full detail is not, because this
   * endpoint is unauthenticated and a wide trace would otherwise assemble an
   * unbounded response in memory. The viewer says so rather than silently
   * showing an empty detail pane. See ADR-057.
   */
  isSpanDetailTruncated: z.boolean(),
});

export type SharedTraceDto = z.infer<typeof sharedTraceDtoSchema>;
