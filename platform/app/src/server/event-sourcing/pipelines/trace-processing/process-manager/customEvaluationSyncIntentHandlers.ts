import crypto from "node:crypto";

import { createLogger } from "@langwatch/observability";

import type { IntentExecutor } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { evaluationNameAutoslug } from "~/server/tracer/collector/evaluationNameAutoslug";

import type { ReportEvaluationCommandData } from "../../evaluation-processing/schemas/commands";
import {
  CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE,
  CUSTOM_EVALUATION_SPAN_EVENT_NAME,
  type CustomEvaluationReportIntent,
  type SdkEvaluation,
  sdkEvaluationSchema,
} from "./customEvaluationSyncProcess.types";

const logger = createLogger(
  "langwatch:trace-processing:custom-evaluation-sync-process",
);

/**
 * One span event as the span store returns it.
 *
 * Structurally the subset of `ElasticSearchEvent` this reads, rather than the
 * whole legacy type. Note the shape: the store's read path reshapes the
 * ClickHouse `Events.Attributes` map into `event_details` key/value pairs, so
 * the payload is NOT under an `attributes` key — indexing that would silently
 * find nothing.
 */
export interface StoredSpanEvent {
  event_type: string;
  event_details: { key: string; value: string }[];
}

/** What the report needs from the trace and evaluation domains. */
export interface CustomEvaluationSyncDispatchDeps {
  /**
   * The span's stored events.
   *
   * Read here rather than carried on the intent (ADR-069's claim-check): the
   * verdicts are content, and everything a process holds is persisted verbatim
   * into the instance row and the outbox. `spanStorage` already wrote this
   * span once, so the payload has a canonical home to be read back from and
   * the intent can be identities alone.
   *
   * `occurredAtMs` windows the store's partition scan and has no unbounded
   * fallback, so it must be the span's own START — a span that ran longer than
   * the window and exported on end is permanently invisible to an
   * ingest-centered read.
   */
  getSpanEvents: (params: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }) => Promise<StoredSpanEvent[]>;
  /**
   * Records one finished evaluation, emitting its started and completed events
   * atomically. Keyed by the evaluation id the report derives, so a retried
   * dispatch lands on the evaluation it already reported rather than billing a
   * second one.
   */
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<void>;
}

/** The evaluator type every SDK-run evaluation is recorded under. */
const CUSTOM_EVALUATOR_TYPE = "custom";

/**
 * Executes the `reportEvaluations` intent: resolves the span's claim-check and
 * records the evaluations its SDK ran.
 *
 * A throw here re-leases the message and reports again, which is the whole
 * reason the hand-off is durable. It is safe to repeat because every
 * evaluation is addressed by a deterministic id — the one the SDK supplied, or
 * one derived from the verdict itself — so a redelivery lands on the
 * evaluation it already reported.
 *
 * Nothing is guarded beyond that: unlike a monitor the platform runs, a custom
 * evaluation has already been decided by the customer, and there is no
 * question left about whether it should be recorded.
 */
