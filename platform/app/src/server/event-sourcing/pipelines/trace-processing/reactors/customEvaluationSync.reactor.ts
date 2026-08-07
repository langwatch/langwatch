import crypto from "node:crypto";
import { createLogger } from "@langwatch/observability";
import { evaluationNameAutoslug } from "~/server/tracer/collector/evaluationNameAutoslug";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { ReportEvaluationCommandData } from "../../evaluation-processing/schemas/commands";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import { STALE_TRACE_THRESHOLD_MS } from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import { isSpanReceivedEvent } from "../schemas/events";
import type { OtlpSpan } from "../schemas/otlp";

const logger = createLogger(
  "langwatch:trace-processing:custom-evaluation-sync-reactor",
);

export interface CustomEvaluationSyncReactorDeps {
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<void>;
}

interface SdkEvaluation {
  evaluation_id?: string;
  evaluator_id?: string;
  span_id?: string;
  name: string;
  type?: string;
  is_guardrail?: boolean;
  status?: "processed" | "skipped" | "error";
  passed?: boolean;
  score?: number;
  label?: string;
  details?: string;
  cost_id?: string;
  error?: { message: string; stacktrace?: string[] };
  timestamps?: { started_at?: number; finished_at?: number };
}

/**
 * Generates a deterministic evaluation ID by hashing the evaluation JSON.
 * Matches the legacy `mapEvaluations` behavior for idempotency.
 */
function deterministicEvaluationId({
  traceId,
  evaluation,
}: {
  traceId: string;
  evaluation: SdkEvaluation;
}): string {
  const hash = crypto
    .createHash("md5")
    .update(JSON.stringify({ traceId, evaluation }))
    .digest("hex");
  return `eval_md5_${hash}`;
}

const EVAL_EVENT_NAME = "langwatch.evaluation.custom";

type OtlpSpanEvent = NonNullable<OtlpSpan["events"]>[number];

function findJsonEncodedEventPayload(event: OtlpSpanEvent): string | undefined {
  const jsonAttr = event.attributes.find(
    (attr) => attr.key === "json_encoded_event",
  );
  return jsonAttr?.value && "stringValue" in jsonAttr.value
    ? jsonAttr.value.stringValue
    : undefined;
}

function parseSdkEvaluation(jsonPayload: string): SdkEvaluation | undefined {
  try {
    const parsed: unknown = JSON.parse(jsonPayload);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return undefined;
    const record = parsed as Record<string, unknown>;
    if (typeof record.name !== "string") return undefined;
    return record as unknown as SdkEvaluation;
  } catch {
    logger.warn(
      { payloadLength: jsonPayload.length },
      "Failed to parse json_encoded_event from evaluation span event",
    );
    return undefined;
  }
}

/**
 * Extracts SDK evaluations directly from OTLP span events.
 *
 * Reads `langwatch.evaluation.custom` events from the raw OTLP span,
 * parses the `json_encoded_event` attribute from each.
 */
export function extractEvaluationsFromSpan(span: OtlpSpan): SdkEvaluation[] {
  const evaluations: SdkEvaluation[] = [];

  for (const event of span.events ?? []) {
    if (event.name !== EVAL_EVENT_NAME) continue;

    const jsonPayload = findJsonEncodedEventPayload(event);
    if (typeof jsonPayload !== "string") continue;

    const evaluation = parseSdkEvaluation(jsonPayload);
    if (evaluation) evaluations.push(evaluation);
  }

  return evaluations;
}

/**
 * Cheap presence check — no JSON.parse. The predicate runs on the projection
 * hot path with attacker-supplied span payloads, so it only looks for an
 * evaluation event carrying a string payload; full parsing and validation
 * stay in handle() off the hot path.
 */
function spanHasEvaluationEvents(span: OtlpSpan): boolean {
  return (span.events ?? []).some(
    (event) =>
      event.name === EVAL_EVENT_NAME &&
      event.attributes.some(
        (attr) =>
          attr.key === "json_encoded_event" &&
          attr.value !== undefined &&
          "stringValue" in attr.value,
      ),
  );
}

/**
 * Pure relevance guard, shared by shouldReact (pre-enqueue) and handle
 * (fail-open path): only span events that are recent (not a resync) and
 * actually carry `langwatch.evaluation.custom` events need this reactor.
 */
