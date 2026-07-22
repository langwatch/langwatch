import {
  handledErrorFromHerr,
  type SerializedHandledError,
} from "@langwatch/handled-error";

/**
 * Turns the nlpgo engine's structured node failure into a
 * `SerializedHandledError` the client renders from its code.
 *
 * The engine already carries a stable code (`NodeError.Type` →
 * `execution_state.error_type`: `http_error`, `upstream_http_error`,
 * `llm_error`, …), but the streamed event historically flattened it to just
 * the raw message string, which then reached the customer verbatim
 * (`httpblock: Post "…": no such host`). This lifts the code onto the handled
 * channel — mirroring the evaluator side, which already ships
 * `domainError: evalError.serialize()`.
 *
 * Built through `handledErrorFromHerr` so the same adapter that decodes real
 * Go `herr` envelopes produces this one: the raw message rides as the handled
 * error's server-side `message`, which `SerializedHandledError` deliberately
 * omits (#5984), so the CODE is what the client presents from.
 *
 * The raw string does still reach one surface, deliberately: the evaluator
 * grid ships it as `details` and `ComparisonCell` puts it behind a "show
 * details" popover. That is not a contradiction of the rule, it is the rule —
 * registry copy is what a customer READS, and the engine's own words are
 * available on request to the person debugging the workflow they wrote. What
 * is forbidden is the raw string appearing as a headline, a toast body, or
 * anything a customer sees without asking for it.
 */
export function nodeErrorToDomainError({
  errorType,
  message,
  upstreamStatus,
  traceId,
  spanId,
}: {
  errorType: string;
  message?: string;
  upstreamStatus?: number;
  traceId?: string;
  spanId?: string;
}): SerializedHandledError {
  return handledErrorFromHerr(
    {
      type: errorType,
      // Server copy only — kept for logs, never serialised to the client.
      message: message ?? errorType,
      // `upstream_status` is the one meta field the registry reads (the
      // `upstream_http_error` copy names the status); everything else is a
      // node-execution detail the customer never sees.
      ...(upstreamStatus ? { meta: { upstreamStatus } } : {}),
      trace_id: traceId,
      span_id: spanId,
      // A node/target failure is the engine or a downstream service, not the
      // customer's input. Cosmetic here anyway: the registry has copy for
      // every node code, so the fault-based fallback is never reached.
      fault: "provider",
    },
    // No HTTP boundary for a streamed node error; use the upstream status when
    // present, else a downstream-failure default.
    { httpStatus: upstreamStatus ?? 502 },
  ).serialize();
}