export function createCustomEvaluationReportHandler(
  deps: CustomEvaluationSyncDispatchDeps,
): IntentExecutor<CustomEvaluationReportIntent> {
  return async (payload) => {
    const { tenantId, traceId, spanId, occurredAt, spanStartedAt } = payload;

    const spanEvents = await deps.getSpanEvents({
      tenantId,
      traceId,
      spanId,
      occurredAtMs: spanStartedAt,
    });

    const evaluations = extractEvaluations(spanEvents);

    // The narrowing already established that this span carried a verdict, so
    // an empty read is "not stored YET" — the claim-check raced the sibling
    // span write — not "there was nothing here". Throwing is the contract: the
    // outbox backs off and asks again, and a span that never lands surfaces as
    // a loud exhausted message rather than a silent drop.
    if (evaluations.length === 0) {
      throw new Error(
        `Referenced span carries no readable custom evaluation yet (trace ${traceId}, span ${spanId}); retrying until the span store write lands`,
      );
    }

    logger.debug(
      { tenantId, traceId, spanId, evaluationCount: evaluations.length },
      "Reporting custom SDK evaluations",
    );

    const failures: unknown[] = [];

    for (const evaluation of evaluations) {
      const evaluationId =
        evaluation.evaluation_id ??
        deterministicEvaluationId({ traceId, evaluation });
      const evaluatorId =
        evaluation.evaluator_id ?? evaluationNameAutoslug(evaluation.name);

      try {
        await deps.reportEvaluation({
          tenantId,
          evaluationId,
          evaluatorId,
          evaluatorType: CUSTOM_EVALUATOR_TYPE,
          evaluatorName: evaluation.name,
          traceId,
          isGuardrail: evaluation.is_guardrail ?? undefined,
          status:
            evaluation.status ?? (evaluation.error ? "error" : "processed"),
          score: evaluation.score ?? null,
          passed: evaluation.passed ?? null,
          label: evaluation.label ?? null,
          details: evaluation.details ?? null,
          error: evaluation.error?.message ?? null,
          errorDetails: evaluation.error?.stacktrace?.join("\n") ?? null,
          costId: evaluation.cost_id ?? null,
          occurredAt,
        });
      } catch (error) {
        // Collected rather than rethrown immediately: one unreachable command
        // send must not stop the span's other evaluations from being reported.
        // It is NOT swallowed — see the throw below.
        logger.error(
          {
            tenantId,
            traceId,
            evaluationId,
            evaluatorId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to report a custom evaluation",
        );
        failures.push(error);
      }
    }

    logger.debug(
      {
        tenantId,
        traceId,
        spanId,
        evaluationCount: evaluations.length,
        failedCount: failures.length,
      },
      "Custom SDK evaluations reported",
    );

    // Any failure re-leases the whole report. The evaluations that did land are
    // addressed by the same ids on the retry, so reporting again costs a
    // duplicate command rather than a duplicate evaluation.
    if (failures.length > 0) {
      throw failures[0] instanceof Error
        ? failures[0]
        : new Error(String(failures[0]));
    }
  };
}

/**
 * The verdicts on one stored span, in the order it wrote them.
 *
 * Total: a payload that is not JSON, or that names no evaluator, is dropped
 * with a warn rather than failing the whole report. Only a missing name costs
 * a whole evaluation — the rule its predecessor applied — because a nameless
 * verdict cannot be attributed to an evaluator; individual fields degrade to
 * absent instead.
 */
function extractEvaluations(spanEvents: StoredSpanEvent[]): SdkEvaluation[] {
  const evaluations: SdkEvaluation[] = [];

  for (const spanEvent of spanEvents) {
    if (spanEvent.event_type !== CUSTOM_EVALUATION_SPAN_EVENT_NAME) continue;

    const json = spanEvent.event_details.find(
      (detail) => detail.key === CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE,
    )?.value;
    if (typeof json !== "string" || json.length === 0) continue;

    const evaluation = readEvaluation(json);
    if (evaluation) evaluations.push(evaluation);
  }

  return evaluations;
}

/** One evaluation, or null when the SDK wrote something unreadable as one. */
function readEvaluation(json: string): SdkEvaluation | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    // Logged without the payload: a customer whose evaluations do not appear
    // must be able to find out why, and the reason is never the content.
    logger.warn(
      { payloadLength: json.length },
      "Failed to parse json_encoded_event from evaluation span event",
    );
    return null;
  }

  const parsed = sdkEvaluationSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(
      { payloadLength: json.length },
      "Discarding a custom evaluation the SDK reported without a name",
    );
    return null;
  }

  return parsed.data;
}

/**
 * How an evaluation the SDK did not name is addressed.
 *
 * Derived from the verdict itself, so the same evaluation reported twice — by
 * a retried dispatch, or by a span the SDK re-exported — is one evaluation,
 * while a genuinely different verdict on the same trace is a different one.
 * The shape matches the legacy `mapEvaluations` behavior this replaced.
 *
 * Hashing the PARSED, narrowed verdict rather than the raw JSON text is what
 * makes the claim-check safe: the span store round-trips the payload through
 * `JSON.parse` → `JSON.stringify`, so the text it returns is semantically
 * equal to what the SDK sent but not byte-identical (Python's `json.dumps`
 * spacing alone diverges). A text hash would give the read-back path different
 * ids from the inline path; a hash of the parsed value does not.
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
