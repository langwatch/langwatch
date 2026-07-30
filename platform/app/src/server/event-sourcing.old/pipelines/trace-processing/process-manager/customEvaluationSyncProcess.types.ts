import { z } from "zod";

/** Process name, as mounted on the trace pipeline. */
export const CUSTOM_EVALUATION_SYNC_PROCESS_NAME = "customEvaluationSync";

export const CUSTOM_EVALUATION_SYNC_INTENT_TYPES = {
  REPORT_EVALUATIONS: "reportEvaluations",
} as const;

/**
 * The OTLP span event an SDK writes for one evaluation it ran itself.
 *
 * A custom evaluation reaches us as span-event content rather than as a
 * command: the SDK already knows the verdict, and stapling it to the span is
 * the only way it can say so without a second round trip.
 */
export const CUSTOM_EVALUATION_SPAN_EVENT_NAME = "langwatch.evaluation.custom";

/** The span-event attribute carrying one evaluation as a JSON string. */
export const CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE = "json_encoded_event";

/**
 * Delivery attempts for one span's evaluations.
 *
 * Sized for the claim-check race rather than for the dispatch. The intent
 * resolves the span through the span store, and that store's write is a
 * sibling map projection on the same event — so the first attempt can lose the
 * race legitimately. Attempts are spent waiting for a write already in flight,
 * not retrying a failing command, which is why there are more of them than a
 * plain dispatch would want.
 */
export const CUSTOM_EVALUATION_SYNC_MAX_ATTEMPTS = 5;

/**
 * Backoff between attempts: 2s, 4s, 8s, 16s.
 *
 * The first attempt fires as soon as the outbox drains, which is normally
 * before the sibling span write has landed. Two seconds is what the equivalent
 * claim-check subscriber (`codingAgentSpanFactsDispatch`) debounces by, and
 * doubling from there covers the tail without holding a lease open for long.
 */
export function customEvaluationSyncRetryDelayMs({
  attempt,
}: {
  attempt: number;
}): number {
  return 2_000 * 2 ** Math.max(0, attempt - 1);
}

/**
 * How long a leased report stays invisible to other loops. It is one span read
 * plus a command send per evaluation on that span.
 */
export const CUSTOM_EVALUATION_SYNC_LEASE_DURATION_MS = 60_000;

/**
 * This process has no state, and that is the finding rather than an oversight.
 *
 * Its siblings on this pipeline accumulate something across messages — a
 * trace's start instant, its span counts, an armed deadline — because they
 * decide something over time. This one decides nothing: a verdict is final
 * when it arrives, the work is identified by the span that carried it
 * (ADR-098: derived, never minted), and there is no deadline, no latch and no
 * generation to keep. An empty instance row per reporting trace is the honest
 * cost of expressing a relay on the dispatch substrate.
 *
 * That cost is the visible edge of a classification question deferred rather
 * than settled — see the docblock on `customEvaluationSync.process.ts`.
 */
export type CustomEvaluationSyncState = Record<string, never>;

export const INITIAL_CUSTOM_EVALUATION_SYNC_STATE: CustomEvaluationSyncState =
  {};

/**
 * Optional fields, read forgivingly.
 *
 * An SDK that types one field wrong — a score sent as a string, a label sent
 * as a number — degrades that field to absent rather than costing the whole
 * evaluation. Its predecessor validated nothing at all and let the malformed
 * value reach the command schema, where it failed after the dispatch had
 * already been staged.
 */
const forgivingString = z.string().nullish().catch(null);
const forgivingNumber = z.number().nullish().catch(null);
const forgivingBoolean = z.boolean().nullish().catch(null);

/**
 * One evaluation as an SDK reported it.
 *
 * Only the fields the report actually forwards are declared, and zod strips
 * everything else — so an SDK that starts stapling the evaluated inputs onto
 * the event cannot walk prompts and completions into a command by accident.
 * `name` is the one required field, which is exactly the rule its predecessor
 * applied.
 *
 * Parsed in the intent handler, never in the narrowing: the payload it parses
 * is read back out of the span store at dispatch time and no longer crosses
 * the process boundary at all.
 */
export const sdkEvaluationSchema = z.object({
  name: z.string(),
  evaluation_id: forgivingString,
  evaluator_id: forgivingString,
  is_guardrail: forgivingBoolean,
  status: z.enum(["processed", "skipped", "error"]).nullish().catch(null),
  passed: forgivingBoolean,
  score: forgivingNumber,
  label: forgivingString,
  details: forgivingString,
  cost_id: forgivingString,
  error: z
    .object({
      message: forgivingString,
      stacktrace: z.array(z.string()).nullish().catch(null),
    })
    .nullish()
    .catch(null),
});

export type SdkEvaluation = z.infer<typeof sdkEvaluationSchema>;

/**
 * The content boundary. Trace events carry whole spans — prompts, completions,
 * tool output, and the evaluation payloads themselves — and the default
 * payload would persist every one of them into the instance row and the
 * outbox. What crosses instead is the span's identity and one yes/no question;
 * the verdicts are read back from the span store at dispatch time (ADR-098's
 * claim-check).
 */
export const customEvaluationSyncEventViewSchema = z.object({
  /**
   * The span's own id, or null when this event cannot be referenced — no
   * usable span id, or no parseable start instant to window the store read on.
   * Both are the conditions `makeSpanReferencedEvent` refuses to reference on,
   * and its docblock records that neither is a live path.
   */
  spanId: z.string().nullable(),
  /**
   * The span's START, not the event's ingest instant. The store read is
   * windowed on this with no unbounded fallback, so a span that ran longer
   * than the window and exported on end would be permanently invisible to an
   * ingest-centered read.
   */
  spanStartedAt: z.number().nullable(),
  /**
   * Whether this span carried any custom evaluation at all — a name match and
   * a string-valued payload attribute, with no JSON parsing.
   *
   * It is what keeps the claim-check affordable: without it every span in the
   * project would mint an outbox row and a ClickHouse read to discover it had
   * nothing to report. Total, and it degrades to false, which is the same
   * answer an ordinary span gives.
   */
  hasCustomEvaluations: z.boolean(),
});

export type CustomEvaluationSyncEventView = z.infer<
  typeof customEvaluationSyncEventViewSchema
>;

/**
 * Report the evaluations one span carried to the evaluation pipeline.
 *
 * Identities only. The verdicts live in the span store, where `spanStorage`
 * already wrote them once, and the handler reads them back from there — so no
 * evaluation content is ever persisted into an inbox or an outbox row.
 */
export const customEvaluationReportIntentSchema = z.object({
  tenantId: z.string().min(1),
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  /** The span's business instant; stamped on each evaluation reported. */
  occurredAt: z.number(),
  /** @see CustomEvaluationSyncEventView.spanStartedAt */
  spanStartedAt: z.number(),
});

export type CustomEvaluationReportIntent = z.infer<
  typeof customEvaluationReportIntentSchema
>;

/**
 * The outbox message key for one span's report.
 *
 * Derived from the work itself, never minted (ADR-098). The span is what carried the
 * verdicts, so the span is what identifies the report: two deliveries of one
 * span collapse, and the trace's next span reports under its own key with no
 * counter to keep.
 */
export function reportEvaluationsMessageKey(
  traceId: string,
  spanId: string,
): string {
  return `custom-eval:${traceId}:${spanId}`;
}