function hasSyncableEvaluations(event: TraceProcessingEvent): boolean {
  if (!isSpanReceivedEvent(event)) return false;
  if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return false;
  return spanHasEvaluationEvents(event.data.span);
}

function resolveEvaluationIdentity({
  traceId,
  evaluation,
}: {
  traceId: string;
  evaluation: SdkEvaluation;
}): {
  evaluationId: string;
  evaluatorId: string;
  status: NonNullable<SdkEvaluation["status"]>;
} {
  return {
    evaluationId:
      evaluation.evaluation_id ??
      deterministicEvaluationId({ traceId, evaluation }),
    evaluatorId:
      evaluation.evaluator_id ?? evaluationNameAutoslug(evaluation.name),
    status: evaluation.status ?? (evaluation.error ? "error" : "processed"),
  };
}

function buildReportEvaluationCommandData({
  tenantId,
  traceId,
  evaluation,
  identity,
  occurredAt,
}: {
  tenantId: string;
  traceId: string;
  evaluation: SdkEvaluation;
  identity: ReturnType<typeof resolveEvaluationIdentity>;
  occurredAt: number;
}): ReportEvaluationCommandData {
  return {
    tenantId,
    evaluationId: identity.evaluationId,
    evaluatorId: identity.evaluatorId,
    evaluatorType: "custom",
    evaluatorName: evaluation.name,
    traceId,
    isGuardrail: evaluation.is_guardrail ?? undefined,
    status: identity.status,
    score: evaluation.score ?? null,
    passed: evaluation.passed ?? null,
    label: evaluation.label ?? null,
    details: evaluation.details ?? null,
    error: evaluation.error?.message ?? null,
    errorDetails: evaluation.error?.stacktrace?.join("\n") ?? null,
    costId: evaluation.cost_id ?? null,
    occurredAt,
  };
}

async function syncEvaluations({
  deps,
  tenantId,
  traceId,
  evaluations,
  occurredAt,
}: {
  deps: CustomEvaluationSyncReactorDeps;
  tenantId: string;
  traceId: string;
  evaluations: SdkEvaluation[];
  occurredAt: number;
}): Promise<Error[]> {
  const errors: Error[] = [];

  for (const evaluation of evaluations) {
    const identity = resolveEvaluationIdentity({ traceId, evaluation });

    try {
      await deps.reportEvaluation(
        buildReportEvaluationCommandData({
          tenantId,
          traceId,
          evaluation,
          identity,
          occurredAt,
        }),
      );
    } catch (error) {
      logger.error(
        {
          tenantId,
          traceId,
          evaluationId: identity.evaluationId,
          evaluatorId: identity.evaluatorId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to sync custom evaluation",
      );
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return errors;
}

/**
 * Reactor that syncs custom SDK evaluations to the evaluation-processing pipeline.
 *
 * Reads `langwatch.evaluation.custom` events directly from each SpanReceivedEvent's
 * OTLP span data, then dispatches a single reportEvaluation command that emits
 * both started and completed events atomically.
 * Uses deterministic IDs for idempotency on retries.
 */
export function createCustomEvaluationSyncReactor(
  deps: CustomEvaluationSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "customEvaluationSync",
    shouldReact: (event) => hasSyncableEvaluations(event),
    options: {
      makeJobId: (payload) =>
        `custom-eval-sync:${payload.event.tenantId}:${payload.event.aggregateId}:${payload.event.id}`,
      ttl: 30_000,
      delay: 5_000,
    },

    async handle(
      event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      if (!isSpanReceivedEvent(event)) return;
      if (!hasSyncableEvaluations(event)) return;

      const { tenantId, aggregateId: traceId } = context;

      const evaluations = extractEvaluationsFromSpan(event.data.span);
      if (evaluations.length === 0) return;

      logger.debug(
        { tenantId, traceId, evaluationCount: evaluations.length },
        "Syncing custom SDK evaluations",
      );

      const errors = await syncEvaluations({
        deps,
        tenantId,
        traceId,
        evaluations,
        occurredAt: event.occurredAt,
      });

      logger.debug(
        {
          tenantId,
          traceId,
          evaluationCount: evaluations.length,
          failedCount: errors.length,
        },
        "Custom SDK evaluations synced",
      );

      if (errors.length > 0) {
        throw errors[0];
      }
    },
  };
}
